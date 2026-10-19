import { saveTheatreEntry } from './theatre.ts';
import type { TheatreEntry } from '../../shared/theatre.ts';
import { createHash } from 'node:crypto';
import { db } from './firebase.ts';
import {
  dueDate,
  metrics,
  operationSchema,
  canClinical,
  canOperate,
  effectiveMembership,
  saDay,
  compareInstants,
  backlogOrder,
  type Operation,
  type OperationResult,
  type Profile,
  type Membership,
  type Hospital,
  type Identity,
  type ReportingGrant,
  type SurgicalCase,
  type Patient,
  type TheatreSession,
  type Booking,
  type Workspace,
  type ReportingWorkspace,
  type ReportingDepartmentSelection,
  overlaps,
  nextAvailableStart,
  turnaroundMinutes,
} from '../../shared/domain.ts';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
function requireThat(value: unknown, status: number, message: string): asserts value {
  if (!value) throw new ApiError(status, message);
}
const validId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);
export async function profileFor(uid: string) {
  const s = await db.doc(`profiles/${uid}`).get();
  const p = s.data() as Profile | undefined;
  requireThat(p?.active, 403, 'Your access is inactive. Contact your hospital administrator.');
  return p;
}
function access(p: Profile, hospital: Hospital): Membership {
  const m = effectiveMembership(p, hospital);
  requireThat(p.active && m, 403, 'You do not have access to this hospital.');
  return m;
}
function department(m: Membership, dep: string) {
  requireThat(m.departments.includes(dep), 403, 'This department is outside your access.');
}
function reportingGrantMatches(hospital: Hospital, grant: ReportingGrant) {
  if (grant.role === 'global_viewer') return true;
  if (!grant.region || hospital.region !== grant.region) return false;
  if (grant.role === 'regional_viewer') return true;
  if (!grant.country || hospital.country !== grant.country) return false;
  if (grant.role === 'country_viewer') return true;
  if (!grant.province || hospital.province !== grant.province) return false;
  if (grant.role === 'state_viewer') return true;
  return !!grant.district && hospital.district === grant.district;
}
function reportingBoundary(profile: Profile) {
  if (profile.memberships.length || profile.reportingGrants?.length !== 1)
    return 'All authorised hospitals';
  const grant = profile.reportingGrants[0];
  if (grant.role === 'global_viewer') return 'Global reporting scope';
  if (grant.role === 'regional_viewer') return grant.region!;
  if (grant.role === 'country_viewer') return grant.country!;
  if (grant.role === 'state_viewer') return grant.province!;
  return grant.district!;
}
type ResolvedReportingAccess = {
  hospital: Hospital;
  departments: string[];
};
export async function resolvedReportingAccess(
  profile: Profile,
): Promise<ResolvedReportingAccess[]> {
  const grants = profile.reportingGrants ?? [],
    snapshots =
      grants.length || profile.superUser
        ? (await db.collection('hospitals').limit(501).get()).docs
        : (
            await Promise.all(
              profile.memberships.map((membership) =>
                db.doc(`hospitals/${membership.hospitalId}`).get(),
              ),
            )
          ).filter((snapshot) => snapshot.exists);
  requireThat(snapshots.length <= 500, 422, 'The reporting hospital limit was reached.');
  const hospitals = snapshots.map((snapshot) => snapshot.data() as Hospital),
    byHospital = new Map<string, Set<string>>();
  for (const hospital of hospitals) {
    const membership = effectiveMembership(profile, hospital);
    if (!membership) continue;
    const departments = byHospital.get(hospital.id) ?? new Set<string>();
    membership.departments.forEach((item) => departments.add(item));
    byHospital.set(hospital.id, departments);
  }
  for (const grant of grants)
    for (const hospital of hospitals)
      if (reportingGrantMatches(hospital, grant))
        byHospital.set(
          hospital.id,
          new Set(hospital.departments.map((department) => department.id)),
        );
  return [...byHospital.entries()]
    .map(([hospitalId, departments]) => ({
      hospital: hospitals.find((item) => item.id === hospitalId)!,
      departments: [...departments],
    }))
    .filter((item) => item.hospital)
    .sort((a, b) => a.hospital.name.localeCompare(b.hospital.name));
}
export async function me(uid: string): Promise<Identity> {
  const profile = await profileFor(uid);
  const reporting = await resolvedReportingAccess(profile);
  requireThat(
    profile.superUser || reporting.length,
    403,
    'No hospital or reporting scope is assigned to this account.',
  );
  return {
    profile: {
      ...profile,
      memberships: reporting.flatMap((item) => {
        const grant = effectiveMembership(profile, item.hospital);
        return grant ? [grant] : [];
      }),
    },
    hospitals: reporting.map((item) => item.hospital),
    reportingAccess: reporting.map((item) => ({
      hospitalId: item.hospital.id,
      departments: item.departments,
    })),
  };
}
export async function workspace(uid: string, hid: string, dep: string): Promise<Workspace> {
  requireThat(validId(hid) && validId(dep), 400, 'Invalid hospital or department.');
  const p = await profileFor(uid);
  const h = db.doc(`hospitals/${hid}`),
    hs = await h.get();
  requireThat(hs.exists, 404, 'Hospital not found.');
  const m = access(p, hs.data() as Hospital);
  department(m, dep);
  const [cs, ss, bs] = await Promise.all(
    ['cases', 'sessions', 'bookings'].map((name) =>
      h.collection(name).where('departmentId', '==', dep).limit(1001).get(),
    ),
  );
  requireThat(
    cs.size <= 1000 && ss.size <= 1000 && bs.size <= 1000,
    422,
    'The local pilot dataset limit was reached. Archive/filter the working set before continuing.',
  );
  const cases = cs.docs.map((d) => d.data() as SurgicalCase),
    sessions = ss.docs.map((d) => d.data() as TheatreSession),
    bookings = bs.docs.map((d) => d.data() as Booking);
  const register =
    m.role === 'viewer'
      ? null
      : await h
          .collection('theatreEntries')
          .where('departmentId', '==', dep)
          .orderBy('operationDate', 'desc')
          .limit(501)
          .get();
  const report = metrics(cases, sessions, bookings),
    prioritised = [...cases]
      .sort(
        (a, b) =>
          Number(['Completed', 'Closed'].includes(a.status)) -
            Number(['Completed', 'Closed'].includes(b.status)) || backlogOrder(a, b),
      )
      .slice(0, 250);
  // Every returned booking needs its case/patient, even outside the prepared backlog page.
  const included = new Set([...prioritised.map((c) => c.id), ...bookings.map((b) => b.caseId)]);
  const visible = cases.filter((c) => included.has(c.id));
  const patientIds = [...new Set(visible.map((c) => c.patientId))];
  const patients =
    m.role === 'viewer' || !patientIds.length
      ? []
      : (await db.getAll(...patientIds.map((id) => h.collection('patients').doc(id))))
          .filter((d) => d.exists)
          .map((d) => {
            const patient = d.data() as Patient;
            return { ...patient, version: patient.version ?? 1 };
          });
  const asOf = new Date().toISOString();
  await h.collection('audit').add({
    actorId: uid,
    actor: p.name,
    action: 'workspace.read',
    departmentId: dep,
    caseId: null,
    at: asOf,
    occurredAt: asOf,
    recordedAt: asOf,
    reason: '',
    before: null,
    after: null,
  });
  return {
    hospital: hs.data() as Hospital,
    departmentId: dep,
    patients,
    cases: m.role === 'viewer' ? [] : visible,
    sessions: m.role === 'viewer' ? [] : sessions,
    bookings: m.role === 'viewer' ? [] : bookings,
    metrics: report,
    asOf,
    truncated: cases.length > visible.length,
    theatreEntries: register?.docs.slice(0, 500).map((d) => d.data() as TheatreEntry) ?? [],
    theatreEntriesTruncated: (register?.size ?? 0) > 500,
  };
}

