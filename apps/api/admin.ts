import { createHash, randomBytes } from 'node:crypto';
import { auth, db } from './firebase.ts';
import { ApiError, profileFor } from './service.ts';
import {
  canConfigure,
  canManageUsers,
  canViewAdmin,
  effectiveMembership,
  type Hospital,
  type Profile,
} from '../../shared/domain.ts';
import {
  adminOperationSchema,
  canAdmin,
  grantWithinScope,
  visibleMemberships,
  type AdminOperation,
  type AdminResult,
  type AdminWorkspace,
} from '../../shared/admin.ts';

function checkAccess(value: unknown, status: number, message: string): asserts value {
  if (!value) throw new ApiError(status, message);
}
export async function adminWorkspace(uid: string): Promise<AdminWorkspace> {
  const profile = await profileFor(uid);
  checkAccess(canAdmin(profile), 403, 'Administration is outside your access.');
  const hospitalDocs = profile.superUser
    ? (await db.collection('hospitals').limit(501).get()).docs
    : (
        await Promise.all(
          profile.memberships
            .filter((m) => canViewAdmin(m.role))
            .map((m) => db.doc(`hospitals/${m.hospitalId}`).get()),
        )
      ).filter((d) => d.exists);
  checkAccess(hospitalDocs.length <= 500, 422, 'The administration hospital limit was reached.');
  const hospitals = hospitalDocs.map((d) => d.data() as Hospital);
  const snapshots = await db.collection('profiles').limit(1001).get();
  checkAccess(snapshots.size <= 1000, 422, 'The administration staff limit was reached.');
  const users = snapshots.docs.flatMap((d) => {
    const target = d.data() as Profile;
    if (!target.active || (target.superUser && !profile.superUser)) return [];
    const memberships = visibleMemberships(profile, target, hospitals);
    if (!memberships.length && !profile.superUser) return [];
    return [
      {
        uid: target.uid,
        name: target.name,
        email: target.email,
        version: target.version ?? 1,
        superUser: !!target.superUser,
        memberships,
      },
    ];
  });
  return {
    profile,
    hospitals: hospitals.map((h) => ({
      ...h,
      departments: h.departments.filter((d) =>
        effectiveMembership(profile, h)!.departments.includes(d.id),
      ),
    })),
    users,
  };
}

