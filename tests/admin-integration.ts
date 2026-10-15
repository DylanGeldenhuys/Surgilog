import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { auth, db, projectId } from '../apps/api/firebase.ts';
import type { Hospital, Profile, Role } from '../shared/domain.ts';

assert.equal(projectId, 'demo-theatre-tracker');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
const prefix = `admin-test-${randomUUID()}`,
  hid = prefix,
  other = `${prefix}-other`,
  added = `${prefix}-new`;
const users: string[] = [],
  ops: string[] = [],
  tokens: Record<string, string> = {};
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  console.log(`PASS ${name}`);
  passed++;
}
async function request(who: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:8787${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[who] ? { Authorization: `Bearer ${tokens[who]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: (await response.json()) as any };
}
function operation<T>(type: string, data: T) {
  const id = randomUUID();
  ops.push(id);
  return { id, type, data };
}
const admin = (who: string, op: unknown) => request(who, '/api/admin/operations', op);
function expect(result: { status: number; data: any }, status: number) {
  assert.equal(result.status, status, JSON.stringify(result.data));
}
const grant = (role: string, hospitalId = hid, departments = ['general']) => ({
  hospitalId,
  role,
  departments,
});
const account = (key: string) => `${prefix}-${key}`;
const email = (key: string) => `${account(key)}@test.invalid`;
const now = new Date().toISOString(),
  ago = new Date(Date.now() - 3600000).toISOString();
const clinical = (type: string, data: any) => ({
  ...operation(type, data),
  occurredAt: now,
  recordedAt: now,
});
const send = (who: string, op: unknown) => request(who, `/api/hospitals/${hid}/operations`, op);
try {
  const hospital: Hospital = {
    id: hid,
    name: 'Synthetic admin test',
    city: 'Test',
    region: 'Africa',
    country: 'South Africa',
    province: 'Western Cape',
    district: 'Test',
    departments: [
      { id: 'general', name: 'General' },
      { id: 'private', name: 'Private' },
    ],
    theatres: ['T1'],
    surgeons: ['Dr Test'],
    version: 1,
  };
  await db.doc(`hospitals/${hid}`).set(hospital);
  await db.doc(`hospitals/${other}`).set({ ...hospital, id: other });
  for (const role of [
    'super_user',
    'major_write',
    'major_read',
    'system_admin_write',
    'system_admin_read',
    'doctor',
    'nurse',
    'clerk',
  ] as Role[]) {
    const uid = account(role);
    users.push(uid);
    await auth.createUser({ uid, email: email(role), password: 'SyntheticTest!26' });
    const profile: Profile = {
      uid,
      name: `Test ${role}`,
      email: email(role),
      active: true,
      version: 1,
      superUser: role === 'super_user',
      memberships:
        role === 'super_user'
          ? []
          : [
              {
                hospitalId: hid,
                role,
                departments:
                  role.startsWith('system_admin') || role.startsWith('major') ? ['*'] : ['general'],
              },
              ...(role.startsWith('major')
                ? [{ hospitalId: other, role, departments: ['general'] }]
                : []),
            ],
    };
    await db.doc(`profiles/${uid}`).set(profile);
    const r = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-theatre-tracker',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email(role),
          password: 'SyntheticTest!26',
          returnSecureToken: true,
        }),
      },
    );
    tokens[role] = ((await r.json()) as any).idToken;
    assert.ok(tokens[role]);
  }
  await check('admin read access and direct API denial for nurses/clerks', async () => {
    expect(await request('', '/api/admin'), 401);
    for (const role of ['nurse', 'clerk']) expect(await request(role, '/api/admin'), 403);
    for (const role of ['major_read', 'system_admin_read', 'doctor'])
      expect(await request(role, '/api/admin'), 200);
    const doctor = await request('doctor', '/api/admin');
    assert.deepEqual(
      doctor.data.hospitals.map((h: any) => h.id),
      [hid],
    );
    assert.deepEqual(
      doctor.data.hospitals[0].departments.map((d: any) => d.id),
      ['general'],
    );
    assert.equal(
      doctor.data.users.some((u: any) => u.superUser),
      false,
    );
  });
  const hospitalOp = operation('hospital', {
    hospitalId: added,
    name: 'New synthetic hospital',
    city: 'Test city',
    province: 'Test province',
    district: 'Test district',
  });
  await check(
    'only Super User creates hospitals; idempotent audit and dynamic global access',
    async () => {
      for (const role of ['major_write', 'system_admin_write', 'doctor', 'system_admin_read'])
        expect(await admin(role, hospitalOp), 403);
      expect(await admin('super_user', hospitalOp), 200);
      assert.equal((await admin('super_user', hospitalOp)).data.replayed, true);
      expect(
        await admin('super_user', {
          ...hospitalOp,
          data: { ...(hospitalOp.data as object), name: 'Different' },
        }),
        409,
      );
      const identity = await request('super_user', '/api/me');
      expect(identity, 200);
      assert.ok(identity.data.hospitals.some((h: any) => h.id === added));
      assert.ok((await db.doc(`systemAudit/${hospitalOp.id}`).get()).exists);
      expect(
        await request(
          'system_admin_write',
          `/api/hospitals/${other}/workspace?departmentId=general`,
        ),
        403,
      );
      expect(
        await request('major_write', `/api/hospitals/${other}/workspace?departmentId=private`),
        403,
      );
    },
  );
  await check('hospital setup bounds, version conflicts and duplicate names', async () => {
    const dep = operation('department', {
      hospitalId: hid,
      departmentId: 'new-dept',
      name: 'New department',
      version: 1,
    });
    for (const role of ['doctor', 'nurse', 'major_read', 'system_admin_read'])
      expect(await admin(role, dep), 403);
    expect(await admin('system_admin_write', dep), 200);
    expect(
      await admin(
        'system_admin_write',
        operation('department', { ...(dep.data as object), departmentId: 'another' }),
      ),
      409,
    );
    const theatre = operation('theatre', { hospitalId: hid, name: 'Theatre 2', version: 2 });
    expect(await admin('major_write', theatre), 200);
    expect(
      await admin(
        'major_write',
        operation('theatre', { hospitalId: hid, name: 'theatre 2', version: 3 }),
      ),
      409,
    );
    const identity = await request('system_admin_write', '/api/me');
    assert.ok(identity.data.profile.memberships[0].departments.includes('new-dept'));
  });
  const userOp = operation('user-create', {
    name: 'Dr Newly Created',
    email: `new-${prefix}@test.invalid`,
    superUser: false,
    memberships: [grant('doctor')],
  });
  const newUid = `staff-${userOp.id}`;
  users.push(newUid);
  await check(
    'doctor creates department staff; password setup only for new identities',
    async () => {
      expect(
        await admin(
          'doctor',
          operation('user-create', {
            ...(userOp.data as object),
            superUser: true,
            memberships: [],
          }),
        ),
        403,
      );
      expect(
        await admin(
          'doctor',
          operation('user-create', {
            ...(userOp.data as object),
            memberships: [grant('system_admin_write', hid, ['*'])],
          }),
        ),
        403,
      );
      expect(
        await admin(
          'doctor',
          operation('user-create', {
            ...(userOp.data as object),
            memberships: [grant('doctor', hid, ['private'])],
          }),
        ),
        403,
      );
      const result = await admin('doctor', userOp);
      expect(result, 200);
      assert.ok(result.data.setupLink);
      const replay = await admin('doctor', userOp);
      assert.equal(replay.data.replayed, true);
      assert.equal(replay.data.setupLink, undefined);
      const profile = (await db.doc(`profiles/${newUid}`).get()).data()!;
      assert.deepEqual(profile.memberships, [grant('doctor')]);
      assert.ok(
        (await db.doc(`hospitals/${hid}`).get()).get('surgeons').includes('Dr Newly Created'),
      );
      const receipt = (await db.doc(`adminOperations/${userOp.id}`).get()).data()!;
      assert.equal(JSON.stringify(receipt).includes('oobCode'), false);
      expect(
        await admin(
          'doctor',
          operation('user-create', { ...(userOp.data as object), email: email('super_user') }),
        ),
        409,
      );
      const forbidden = operation('user-access', {
        email: email('super_user'),
        version: 1,
        superUser: false,
        memberships: [grant('doctor')],
      });
      expect(await admin('doctor', forbidden), 403);
    },
  );
  await check(
    'grant editing cannot escalate, replace wider scopes or edit own access',
    async () => {
      expect(
        await admin(
          'doctor',
          operation('user-access', {
            email: email('doctor'),
            version: 1,
            superUser: false,
            memberships: [grant('nurse')],
          }),
        ),
        403,
      );
      expect(
        await admin(
          'system_admin_write',
          operation('user-access', {
            email: email('major_write'),
            version: 1,
            superUser: false,
            memberships: [grant('system_admin_write', hid, ['*'])],
          }),
        ),
        403,
      );
      expect(
        await admin(
          'major_write',
          operation('user-create', {
            name: 'Out of scope',
            email: `out-${prefix}@test.invalid`,
            superUser: false,
            memberships: [grant('major_write', other, ['*'])],
          }),
        ),
        403,
      );
      const change = operation('user-access', {
        email: `new-${prefix}@test.invalid`,
        version: 1,
        superUser: false,
        memberships: [grant('nurse')],
      });
      expect(await admin('doctor', change), 200);
      expect(
        await admin(
          'doctor',
          operation('user-access', { ...(change.data as object), memberships: [grant('clerk')] }),
        ),
        409,
      );
      const remove = operation('user-access', {
        email: `new-${prefix}@test.invalid`,
        version: 2,
        superUser: false,
        memberships: [],
        removeHospitalId: hid,
      });
      expect(await admin('doctor', remove), 200);
      assert.equal((await admin('doctor', remove)).data.replayed, true);
      assert.deepEqual((await db.doc(`profiles/${newUid}`).get()).get('memberships'), []);
      const legacyRef = db.doc(`profiles/${account('clerk')}`),
        legacy = (await legacyRef.get()).data()!;
      delete legacy.version;
      await legacyRef.set(legacy);
      const legacyChange = operation('user-access', {
        email: email('clerk'),
        version: 1,
        superUser: false,
        memberships: [grant('clerk')],
      });
      expect(await admin('doctor', legacyChange), 200);
      assert.equal((await legacyRef.get()).get('version'), 2);
      expect(await admin('doctor', operation('user-access', legacyChange.data)), 409);
    },
  );
  const registration = clinical('register', {
    caseId: 'nurse-case',
    patientRef: 'NURSE-TEST',
    patientName: 'Synthetic nurse registration',
    dob: '1980-01-01',
    gender: 'Not recorded',
    phone: '',
    departmentId: 'general',
    procedure: 'Synthetic surgery',
    surgeon: 'Dr Test',
    priority: 'P2',
    priorityAssignedBy: 'Dr Test',
    listedAt: ago,
    urgencyAt: ago,
    readiness: 'Needs assessment',
    notes: '',
  });
  await check(
    'nurse registration and patient edits, clinical restrictions and readonly data',
    async () => {
      for (const role of ['major_read', 'system_admin_read'])
        expect(await send(role, registration), 403);
      expect(await send('nurse', registration), 200);
      expect(
        await send(
          'clerk',
          clinical('case-notes', {
            caseId: 'nurse-case',
            version: 1,
            notes: 'Recorded observation',
            reason: 'Routine record',
          }),
        ),
        200,
      );
      expect(
        await send(
          'clerk',
          clinical('patient', {
            caseId: 'nurse-case',
            patientId: `pat-${registration.id}`,
            version: 1,
            name: 'Synthetic updated',
            dob: '1980-01-01',
            gender: 'Not recorded',
            phone: '',
            reason: 'Correct transcription',
          }),
        ),
        200,
      );
      for (const role of ['nurse', 'clerk']) {
        expect(
          await send(
            role,
            clinical('priority', {
              caseId: 'nurse-case',
              version: 2,
              priority: 'P1',
              reason: 'Cannot assign',
            }),
          ),
          403,
        );
        expect(
          await send(
            role,
            clinical('readiness', {
              caseId: 'nurse-case',
              version: 2,
              readiness: 'Ready',
              reason: 'Cannot approve',
            }),
          ),
          403,
        );
        expect(
          await send(
            role,
            clinical('book', { caseId: 'nurse-case', version: 2, sessionId: 'none', duration: 60 }),
          ),
          403,
        );
        expect(
          await send(
            role,
            clinical('activity', {
              caseId: 'nurse-case',
              version: 2,
              bookingId: 'none',
              kind: 'cancel',
              reason: 'Cannot cancel',
            }),
          ),
          403,
        );
      }
      expect(
        await send(
          'system_admin_write',
          clinical('priority', {
            caseId: 'nurse-case',
            version: 2,
            priority: 'P1',
            reason: 'Admin clinical authority',
          }),
        ),
        200,
      );
      const read = await request(
        'system_admin_read',
        `/api/hospitals/${hid}/workspace?departmentId=general`,
      );
      expect(read, 200);
      assert.equal(read.data.patients.length, 1);
      const noSource = { ...registration.data };
      delete noSource.priorityAssignedBy;
      expect(
        await send(
          'nurse',
          clinical('register', { ...noSource, caseId: 'missing-source', patientRef: 'MISSING' }),
        ),
        403,
      );
    },
  );
  await check(
    'replayed mutations recheck revoked permissions and retain audit results',
    async () => {
      await db.doc(`profiles/${account('doctor')}`).update({ memberships: [] });
      expect(await admin('doctor', userOp), 403);
      await db.doc(`profiles/${account('nurse')}`).update({ memberships: [] });
      expect(await send('nurse', registration), 403);
      assert.equal((await db.doc(`hospitals/${hid}/cases/nurse-case`).get()).get('priority'), 'P1');
    },
  );
  console.log(`${passed} administration integration scenarios passed.`);
} finally {
  for (const hospitalId of [hid, other, added])
    await db.recursiveDelete(db.doc(`hospitals/${hospitalId}`));
  for (const uid of users) {
    await db.doc(`profiles/${uid}`).delete();
    await auth.deleteUser(uid).catch(() => {});
  }
  for (const id of ops) {
    await db.doc(`adminOperations/${id}`).delete();
    await db.doc(`systemAudit/${id}`).delete();
  }
}