type DepartmentDataset = {
  hospital: Hospital;
  departmentId: string;
  departmentName: string;
  cases: SurgicalCase[];
  sessions: TheatreSession[];
  bookings: Booking[];
};

async function reportingDepartment(hospital: Hospital, departmentId: string) {
  const departmentRecord = hospital.departments.find((item) => item.id === departmentId);
  requireThat(departmentRecord, 404, 'Department not found.');
  const h = db.doc(`hospitals/${hospital.id}`),
    [cs, ss, bs] = await Promise.all(
      ['cases', 'sessions', 'bookings'].map((name) =>
        h.collection(name).where('departmentId', '==', departmentId).limit(1001).get(),
      ),
    );
  requireThat(
    cs.size <= 1000 && ss.size <= 1000 && bs.size <= 1000,
    422,
    'The reporting scope exceeds the local pilot dataset limit.',
  );
  return {
    hospital,
    departmentId,
    departmentName: departmentRecord.name,
    cases: cs.docs.map((item) => item.data() as SurgicalCase),
    sessions: ss.docs.map((item) => item.data() as TheatreSession),
    bookings: bs.docs.map((item) => item.data() as Booking),
  } satisfies DepartmentDataset;
}

function combinedMetrics(datasets: DepartmentDataset[], now: string) {
  const cases: SurgicalCase[] = [],
    sessions: TheatreSession[] = [],
    bookings: Booking[] = [];
  for (const dataset of datasets) {
    const prefix = `${dataset.hospital.id}/`;
    cases.push(
      ...dataset.cases.map((item) => ({
        ...item,
        id: `${prefix}${item.id}`,
        patientId: `${prefix}${item.patientId}`,
      })),
    );
    sessions.push(
      ...dataset.sessions.map((item) => ({
        ...item,
        id: `${prefix}${item.id}`,
      })),
    );
    bookings.push(
      ...dataset.bookings.map((item) => ({
        ...item,
        id: `${prefix}${item.id}`,
        caseId: `${prefix}${item.caseId}`,
        sessionId: `${prefix}${item.sessionId}`,
      })),
    );
  }
  return metrics(cases, sessions, bookings, now);
}