// Each shared mutation checks current authority inside its Firestore transaction.
// Auth creation is a resumable second step; an orphan Auth user has no app profile/access.
export async function administer(uid: string, input: unknown): Promise<AdminResult> {
  const op = adminOperationSchema.parse(input);
  const hash = createHash('sha256').update(JSON.stringify(op)).digest('hex');
  const receipt = db.doc(`adminOperations/${op.id}`);
  let targetUid: string | undefined;
  if (op.type === 'user-create') targetUid = `staff-${op.id}`;
  if (op.type === 'user-access') {
    const actor = await profileFor(uid);
    checkAccess(
      actor.superUser || actor.memberships.some((m) => canManageUsers(m.role)),
      403,
      'You cannot manage users.',
    );
    try {
      targetUid = (await auth.getUserByEmail(op.data.email)).uid;
    } catch (e) {
      if ((e as { code?: string }).code === 'auth/user-not-found')
        throw new ApiError(404, 'No account uses that email. Choose Add new user.');
      throw e;
    }
  }

  async function transact(finalise: boolean): Promise<AdminResult | undefined> {
    return db.runTransaction(async (tx) => {
      const [actorDoc, prior] = await tx.getAll(db.doc(`profiles/${uid}`), receipt);
      const actor = actorDoc.data() as Profile | undefined;
      checkAccess(actor?.active && canAdmin(actor), 403, 'You cannot administer this workspace.');
      if (prior.exists)
        checkAccess(
          prior.get('actorId') === uid && prior.get('hash') === hash,
          409,
          'This request ID belongs to different input.',
        );
      const at = new Date().toISOString();
      let before: unknown = null,
        after: unknown = null,
        removedGrant: Profile['memberships'][number] | null = null;
      const userOp = op.type === 'user-create' || op.type === 'user-access';
      const hospitalIds = userOp
        ? [
            ...new Set([
              ...op.data.memberships.map((m) => m.hospitalId),
              ...(op.type === 'user-access' && op.data.removeHospitalId
                ? [op.data.removeHospitalId]
                : []),
            ]),
          ]
        : [op.data.hospitalId];
      const hospitalDocs = await Promise.all(
        hospitalIds.map((id) => tx.get(db.doc(`hospitals/${id}`))),
      );
      const hospitals = hospitalDocs.filter((d) => d.exists).map((d) => d.data() as Hospital);
      if (userOp) {
        checkAccess(
          op.data.memberships.length === new Set(op.data.memberships.map((m) => m.hospitalId)).size,
          400,
          'Choose one role per hospital.',
        );
        checkAccess(
          op.data.superUser || hospitalIds.length > 0,
          400,
          'Select a hospital and department scope.',
        );
        checkAccess(
          !op.data.superUser || (actor.superUser && op.data.memberships.length === 0),
          403,
          'Only a Super User can create global access.',
        );
        const hospitalAdmin = op.data.memberships.some((m) => m.role.startsWith('system_admin'));
        checkAccess(
          !hospitalAdmin || op.data.memberships.length === 1,
          400,
          'System Admin applies to one hospital. Use Major User for multiple hospitals.',
        );
        for (const grant of op.data.memberships) {
          const hospital = hospitals.find((h) => h.id === grant.hospitalId);
          checkAccess(
            hospital && grantWithinScope(actor, grant, hospital),
            403,
            'The requested role or departments exceed your authority.',
          );
        }
        checkAccess(
          targetUid !== uid,
          403,
          'Another authorised administrator must change your own access.',
        );
        const targetRef = db.doc(`profiles/${targetUid}`),
          targetDoc = await tx.get(targetRef);
        const target = targetDoc.data() as Profile | undefined;
        if (op.type === 'user-create')
          checkAccess(
            !target || prior.get('status') === 'complete',
            409,
            'An application profile already exists for this account.',
          );
        if (target) {
          checkAccess(
            !target.superUser || actor.superUser,
            403,
            'Only a Super User can manage this account.',
          );
          checkAccess(target.active, 403, 'This account is inactive. Contact a Super User.');
          for (const hospitalId of hospitalIds) {
            const old = target.memberships.find((m) => m.hospitalId === hospitalId);
            const hospital = hospitals.find((h) => h.id === hospitalId);
            // Legacy clinical grants are equivalent to Doctor for controlled migration.
            const comparable = old
              ? {
                  ...old,
                  role:
                    old.role === 'clinician'
                      ? ('doctor' as const)
                      : old.role === 'recorder'
                        ? ('nurse' as const)
                        : old.role,
                }
              : null;
            checkAccess(
              actor.superUser ||
                !comparable ||
                (hospital && grantWithinScope(actor, comparable, hospital)),
              403,
              'An administrator with wider access must change this existing grant.',
            );
          }
        }
        if (op.type === 'user-access' && op.data.removeHospitalId) {
          const hospital = hospitals.find((h) => h.id === op.data.removeHospitalId);
          const scope = hospital && effectiveMembership(actor, hospital);
          checkAccess(
            scope && canManageUsers(scope.role),
            403,
            'This hospital is outside your staff-management access.',
          );
          if (prior.get('status') === 'complete') {
            const original = prior.get('removedGrant');
            checkAccess(
              actor.superUser ||
                (original && hospital && grantWithinScope(actor, original, hospital)),
              403,
              'Your authority to remove this grant has changed.',
            );
            return { ...prior.get('result'), replayed: true };
          }
          checkAccess(
            target?.memberships.some((m) => m.hospitalId === op.data.removeHospitalId),
            404,
            'That hospital grant does not exist.',
          );
          removedGrant = target!.memberships.find(
            (m) => m.hospitalId === op.data.removeHospitalId,
          )!;
          checkAccess(
            !op.data.memberships.some((m) => m.hospitalId === op.data.removeHospitalId),
            400,
            'Choose either update or removal for a hospital.',
          );
        }
        if (prior.get('status') === 'complete') return { ...prior.get('result'), replayed: true };
        if (op.type === 'user-access')
          checkAccess(
            op.data.version === 0
              ? !target?.memberships.some((m) => hospitalIds.includes(m.hospitalId)) &&
                  !target?.superUser
              : (target?.version ?? (target ? 1 : 0)) === op.data.version,
            409,
            'This user’s access changed. Refresh before editing.',
          );
        if (op.type === 'user-create' && !finalise) {
          if (!prior.exists) tx.create(receipt, { actorId: uid, hash, status: 'reserved', at });
          return undefined;
        }
        const profile: Profile = {
          uid: targetUid!,
          name: op.type === 'user-create' ? op.data.name : (target?.name ?? op.data.email),
          email: op.data.email,
          active: true,
          superUser: actor.superUser ? op.data.superUser : !!target?.superUser,
          memberships: op.data.superUser
            ? []
            : [
                ...(target?.memberships ?? []).filter((m) => !hospitalIds.includes(m.hospitalId)),
                ...op.data.memberships,
              ],
          ...(target?.reportingGrants ? { reportingGrants: target.reportingGrants } : {}),
          version: (target ? (target.version ?? 1) : 0) + 1,
        };
        // A hospital administrator cannot turn a one-hospital System Admin into a multi-hospital account.
        checkAccess(
          !profile.memberships.some((m) => m.role.startsWith('system_admin')) ||
            profile.memberships.length === 1,
          400,
          'Use Major User for an account with access to multiple hospitals.',
        );
        before = target
          ? {
              uid: target.uid,
              memberships: visibleMemberships(actor, target, hospitals),
              superUser: !!target.superUser,
            }
          : null;
        after = {
          uid: profile.uid,
          memberships: visibleMemberships(actor, profile, hospitals),
          superUser: !!profile.superUser,
        };
        tx.set(targetRef, profile);
        for (const h of hospitals) {
          if (
            op.data.memberships.some((m) => m.hospitalId === h.id && m.role === 'doctor') &&
            !h.surgeons.includes(profile.name)
          )
            tx.update(db.doc(`hospitals/${h.id}`), {
              surgeons: [...h.surgeons, profile.name],
              version: (h.version ?? 1) + 1,
            });
        }
      } else {
        const h = hospitals[0],
          ref = db.doc(`hospitals/${op.data.hospitalId}`);
        if (op.type === 'hospital') {
          checkAccess(actor.superUser, 403, 'Only a Super User can add hospitals.');
          if (prior.get('status') === 'complete') return { ...prior.get('result'), replayed: true };
          checkAccess(!h, 409, 'That hospital identifier already exists.');
          const created: Hospital = {
            id: op.data.hospitalId,
            name: op.data.name,
            city: op.data.city,
            region: 'Africa',
            country: 'South Africa',
            province: op.data.province,
            district: op.data.district,
            departments: [],
            theatres: [],
            surgeons: [],
            version: 1,
          };
          tx.create(ref, created);
          after = created;
        } else {
          checkAccess(h, 404, 'Hospital not found.');
          const scope = effectiveMembership(actor, h);
          checkAccess(
            scope && canConfigure(scope.role),
            403,
            'Only a write administrator can configure this hospital.',
          );
          if (prior.get('status') === 'complete') return { ...prior.get('result'), replayed: true };
          checkAccess(
            (h.version ?? 1) === op.data.version,
            409,
            'Hospital settings changed. Refresh before saving.',
          );
          before = h;
          const updated = { ...h, version: (h.version ?? 1) + 1 };
          if (op.type === 'department') {
            checkAccess(h.departments.length < 100, 422, 'The department limit was reached.');
            checkAccess(
              !h.departments.some(
                (d) =>
                  d.id === op.data.departmentId ||
                  d.name.toLowerCase() === op.data.name.toLowerCase(),
              ),
              409,
              'That department already exists.',
            );
            updated.departments = [
              ...h.departments,
              { id: op.data.departmentId, name: op.data.name },
            ];
            // A limited Major User can work in the department they just created.
            const own = actor.memberships.find((m) => m.hospitalId === h.id);
            if (own && !own.departments.includes('*'))
              tx.update(actorDoc.ref, {
                memberships: actor.memberships.map((m) =>
                  m.hospitalId === h.id
                    ? { ...m, departments: [...m.departments, op.data.departmentId] }
                    : m,
                ),
                version: (actor.version ?? 1) + 1,
              });
          } else if (op.type === 'theatre-settings') {
            updated.turnaroundMinutes = op.data.turnaroundMinutes;
          } else {
            checkAccess(h.theatres.length < 100, 422, 'The theatre limit was reached.');
            checkAccess(
              !h.theatres.some((t) => t.toLowerCase() === op.data.name.toLowerCase()),
              409,
              'That theatre already exists.',
            );
            updated.theatres = [...h.theatres, op.data.name];
          }
          tx.set(ref, updated);
          after = updated;
        }
      }
      const result = { id: op.id, acceptedAt: at };
      tx.set(receipt, { actorId: uid, hash, status: 'complete', result, removedGrant });
      tx.create(db.doc(`systemAudit/${op.id}`), {
        actorId: uid,
        actor: actor.name,
        action: op.type,
        at,
        before,
        after,
      });
      return result;
    });
  }
  let result = await transact(false);
  if (op.type === 'user-create' && !result) {
    try {
      await auth.createUser({
        uid: targetUid,
        email: op.data.email,
        displayName: op.data.name,
        password: randomBytes(32).toString('base64url'),
      });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'auth/uid-already-exists' && code !== 'auth/email-already-exists') throw e;
      const existing = await auth.getUserByEmail(op.data.email);
      checkAccess(
        existing.uid === targetUid,
        409,
        'An account already uses that email. Choose Add existing user access.',
      );
    }
    result = await transact(true);
  }
  checkAccess(result, 500, 'The change could not be confirmed. Retry the same request.');
  if (op.type === 'user-create' && !result.replayed) {
    // Only a newly created identity receives a setup link. Never expose password
    // reset links for existing users, including privileged accounts.
    try {
      return { ...result, setupLink: await auth.generatePasswordResetLink(op.data.email) };
    } catch {
      return result;
    }
  }
  return result;
}