export async function reportingWorkspace(
  uid: string,
  requestedHospitals: string[] | null,
  requestedDepartments: ReportingDepartmentSelection[] | null,
): Promise<ReportingWorkspace> {
  requireThat(
    !requestedDepartments || requestedHospitals,
    400,
    'Select hospitals before selecting departments.',
  );
  requireThat(
    !requestedHospitals || (requestedHospitals.length > 0 && requestedHospitals.length <= 100),
    400,
    'Select between 1 and 100 hospitals.',
  );
  requireThat(
    !requestedDepartments ||
      (requestedDepartments.length > 0 && requestedDepartments.length <= 500),
    400,
    'Select between 1 and 500 departments.',
  );
  for (const hospitalId of requestedHospitals ?? [])
    requireThat(validId(hospitalId), 400, 'Invalid hospital.');
  for (const selection of requestedDepartments ?? [])
    requireThat(
      validId(selection.hospitalId) && validId(selection.departmentId),
      400,
      'Invalid department selection.',
    );

  const profile = await profileFor(uid),
    available = await resolvedReportingAccess(profile),
    requestedHospitalIds = [...new Set(requestedHospitals ?? [])],
    authorised = requestedHospitals
      ? available.filter((item) => requestedHospitalIds.includes(item.hospital.id))
      : available;
  requireThat(
    authorised.length && (!requestedHospitals || authorised.length === requestedHospitalIds.length),
    403,
    'One or more hospitals are outside your reporting access.',
  );
  const requestedDepartmentKeys = new Set(
      (requestedDepartments ?? []).map(
        (selection) => `${selection.hospitalId}/${selection.departmentId}`,
      ),
    ),
    authorisedDepartmentKeys = new Set(
      authorised.flatMap((grant) =>
        grant.departments.map((departmentId) => `${grant.hospital.id}/${departmentId}`),
      ),
    );
  requireThat(
    !requestedDepartments ||
      [...requestedDepartmentKeys].every((key) => authorisedDepartmentKeys.has(key)),
    403,
    'One or more departments are outside your reporting access.',
  );
  const selectedDepartments = authorised.flatMap((grant) => {
    const departmentIds = requestedDepartments
      ? grant.departments.filter((departmentId) =>
          requestedDepartmentKeys.has(`${grant.hospital.id}/${departmentId}`),
        )
      : grant.departments;
    requireThat(
      departmentIds.length,
      400,
      `Select at least one department for ${grant.hospital.name}.`,
    );
    return departmentIds.map((departmentId) => ({
      hospitalId: grant.hospital.id,
      departmentId,
    }));
  });
  const hospitals = authorised.map((item) => item.hospital);
  const datasets = (
    await Promise.all(
      authorised.flatMap((grant) => {
        const departmentIds = selectedDepartments
          .filter((selection) => selection.hospitalId === grant.hospital.id)
          .map((selection) => selection.departmentId);
        return departmentIds.map((departmentId) =>
          reportingDepartment(grant.hospital, departmentId),
        );
      }),
    )
  ).flat();
  const asOf = new Date().toISOString(),
    report = combinedMetrics(datasets, asOf),
    summaries =
      requestedHospitals === null
        ? hospitals.map((hospital) => {
            const hospitalDatasets = datasets.filter(
              (dataset) => dataset.hospital.id === hospital.id,
            );
            return {
              hospitalId: hospital.id,
              hospitalName: hospital.name,
              departmentId: null,
              departmentName: null,
              metrics: combinedMetrics(hospitalDatasets, asOf),
            };
          })
        : hospitals.length === 1
          ? requestedDepartments !== null && datasets.length === 1
            ? []
            : datasets.map((dataset) => ({
                hospitalId: dataset.hospital.id,
                hospitalName: dataset.hospital.name,
                departmentId: dataset.departmentId,
                departmentName: dataset.departmentName,
                metrics: combinedMetrics([dataset], asOf),
              }))
          : hospitals.map((hospital) => {
              const hospitalDatasets = datasets.filter(
                (dataset) => dataset.hospital.id === hospital.id,
              );
              return {
                hospitalId: hospital.id,
                hospitalName: hospital.name,
                departmentId: null,
                departmentName: null,
                metrics: combinedMetrics(hospitalDatasets, asOf),
              };
            }),
    fullScope =
      authorised.length === available.length &&
      selectedDepartments.length ===
        available.reduce((count, grant) => count + grant.departments.length, 0);

  await Promise.all(
    hospitals.map((hospital) =>
      db
        .doc(`hospitals/${hospital.id}`)
        .collection('audit')
        .add({
          actorId: uid,
          actor: profile.name,
          action: 'report.read',
          departmentId:
            selectedDepartments.filter((item) => item.hospitalId === hospital.id).length === 1
              ? selectedDepartments.find((item) => item.hospitalId === hospital.id)!.departmentId
              : '*',
          caseId: null,
          at: asOf,
          occurredAt: asOf,
          recordedAt: asOf,
          reason: '',
          before: null,
          after: null,
        }),
    ),
  );

  const scopeHospital = requestedHospitals !== null && hospitals.length === 1 ? hospitals[0] : null,
    scopeDepartment =
      scopeHospital && selectedDepartments.length === 1
        ? scopeHospital.departments.find((item) => item.id === selectedDepartments[0].departmentId)
        : null,
    selectedDepartmentCount = selectedDepartments.length;
  return {
    scope: {
      hospitalId: scopeHospital?.id ?? null,
      departmentId: scopeDepartment?.id ?? null,
      hospitalIds: hospitals.map((hospital) => hospital.id),
      departments: selectedDepartments,
      label: scopeDepartment
        ? `${scopeHospital!.name} · ${scopeDepartment.name}`
        : scopeHospital
          ? `${scopeHospital.name} · ${selectedDepartmentCount} departments selected`
          : fullScope
            ? reportingBoundary(profile)
            : `${hospitals.length} hospitals · ${selectedDepartmentCount} departments selected`,
    },
    metrics: report,
    summaries,
    asOf,
  };
}
export async function caseHistory(uid: string, hid: string, cid: string) {
  requireThat(validId(hid) && validId(cid), 400, 'Invalid identifier.');
  const p = await profileFor(uid);
  const hospital = (await db.doc(`hospitals/${hid}`).get()).data() as Hospital | undefined;
  requireThat(hospital, 404, 'Hospital not found.');
  const m = access(p, hospital);
  requireThat(m.role !== 'viewer', 403, 'Patient history is restricted.');
  const h = db.doc(`hospitals/${hid}`),
    c = (await h.collection('cases').doc(cid).get()).data() as SurgicalCase | undefined;
  requireThat(c, 404, 'Case not found.');
  department(m, c.departmentId);
  const s = await h
    .collection('audit')
    .where('caseId', '==', cid)
    .orderBy('at', 'desc')
    .limit(100)
    .get();
  return s.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a: any, b: any) => compareInstants(b.at, a.at));
}
export async function execute(uid: string, hid: string, input: unknown) {
  requireThat(validId(hid), 400, 'Invalid hospital.');
  const op = operationSchema.parse(input);
  const now = new Date().toISOString();
  requireThat(
    +new Date(op.occurredAt) <= Date.now() + 5 * 60000,
    422,
    'Event time is in the future. Check the device clock.',
  );
  requireThat(
    +new Date(op.recordedAt) <= Date.now() + 5 * 60000 &&
      +new Date(op.occurredAt) <= +new Date(op.recordedAt) + 5 * 60000,
    422,
    'Recording time is inconsistent. Check the device clock.',
  );
  if (op.type === 'theatre-entry') return saveTheatreEntry(uid, hid, op);
  const hash = createHash('sha256').update(JSON.stringify(op)).digest('hex');
  const h = db.doc(`hospitals/${hid}`),
    receipt = h.collection('receipts').doc(op.id);
  return db.runTransaction(async (tx) => {
    const [ps, hs, prior] = await tx.getAll(db.doc(`profiles/${uid}`), h, receipt);
    const p = ps.data() as Profile | undefined;
    requireThat(p?.active, 403, 'Your hospital access is inactive.');
    const hospital = hs.data() as Hospital | undefined;
    requireThat(hospital, 404, 'Hospital not found.');
    const m = access(p, hospital);
    const permission = canOperate(m.role, op);
    requireThat(permission, 403, 'Your role cannot make this change.');
    if (prior.exists) {
      const r = prior.data()!;
      requireThat(
        r.uid === uid && r.hash === hash,
        409,
        'Operation ID already belongs to different input.',
      );
      department(m, r.departmentId);
      return { ...r.result, replayed: true };
    }
    const changes: NonNullable<OperationResult['changes']> = {};
    let cid: string | null = null,
      dep = '',
      before: unknown = null,
      after: unknown = null,
      reason = '';
    if (op.type === 'register') {
      const d = op.data;
      dep = d.departmentId;
      department(m, dep);
      requireThat(
        canClinical(m.role) || !!d.priorityAssignedBy,
        403,
        'Record the doctor who assigned this initial priority.',
      );
      requireThat(
        canClinical(m.role) || d.readiness === 'Needs assessment',
        403,
        'A doctor must approve readiness after registration.',
      );
      requireThat(
        hospital.departments.some((x) => x.id === dep),
        400,
        'Unknown department.',
      );
      requireThat(
        +new Date(d.listedAt) <= Date.now() && +new Date(d.urgencyAt) <= Date.now(),
        422,
        'Listing and assessment dates cannot be in the future.',
      );
      requireThat(!d.dob || d.dob <= saDay(now), 422, 'Date of birth cannot be in the future.');
      const reference = d.patientRef.trim().toUpperCase(),
        refId = createHash('sha256').update(reference).digest('hex');
      const registry = h.collection('patientRefs').doc(refId),
        cs = h.collection('cases').doc(d.caseId);
      const [existing, existingCase] = await tx.getAll(registry, cs);
      requireThat(!existingCase.exists, 409, 'This case ID already exists.');
      const patientId = existing.exists
        ? existing.data()!.patientId
        : (d.patientId ?? `pat-${op.id}`);
      const patientRef = h.collection('patients').doc(patientId),
        previousPatient = await tx.get(patientRef);
      if (existing.exists) {
        const pat = previousPatient.data() as Patient;
        requireThat(
          pat.name.toLowerCase() === d.patientName.trim().toLowerCase() && pat.dob === d.dob,
          409,
          'That hospital reference belongs to different patient details. Review before linking.',
        );
        const related = await tx.get(h.collection('cases').where('patientId', '==', patientId));
        requireThat(
          related.docs.every((c) => m.departments.includes(c.data().departmentId)),
          403,
          'This patient requires authorised cross-department review.',
        );
        requireThat(
          !related.docs.some(
            (c) =>
              c.data().procedure.toLowerCase() === d.procedure.toLowerCase() &&
              !['Completed', 'Closed'].includes(c.data().status),
          ),
          409,
          'An active case for this patient and procedure already exists.',
        );
      } else requireThat(!previousPatient.exists, 409, 'Patient identifier already exists.');
      const patient: Patient = {
        id: patientId,
        ref: reference,
        name: d.patientName,
        dob: d.dob,
        gender: d.gender,
        phone: d.phone,
        version: 1,
      };
      const c: SurgicalCase = {
        id: d.caseId,
        patientId,
        departmentId: dep,
        procedure: d.procedure,
        surgeon: d.surgeon,
        priority: d.priority,
        ...(d.priorityAssignedBy ? { priorityAssignedBy: d.priorityAssignedBy } : {}),
        priorityHistory: [{ priority: d.priority, at: d.listedAt }],
        listedAt: d.listedAt,
        urgencyAt: d.urgencyAt,
        dueAt: dueDate(d.urgencyAt, d.priority),
        readiness: d.readiness,
        duration: null,
        notes: d.notes,
        status: 'Waiting',
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      if (!existing.exists) {
        tx.create(patientRef, patient);
        tx.create(registry, { patientId });
      }
      tx.create(cs, c);
      changes.patient = existing.exists ? (previousPatient.data() as Patient) : patient;
      changes.surgicalCase = c;
      cid = c.id;
      after = c;
    } else if (op.type === 'session') {
      const d = op.data;
      dep = d.departmentId;
      department(m, dep);
      requireThat(
        hospital.theatres.includes(d.theatre) && hospital.surgeons.includes(d.surgeon),
        400,
        'Select a configured theatre and surgeon.',
      );
      requireThat(
        +new Date(d.end) > +new Date(d.start) &&
          +new Date(d.end) - +new Date(d.start) <= 12 * 3600000,
        422,
        'Session must be between 1 minute and 12 hours.',
      );
      requireThat(
        saDay(d.start) === d.date && saDay(d.end) === d.date,
        422,
        'Session must start and end on its local date.',
      );
      const guard = h.collection('guards').doc(d.date),
        sr = h.collection('sessions').doc(d.sessionId);
      const [gs, existing] = await tx.getAll(guard, sr);
      requireThat(!existing.exists, 409, 'Session already exists.');
      const sessions = await tx.get(h.collection('sessions').where('date', '==', d.date));
      const conflicts = sessions.docs
        .map((s) => s.data() as TheatreSession)
        .filter(
          (x) =>
            (x.theatre === d.theatre || x.surgeon === d.surgeon) &&
            overlaps(d.start, d.end, x.start, x.end),
        )
        .sort((a, b) => compareInstants(a.start, b.start));
      if (conflicts.length) {
        const clock = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Johannesburg',
          hour: '2-digit',
          minute: '2-digit',
          hourCycle: 'h23',
        });
        const date = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Africa/Johannesburg',
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        });
        const details = conflicts.slice(0, 3).map((conflict) => {
          const resources = [
            ...(conflict.theatre === d.theatre ? [d.theatre] : []),
            ...(conflict.surgeon === d.surgeon ? [d.surgeon] : []),
          ];
          // Explain a resource clash without exposing an ungranted department's
          // session ID, other staff, bookings or patient information.
          const scope = m.departments.includes(conflict.departmentId)
            ? (hospital.departments.find((item) => item.id === conflict.departmentId)?.name ??
              'an authorised department')
            : 'another department';
          return `${resources.join(' and ')} ${resources.length === 1 ? 'is' : 'are'} already reserved in ${scope} on ${date.format(new Date(conflict.start))}, ${clock.format(new Date(conflict.start))}–${clock.format(new Date(conflict.end))} SAST.`;
        });
        throw new ApiError(
          409,
          `${details.join(' ')} A session reserves this time even when no patients are booked. Choose another resource or a non-overlapping time.`,
        );
      }
      const s: TheatreSession = { id: d.sessionId, ...d, version: 1 };
      tx.create(sr, s);
      tx.set(guard, { version: (gs.data()?.version ?? 0) + 1 });
      after = s;
    } else {
      cid = op.data.caseId;
      const cr = h.collection('cases').doc(cid),
        cs = await tx.get(cr);
      const c = cs.data() as SurgicalCase | undefined;
      requireThat(c, 404, 'Case not found.');
      dep = c.departmentId;
      department(m, dep);
      before = c;
      if (op.type === 'patient') {
        requireThat(c.patientId === op.data.patientId, 409, 'Patient does not match this case.');
        const patientRef = h.collection('patients').doc(op.data.patientId),
          patientSnapshot = await tx.get(patientRef),
          patient = patientSnapshot.data() as Patient | undefined;
        requireThat(patient, 404, 'Patient not found.');
        const relatedCases = await tx.get(
          h.collection('cases').where('patientId', '==', op.data.patientId),
        );
        requireThat(
          relatedCases.docs.every((related) => m.departments.includes(related.data().departmentId)),
          403,
          'Editing this patient requires access to every related department.',
        );
        const patientVersion = patient.version ?? 1;
        requireThat(
          patientVersion === op.data.version,
          409,
          'These patient details changed since you opened them. Refresh and review your entry.',
        );
        requireThat(
          !op.data.dob || op.data.dob <= saDay(now),
          422,
          'Date of birth cannot be in the future.',
        );
        const updatedPatient: Patient = {
          ...patient,
          name: op.data.name,
          dob: op.data.dob,
          gender: op.data.gender ?? patient.gender ?? 'Not recorded',
          phone: op.data.phone,
          version: patientVersion + 1,
        };
        before = { ...patient, version: patientVersion };
        after = updatedPatient;
        reason = op.data.reason;
        tx.update(patientRef, updatedPatient);
        changes.patient = updatedPatient;
      } else {
        requireThat(
          c.version === op.data.version,
          409,
          'This case changed since you opened it. Refresh and review your entry.',
        );
        requireThat(
          !['Completed', 'Closed'].includes(c.status),
          409,
          'This case is already closed or completed. Review its history.',
        );
        const updated: SurgicalCase = { ...c, version: c.version + 1, updatedAt: now };
        if (op.type === 'priority') {
          reason = op.data.reason;
          updated.priority = op.data.priority;
          updated.priorityHistory = [
            ...(c.priorityHistory ?? []),
            { priority: op.data.priority, at: op.occurredAt },
          ];
          updated.dueAt = dueDate(c.urgencyAt, op.data.priority);
        }
        if (op.type === 'readiness') {
          reason = op.data.reason;
          requireThat(
            c.status === 'Waiting' || c.status === 'On hold',
            409,
            'Cancel the current booking before changing readiness.',
          );
          updated.readiness = op.data.readiness;
        }
        if (op.type === 'hold') {
          reason = op.data.reason;
          requireThat(
            c.status === 'Waiting' || c.status === 'On hold',
            409,
            'Only unbooked cases can be put on hold.',
          );
          updated.status = op.data.hold ? 'On hold' : 'Waiting';
        }
        if (op.type === 'case-notes') {
          reason = op.data.reason;
          updated.notes = op.data.notes;
        }
        if (op.type === 'book') {
          const d = op.data;
          requireThat(
            c.status === 'Waiting' && c.readiness === 'Ready',
            409,
            'Only ready, unbooked cases can be scheduled.',
          );
          const sr = h.collection('sessions').doc(d.sessionId),
            ss = await tx.get(sr),
            s = ss.data() as TheatreSession | undefined;
          requireThat(s && s.departmentId === dep, 400, 'Select a session in this department.');
          requireThat(
            +new Date(s.start) >= Date.now() - 5 * 60000,
            422,
            'This theatre session has already started. Choose an upcoming session.',
          );
          const guard = h.collection('guards').doc(s.date),
            gs = await tx.get(guard),
            all = await tx.get(h.collection('bookings').where('sessionId', '==', s.id));
          const existingBookings = all.docs.map((booking) => booking.data() as Booking),
            start = nextAvailableStart(
              s,
              existingBookings,
              d.duration,
              turnaroundMinutes(hospital),
            );
          requireThat(
            start,
            409,
            'This session no longer has enough space. Choose another session.',
          );
          const end = new Date(
            +new Date(start) + (d.duration + turnaroundMinutes(hospital)) * 60000,
          ).toISOString();
          const siblingCases = await tx.get(
            h.collection('cases').where('patientId', '==', c.patientId),
          );
          requireThat(
            !siblingCases.docs.some(
              (x) => x.id !== cid && ['Scheduled', 'In theatre'].includes(x.data().status),
            ),
            409,
            'This patient already has another active booking.',
          );
          const b: Booking = {
            id: op.id,
            caseId: cid,
            sessionId: s.id,
            departmentId: dep,
            start,
            end,
            status: 'Scheduled',
            inAt: null,
            outAt: null,
            reason: '',
            estimatedMinutes: d.duration,
            turnoverMinutes: turnaroundMinutes(hospital),
            version: 1,
          };
          tx.create(h.collection('bookings').doc(b.id), b);
          changes.booking = b;
          tx.set(guard, { version: (gs.data()?.version ?? 0) + 1 });
          updated.status = 'Scheduled';
          updated.surgeon = s.surgeon;
          updated.duration = d.duration;
        }
        if (op.type === 'activity') {
          const d = op.data,
            br = h.collection('bookings').doc(d.bookingId),
            bs = await tx.get(br),
            b = bs.data() as Booking | undefined;
          requireThat(
            b && b.caseId === cid && b.departmentId === dep,
            404,
            'Booking not found for this case.',
          );
          const changed = { ...b, version: b.version + 1 };
          reason = d.reason;
          if (d.kind === 'start') {
            requireThat(
              c.status === 'Scheduled' && b.status === 'Scheduled',
              409,
              'This operation has already started or is not scheduled.',
            );
            requireThat(
              Math.abs(+new Date(op.occurredAt) - +new Date(b.start)) < 2 * 86400000,
              422,
              'The event time is outside this booking. Review the date.',
            );
            updated.status = 'In theatre';
            changed.status = 'In theatre';
            changed.inAt = op.occurredAt;
          }
          if (d.kind === 'complete') {
            requireThat(
              c.status === 'In theatre' && b.status === 'In theatre' && b.inAt,
              409,
              'Record theatre entry before completion.',
            );
            requireThat(
              +new Date(op.occurredAt) > +new Date(b.inAt),
              422,
              'Theatre exit must be after entry.',
            );
            requireThat(
              +new Date(op.occurredAt) - +new Date(b.inAt) <= 24 * 3600000,
              422,
              'Review the duration: it exceeds 24 hours.',
            );
            updated.status = 'Completed';
            changed.status = 'Completed';
            changed.outAt = op.occurredAt;
          }
          if (d.kind === 'cancel') {
            requireThat(
              c.status === 'Scheduled' && b.status === 'Scheduled',
              409,
              'Only a scheduled booking can be cancelled.',
            );
            requireThat(d.reason.length >= 3, 422, 'Give a cancellation reason.');
            updated.status = 'Waiting';
            changed.status = 'Cancelled';
            changed.reason = d.reason;
          }
          tx.update(br, changed);
          changes.booking = changed;
        }
        tx.update(cr, updated);
        changes.surgicalCase = updated;
        after = updated;
      }
    }
    if (op.type === 'session') changes.session = after as TheatreSession;
    const result: OperationResult = { id: op.id, caseId: cid, acceptedAt: now, changes };
    tx.create(h.collection('audit').doc(op.id), {
      id: op.id,
      caseId: cid,
      departmentId: dep,
      actor: p.name,
      actorId: uid,
      action: op.type === 'activity' ? `activity.${op.data.kind}` : op.type,
      reason,
      at: now,
      occurredAt: op.occurredAt,
      recordedAt: op.recordedAt,
      before,
      after,
    });
    tx.create(receipt, { uid, hash, departmentId: dep, result });
    return result;
  });
}
