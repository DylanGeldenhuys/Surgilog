import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, auth, projectId } from '../apps/api/firebase.ts';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { saDay, type Operation, type Profile, type Hospital } from '../shared/domain.ts';
assert.equal(projectId, 'demo-theatre-tracker');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
const prefix = `test-${randomUUID()}`,
  hid = prefix,
  other = `${prefix}-other`,
  root = db.doc(`hospitals/${hid}`);
const now = new Date().toISOString(),
  ago = new Date(Date.now() - 3600000).toISOString();
let passed = 0;
const users: string[] = [];
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const tokens: Record<string, string> = {};
async function request(role: string, path: string, body?: unknown) {
  const r = await fetch(`http://127.0.0.1:8787${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(tokens[role] ? { Authorization: `Bearer ${tokens[role]}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: (await r.json()) as any };
}
const op = (type: string, data: any, occurredAt = now): Operation =>
  ({ id: randomUUID(), type, data, occurredAt, recordedAt: now }) as Operation;
const send = (role: string, o: Operation, h = hid) =>
  request(role, `/api/hospitals/${h}/operations`, o);
const register = (id: string, departmentId = 'general') =>
  op('register', {
    caseId: id,
    patientRef: id,
    patientName: `Synthetic ${id}`,
    dob: '1980-01-01',
    gender: 'Not recorded',
    phone: '',
    departmentId,
    procedure: 'Synthetic surgery',
    surgeon: 'Dr Test',
    priority: 'P2',
    listedAt: ago,
    urgencyAt: ago,
    readiness: 'Ready',
    notes: '',
  });
async function expectStatus(result: Awaited<ReturnType<typeof request>>, expected: number) {
  assert.equal(result.status, expected, JSON.stringify(result.data));
}
let env: Awaited<ReturnType<typeof initializeTestEnvironment>> | undefined;
try {
  const hospital: Hospital = {
    id: hid,
    name: 'Synthetic test hospital',
    city: 'Test',
    region: 'Africa',
    country: 'South Africa',
    province: 'Western Cape',
    district: 'City of Cape Town',
    departments: [
      { id: 'general', name: 'General' },
      { id: 'private', name: 'Other department' },
    ],
    theatres: ['T1', 'T2'],
    surgeons: ['Dr Test', 'Dr Two'],
  };
  await root.set(hospital);
  await db.doc(`hospitals/${other}`).set({
    ...hospital,
    id: other,
    name: 'Synthetic other hospital',
    country: 'Kenya',
    province: 'Nairobi County',
    district: 'Nairobi Central',
  });
  for (const role of ['clinician', 'recorder', 'coordinator', 'viewer', 'admin'] as const) {
    const uid = `${prefix}-${role}`,
      email = `${uid}@test.invalid`;
    users.push(uid);
    await auth.createUser({ uid, email, password: 'SyntheticTest!26' });
    const profile: Profile = {
      uid,
      email,
      name: `Test ${role}`,
      active: true,
      memberships: [{ hospitalId: hid, role, departments: ['general'] }],
    };
    await db.doc(`profiles/${uid}`).set(profile);
    const res = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-theatre-tracker',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'SyntheticTest!26', returnSecureToken: true }),
      },
    );
    tokens[role] = ((await res.json()) as any).idToken;
    assert.ok(tokens[role]);
  }
  const reportingAccounts = [
    { key: 'global_viewer', grant: { role: 'global_viewer' as const } },
    {
      key: 'regional_viewer',
      grant: { role: 'regional_viewer' as const, region: 'Africa' },
    },
    {
      key: 'country_viewer',
      grant: {
        role: 'country_viewer' as const,
        region: 'Africa',
        country: 'South Africa',
      },
    },
    {
      key: 'state_viewer',
      grant: {
        role: 'state_viewer' as const,
        region: 'Africa',
        country: 'South Africa',
        province: 'Western Cape',
      },
    },
    {
      key: 'district_viewer',
      grant: {
        role: 'district_viewer' as const,
        region: 'Africa',
        country: 'South Africa',
        province: 'Western Cape',
        district: 'City of Cape Town',
      },
    },
  ];
  for (const account of reportingAccounts) {
    const uid = `${prefix}-${account.key}`,
      email = `${uid}@test.invalid`;
    users.push(uid);
    await auth.createUser({ uid, email, password: 'SyntheticTest!26' });
    const profile: Profile = {
      uid,
      email,
      name: `Test ${account.key}`,
      active: true,
      memberships: [],
      reportingGrants: [account.grant],
    };
    await db.doc(`profiles/${uid}`).set(profile);
    const response = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-theatre-tracker',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'SyntheticTest!26', returnSecureToken: true }),
      },
    );
    tokens[account.key] = ((await response.json()) as any).idToken;
    assert.ok(tokens[account.key]);
  }
  const path = `/api/hospitals/${hid}/workspace?departmentId=general`,
    first = register('case-one');
  await check('authentication, hospital and department isolation', async () => {
    await expectStatus(await request('', path), 401);
    await expectStatus(
      await request('clinician', `/api/hospitals/${other}/workspace?departmentId=general`),
      403,
    );
    await expectStatus(
      await request('clinician', `/api/hospitals/${hid}/workspace?departmentId=private`),
      403,
    );
    await expectStatus(await send('clinician', register('forbidden', 'private')), 403);
  });
  await check('registration, atomic audit and exactly-once replay', async () => {
    await expectStatus(await send('clinician', first), 200);
    const replay = await send('clinician', first);
    await expectStatus(replay, 200);
    assert.equal(replay.data.replayed, true);
    assert.equal((await root.collection('cases').get()).size, 1);
    assert.equal((await root.collection('audit').doc(first.id).get()).data()?.actorId, users[0]);
    assert.equal((await root.collection('audit').doc(first.id).get()).data()?.recordedAt, now);
    await expectStatus(
      await send('clinician', { ...first, data: { ...first.data, notes: 'Changed' } } as Operation),
      409,
    );
  });
  await check('recorder and admin cannot change clinical priority', async () => {
    for (const role of ['recorder', 'admin', 'viewer', 'coordinator'])
      await expectStatus(
        await send(
          role,
          op('priority', {
            caseId: 'case-one',
            version: 1,
            priority: 'P1',
            reason: 'Synthetic review',
          }),
        ),
        403,
      );
  });
  await check('stale versions require review and preserve waiting clock', async () => {
    const change = op('priority', {
      caseId: 'case-one',
      version: 1,
      priority: 'P1',
      reason: 'Synthetic review',
    });
    await expectStatus(await send('clinician', change), 200);
    await expectStatus(
      await send('clinician', op('priority', { ...change.data, priority: 'P3' })),
      409,
    );
    const c = (await root.collection('cases').doc('case-one').get()).data()!;
    assert.equal(c.listedAt, ago);
    assert.equal(c.urgencyAt, ago);
    assert.equal(c.dueAt, new Date(Date.parse(ago) + 30 * 86400000).toISOString());
    assert.deepEqual(c.priorityHistory, [
      { priority: 'P2', at: ago },
      { priority: 'P1', at: now },
    ]);
  });
  await check('duplicate patient/procedure is rejected', async () => {
    const d = first.data;
    await expectStatus(
      await send('clinician', op('register', { ...d, caseId: 'duplicate-case' })),
      409,
    );
  });
  await check('patient details, notes, readiness and hold lifecycle are controlled', async () => {
    const registration = register('workflow-case');
    await expectStatus(await send('clinician', registration), 200);
    const patientId = `pat-${registration.id}`;
    const patientChange = op('patient', {
      caseId: 'workflow-case',
      patientId,
      version: 1,
      name: 'Synthetic Corrected Patient',
      dob: '1981-02-03',
      gender: 'Female',
      phone: '+27 00 000 0000',
      reason: 'Synthetic demographic correction',
    });
    await expectStatus(await send('clinician', patientChange), 200);
    await expectStatus(
      await send('clinician', op('patient', { ...patientChange.data, name: 'Stale edit' })),
      409,
    );
    await expectStatus(
      await send(
        'clinician',
        op('case-notes', {
          caseId: 'workflow-case',
          version: 1,
          notes: 'Synthetic readiness blocker',
          reason: 'Synthetic note review',
        }),
      ),
      200,
    );
    await expectStatus(
      await send(
        'clinician',
        op('readiness', {
          caseId: 'workflow-case',
          version: 2,
          readiness: 'Needs assessment',
          reason: 'Synthetic assessment pending',
        }),
      ),
      200,
    );
    await expectStatus(
      await send(
        'clinician',
        op('hold', {
          caseId: 'workflow-case',
          version: 3,
          hold: true,
          reason: 'Synthetic equipment blocker',
        }),
      ),
      200,
    );
    let caseData = (await root.collection('cases').doc('workflow-case').get()).data()!;
    assert.equal(caseData.status, 'On hold');
    assert.equal(caseData.readiness, 'Needs assessment');
    assert.equal(caseData.notes, 'Synthetic readiness blocker');
    assert.equal(caseData.listedAt, ago);
    await expectStatus(
      await send(
        'clinician',
        op('hold', {
          caseId: 'workflow-case',
          version: 4,
          hold: false,
          reason: 'Synthetic blocker resolved',
        }),
      ),
      200,
    );
    caseData = (await root.collection('cases').doc('workflow-case').get()).data()!;
    assert.equal(caseData.status, 'Waiting');
    assert.equal(caseData.listedAt, ago);
    const patient = (await root.collection('patients').doc(patientId).get()).data()!;
    assert.equal(patient.name, 'Synthetic Corrected Patient');
    assert.equal(patient.gender, 'Female');
    assert.equal(patient.version, 2);
    await expectStatus(
      await send(
        'recorder',
        op('case-notes', {
          caseId: 'workflow-case',
          version: 5,
          notes: 'Recorded by a clerk',
          reason: 'Synthetic permission check',
        }),
      ),
      200,
    );
    await root
      .collection('cases')
      .doc('workflow-private')
      .set({
        ...caseData,
        id: 'workflow-private',
        departmentId: 'private',
      });
    await expectStatus(
      await send(
        'clinician',
        op('patient', {
          caseId: 'workflow-case',
          patientId,
          version: 2,
          name: 'Cross-department edit',
          dob: '1981-02-03',
          phone: '',
          reason: 'Synthetic department check',
        }),
      ),
      403,
    );
    assert.equal(
      (await root.collection('audit').doc(patientChange.id).get()).data()?.action,
      'patient',
    );
  });
  await check('viewer receives aggregates without patient records', async () => {
    const r = await request('viewer', path);
    await expectStatus(r, 200);
    assert.equal(r.data.metrics.outstanding, 2);
    assert.deepEqual(r.data.patients, []);
    assert.deepEqual(r.data.cases, []);
    await expectStatus(
      await request('viewer', `/api/hospitals/${hid}/cases/case-one/history`),
      403,
    );
  });
  await check(
    'aggregate reporting is limited to authorised hospitals and departments',
    async () => {
      const all = await request(
        'viewer',
        '/api/reporting/overview?hospitalId=all&departmentId=all',
      );
      await expectStatus(all, 200);
      assert.equal(all.data.scope.hospitalId, null);
      assert.equal(all.data.metrics.outstanding, 2);
      assert.equal(all.data.summaries.length, 1);
      assert.equal(all.data.summaries[0].hospitalId, hid);
      assert.deepEqual(Object.keys(all.data).sort(), ['asOf', 'metrics', 'scope', 'summaries']);
      assert.equal('patients' in all.data, false);
      assert.equal('cases' in all.data, false);

      const hospitalReport = await request(
        'clinician',
        `/api/reporting/overview?hospitalId=${hid}&departmentId=all`,
      );
      await expectStatus(hospitalReport, 200);
      assert.deepEqual(
        hospitalReport.data.summaries.map((item: any) => item.departmentId),
        ['general'],
      );
      await expectStatus(
        await request(
          'clinician',
          `/api/reporting/overview?hospitalId=${hid}&departmentId=private`,
        ),
        403,
      );
      await expectStatus(
        await request('clinician', `/api/reporting/overview?hospitalId=${other}&departmentId=all`),
        403,
      );

      const globalIdentity = await request('global_viewer', '/api/me');
      await expectStatus(globalIdentity, 200);
      assert.deepEqual(globalIdentity.data.profile.memberships, []);
      assert.ok(globalIdentity.data.hospitals.some((item: any) => item.id === hid));
      assert.ok(globalIdentity.data.hospitals.some((item: any) => item.id === other));
      assert.ok(globalIdentity.data.reportingAccess.some((item: any) => item.hospitalId === hid));
      await expectStatus(await request('global_viewer', path), 403);

      const globalReport = await request(
        'global_viewer',
        '/api/reporting/overview?hospitalId=all&departmentId=all',
      );
      await expectStatus(globalReport, 200);
      assert.equal(globalReport.data.scope.label, 'Global reporting scope');
      assert.ok(globalReport.data.summaries.some((item: any) => item.hospitalId === hid));
      assert.ok(globalReport.data.summaries.some((item: any) => item.hospitalId === other));
      assert.equal('patients' in globalReport.data, false);

      const explicitNetwork = await request(
        'global_viewer',
        `/api/reporting/overview?hospitalIds=${hid},${other}&departmentKeys=${hid}/general,${other}/general`,
      );
      await expectStatus(explicitNetwork, 200);
      assert.deepEqual(explicitNetwork.data.scope.hospitalIds.sort(), [hid, other].sort());
      assert.equal(explicitNetwork.data.scope.departments.length, 2);
      assert.ok(explicitNetwork.data.summaries.some((item: any) => item.hospitalId === hid));
      assert.ok(explicitNetwork.data.summaries.some((item: any) => item.hospitalId === other));
      assert.equal('patients' in explicitNetwork.data, false);
      await expectStatus(
        await request(
          'country_viewer',
          `/api/reporting/overview?hospitalIds=${hid},${other}&departmentKeys=${hid}/general,${other}/general`,
        ),
        403,
      );
      await expectStatus(
        await request(
          'clinician',
          `/api/reporting/overview?hospitalIds=${hid}&departmentKeys=${hid}/private`,
        ),
        403,
      );

      const regionalReport = await request(
        'regional_viewer',
        '/api/reporting/overview?hospitalId=all&departmentId=all',
      );
      await expectStatus(regionalReport, 200);
      assert.ok(regionalReport.data.summaries.some((item: any) => item.hospitalId === hid));
      assert.ok(regionalReport.data.summaries.some((item: any) => item.hospitalId === other));
      assert.equal(regionalReport.data.scope.label, 'Africa');

      for (const role of ['country_viewer', 'state_viewer', 'district_viewer']) {
        const scoped = await request(
          role,
          '/api/reporting/overview?hospitalId=all&departmentId=all',
        );
        await expectStatus(scoped, 200);
        const hospitalIds = scoped.data.summaries.map((item: any) => item.hospitalId);
        assert.ok(hospitalIds.includes(hid));
        assert.equal(hospitalIds.includes(other), false);
        await expectStatus(
          await request(role, `/api/reporting/overview?hospitalId=${other}&departmentId=all`),
          403,
        );
      }
    },
  );
  const day = saDay(new Date(Date.now() + 86400000)),
    start = `${day}T06:00:00.000Z`,
    end = `${day}T10:00:00.000Z`;
  const session = op('session', {
    sessionId: 'session-one',
    departmentId: 'general',
    theatre: 'T1',
    date: day,
    start,
    end,
    surgeon: 'Dr Test',
  });
  await check('session overlap includes surgeon and theatre', async () => {
    await expectStatus(await send('clinician', session), 200);
    const surgeonConflict = await send(
      'clinician',
      op('session', { ...session.data, sessionId: 'overlap', theatre: 'T2' }),
    );
    await expectStatus(surgeonConflict, 409);
    assert.match(surgeonConflict.data.error, /Dr Test is already reserved in General/);
    assert.match(surgeonConflict.data.error, /08:00–12:00 SAST/);
    assert.match(surgeonConflict.data.error, /even when no patients are booked/);
    const theatreConflict = await send(
      'clinician',
      op('session', {
        ...session.data,
        sessionId: 'same-theatre',
        surgeon: 'Dr Two',
      }),
    );
    await expectStatus(theatreConflict, 409);
    assert.match(theatreConflict.data.error, /T1 is already reserved/);
    assert.ok(!theatreConflict.data.error.includes('Dr Test'));
    await expectStatus(
      await send(
        'clinician',
        op('session', {
          ...session.data,
          sessionId: 'other-resources',
          theatre: 'T2',
          surgeon: 'Dr Two',
        }),
      ),
      200,
    );
    await expectStatus(
      await send('recorder', op('session', { ...session.data, sessionId: 'role-check' })),
      403,
    );
  });
  await check(
    'hidden department reservations are explained without exposing their records',
    async () => {
      const date = saDay(new Date(Date.now() + 2 * 86400000));
      const hidden = {
        id: 'private-session',
        departmentId: 'private',
        theatre: 'T2',
        surgeon: 'Dr Two',
        date,
        start: `${date}T06:00:00.000Z`,
        end: `${date}T10:00:00.000Z`,
        version: 1,
      };
      await root.collection('sessions').doc(hidden.id).create(hidden);
      const visible = await request(
        'clinician',
        `/api/hospitals/${hid}/workspace?departmentId=general`,
      );
      assert.ok(visible.data.sessions.every((s: any) => s.departmentId === 'general'));
      const data = {
        sessionId: 'hidden-theatre-clash',
        departmentId: 'general',
        theatre: 'T2',
        surgeon: 'Dr Test',
        date,
        start: hidden.start,
        end: hidden.end,
      };
      const denied = await send('clinician', op('session', data));
      await expectStatus(denied, 409);
      assert.match(denied.data.error, /T2 is already reserved in another department/);
      assert.match(denied.data.error, /08:00–12:00 SAST/);
      for (const privateDetail of ['private-session', 'Other department', 'Dr Two'])
        assert.ok(!denied.data.error.includes(privateDetail));
      const doctorClash = await send(
        'clinician',
        op('session', {
          ...data,
          sessionId: 'hidden-doctor-clash',
          theatre: 'T1',
          surgeon: 'Dr Two',
        }),
      );
      await expectStatus(doctorClash, 409);
      assert.match(doctorClash.data.error, /Dr Two is already reserved in another department/);
      assert.ok(!doctorClash.data.error.includes('T2'));
      await expectStatus(
        await send(
          'clinician',
          op('session', {
            ...data,
            sessionId: 'independent',
            theatre: 'T1',
          }),
        ),
        200,
      );
      await expectStatus(
        await send(
          'clinician',
          op('session', {
            ...data,
            sessionId: 'adjacent',
            surgeon: 'Dr Two',
            start: hidden.end,
            end: `${date}T12:00:00.000Z`,
          }),
        ),
        200,
      );
      const profile = db.doc(`profiles/${prefix}-clinician`);
      await profile.update({
        memberships: [{ hospitalId: hid, role: 'clinician', departments: ['general', 'private'] }],
      });
      const authorised = await send('clinician', op('session', data));
      await expectStatus(authorised, 409);
      assert.match(authorised.data.error, /in Other department/);
      await profile.update({
        memberships: [{ hospitalId: hid, role: 'clinician', departments: ['general'] }],
      });
    },
  );
  await check('concurrent session creation still prevents shared resource overlap', async () => {
    const date = saDay(new Date(Date.now() + 3 * 86400000));
    const results = await Promise.all(
      ['race-one', 'race-two'].map((sessionId) =>
        send(
          'clinician',
          op('session', {
            sessionId,
            departmentId: 'general',
            theatre: 'T1',
            surgeon: 'Dr Test',
            date,
            start: `${date}T06:00:00.000Z`,
            end: `${date}T10:00:00.000Z`,
          }),
        ),
      ),
    );
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  });
  await expectStatus(await send('clinician', register('case-two')), 200);
  const bookings = [
    op('book', { caseId: 'case-one', version: 2, sessionId: 'session-one', duration: 225 }),
    op('book', { caseId: 'case-two', version: 1, sessionId: 'session-one', duration: 225 }),
  ];
  let winner: Operation;
  await check('concurrent bookings allow exactly one reservation', async () => {
    const res = await Promise.all(bookings.map((b) => send('clinician', b)));
    assert.deepEqual(res.map((r) => r.status).sort(), [200, 409]);
    winner = bookings[res.findIndex((r) => r.status === 200)];
    assert.equal((await root.collection('bookings').get()).size, 1);
    const booking = (await root.collection('bookings').doc(winner!.id).get()).data()!;
    assert.equal(booking.start, start);
    assert.equal(booking.estimatedMinutes, 225);
    assert.equal(booking.turnoverMinutes, 15);
  });
  const caseId = (winner!.data as any).caseId;
  let version = (await root.collection('cases').doc(caseId).get()).data()!.version;
  await check('cancellation returns to waiting without resetting time', async () => {
    await expectStatus(
      await send(
        'recorder',
        op('activity', {
          caseId,
          version,
          bookingId: winner!.id,
          kind: 'cancel',
          reason: 'Must be denied',
        }),
      ),
      403,
    );
    await expectStatus(
      await send(
        'clinician',
        op('activity', {
          caseId,
          version,
          bookingId: winner!.id,
          kind: 'cancel',
          reason: 'Synthetic staffing issue',
        }),
      ),
      200,
    );
    version++;
    const c = (await root.collection('cases').doc(caseId).get()).data()!;
    assert.equal(c.status, 'Waiting');
    assert.equal(c.listedAt, ago);
  });
  const newBooking = op('book', { caseId, version, sessionId: 'session-one', duration: 225 });
  await expectStatus(await send('clinician', newBooking), 200);
  version++;
  await check('scrub/clerk role records entry and completion with actual times', async () => {
    await expectStatus(
      await send(
        'recorder',
        op('activity', { caseId, version, bookingId: newBooking.id, kind: 'complete', reason: '' }),
      ),
      409,
    );
    await expectStatus(
      await send(
        'recorder',
        op(
          'activity',
          { caseId, version, bookingId: newBooking.id, kind: 'start', reason: '' },
          ago,
        ),
      ),
      200,
    );
    version++;
    const completion = op('activity', {
      caseId,
      version,
      bookingId: newBooking.id,
      kind: 'complete',
      reason: '',
    });
    await expectStatus(await send('recorder', completion), 200);
    assert.equal((await send('recorder', completion)).data.replayed, true);
    await expectStatus(
      await send('recorder', op('activity', { ...completion.data, version: version + 1 })),
      409,
    );
    const r = await request('clinician', path);
    assert.equal(r.data.metrics.completed, 1);
    assert.equal(r.data.metrics.outstanding, 2);
  });
  await check(
    'accepted registrations and receipt replay return the actual linked patient snapshot',
    async () => {
      const originalCase = (await root.collection('cases').doc('case-one').get()).data()!;
      const patient = (await root.collection('patients').doc(originalCase.patientId).get()).data()!;
      const registration = register('linked-snapshot');
      if (registration.type !== 'register') throw new Error('Invalid fixture');
      Object.assign(registration.data, {
        patientRef: patient.ref,
        patientName: patient.name,
        dob: patient.dob,
        phone: 'must not replace existing phone',
        procedure: 'Additional synthetic procedure',
      });
      try {
        const accepted = await send('clinician', registration);
        await expectStatus(accepted, 200);
        assert.equal(accepted.data.changes.surgicalCase.patientId, patient.id);
        assert.equal(accepted.data.changes.patient.phone, patient.phone);
        assert.equal(accepted.data.changes.patient.version, patient.version);
        const replay = await send('clinician', registration);
        await expectStatus(replay, 200);
        assert.equal(replay.data.replayed, true);
        assert.deepEqual(replay.data.changes, accepted.data.changes);
      } finally {
        const cleanup = db.batch();
        for (const collection of ['audit', 'receipts'])
          cleanup.delete(root.collection(collection).doc(registration.id));
        cleanup.delete(root.collection('cases').doc('linked-snapshot'));
        await cleanup.commit();
      }
    },
  );
  await check(
    'malformed and repeated query parameters are rejected without a server error',
    async () => {
      await expectStatus(await request('clinician', `${path}&departmentId=private`), 400);
      await expectStatus(await request('clinician', `/api/hospitals/${hid}/workspace`), 400);
      await expectStatus(
        await request(
          'clinician',
          `/api/reporting/overview?hospitalIds=${hid}&hospitalIds=${other}`,
        ),
        400,
      );
      await expectStatus(
        await request('clinician', '/api/reporting/overview?departmentKeys=bad/path/extra'),
        400,
      );
    },
  );
  await check(
    'case history returns the latest 100 events rather than an arbitrary document slice',
    async () => {
      const refs = Array.from({ length: 105 }, (_, i) =>
        root.collection('audit').doc(`history-${String(105 - i).padStart(3, '0')}`),
      );
      const batch = db.batch();
      refs.forEach((ref, i) =>
        batch.set(ref, {
          caseId: 'case-one',
          departmentId: 'general',
          at: new Date(Date.UTC(2100, 0, 1, 0, i)).toISOString(),
          action: 'test.history',
        }),
      );
      await batch.commit();
      try {
        const response = await request('clinician', `/api/hospitals/${hid}/cases/case-one/history`);
        await expectStatus(response, 200);
        assert.equal(response.data.length, 100);
        assert.equal(response.data[0].id, refs[104].id);
        assert.equal(response.data[99].id, refs[5].id);
      } finally {
        const cleanup = db.batch();
        refs.forEach((ref) => cleanup.delete(ref));
        await cleanup.commit();
      }
    },
  );
  await check(
    'prepared backlog follows priority order and retains all booked cases and patients',
    async () => {
      const template = (await root.collection('cases').doc('case-one').get()).data()!;
      const refs = Array.from({ length: 251 }, (_, i) =>
        root.collection('cases').doc(`prepared-${i}`),
      );
      const booked = root.collection('cases').doc('prepared-booked'),
        booking = root.collection('bookings').doc('prepared-booking');
      const batch = db.batch();
      refs.forEach((ref) =>
        batch.set(ref, {
          ...template,
          id: ref.id,
          priority: 'P1',
          status: 'Waiting',
          listedAt: '2020-01-01T00:00:00Z',
          dueAt: '2099-01-01T00:00:00Z',
        }),
      );
      batch.set(booked, {
        ...template,
        id: booked.id,
        priority: 'P3',
        status: 'Scheduled',
        dueAt: '2099-12-01T00:00:00Z',
      });
      batch.set(booking, {
        id: booking.id,
        caseId: booked.id,
        departmentId: 'general',
        sessionId: 'prepared-session',
        start: now,
        end: now,
        status: 'Scheduled',
        inAt: null,
        outAt: null,
        reason: '',
        version: 1,
      });
      await batch.commit();
      try {
        const response = await request('clinician', path);
        await expectStatus(response, 200);
        const w = response.data;
        assert.equal(w.truncated, true);
        assert.equal(
          w.cases.filter((c: any) => c.id.startsWith('prepared-') && c.id !== booked.id).length,
          250,
        );
        assert.ok(w.cases.some((c: any) => c.id === booked.id));
        assert.ok(w.bookings.every((b: any) => w.cases.some((c: any) => c.id === b.caseId)));
        assert.ok(w.cases.every((c: any) => w.patients.some((p: any) => p.id === c.patientId)));
      } finally {
        const cleanup = db.batch();
        [...refs, booked, booking].forEach((ref) => cleanup.delete(ref));
        await cleanup.commit();
      }
    },
  );
  await check('diagnosis is optional, format-checked, scoped and audited', async () => {
    const legacy = (await root.collection('cases').doc('case-one').get()).data()!;
    assert.equal('diagnosis' in legacy, false);
    assert.equal('icd10' in legacy, false);
    const plain = register('diagnosis-absent');
    await expectStatus(await send('clinician', plain), 200);
    const absent = (await root.collection('cases').doc('diagnosis-absent').get()).data()!;
    assert.equal('diagnosis' in absent, false);
    assert.equal('icd10' in absent, false);
    const coded = register('diagnosis-coded');
    if (coded.type !== 'register') throw new Error('Invalid fixture');
    coded.data.diagnosis = '  Synthetic appendicitis  ';
    coded.data.icd10Code = 'k35.8';
    coded.data.priorityAssignedBy = 'Dr Synthetic';
    coded.data.readiness = 'Needs assessment';
    const accepted = await send('recorder', coded);
    await expectStatus(accepted, 200);
    assert.equal(accepted.data.changes.surgicalCase.diagnosis, 'Synthetic appendicitis');
    assert.deepEqual(accepted.data.changes.surgicalCase.icd10, {
      system: 'icd-10-who',
      code: 'K35.8',
    });
    const replay = await send('recorder', coded);
    await expectStatus(replay, 200);
    assert.equal(replay.data.replayed, true);
    await expectStatus(
      await send(
        'clinician',
        op('register', { ...coded.data, caseId: 'diagnosis-bad', icd10Code: '11A' }),
      ),
      400,
    );
    assert.equal((await root.collection('cases').doc('diagnosis-bad').get()).exists, false);
    const correction = op('diagnosis', {
      caseId: 'diagnosis-coded',
      version: 1,
      diagnosis: 'Synthetic mesenteric adenitis',
      icd10Code: '',
      reason: 'Synthetic diagnosis correction',
    });
    await expectStatus(await send('coordinator', correction), 403);
    await expectStatus(await send('viewer', correction), 403);
    await expectStatus(await send('recorder', correction), 200);
    const edited = (await root.collection('cases').doc('diagnosis-coded').get()).data()!;
    assert.equal(edited.diagnosis, 'Synthetic mesenteric adenitis');
    assert.equal('icd10' in edited, false);
    assert.equal(edited.version, 2);
    assert.equal(edited.procedure, 'Synthetic surgery');
    const audit = (await root.collection('audit').doc(correction.id).get()).data()!;
    assert.equal(audit.action, 'diagnosis');
    assert.equal(audit.reason, 'Synthetic diagnosis correction');
    assert.equal(audit.before.diagnosis, 'Synthetic appendicitis');
    assert.equal(audit.before.icd10.code, 'K35.8');
    assert.equal(audit.after.diagnosis, 'Synthetic mesenteric adenitis');
    assert.equal(audit.after.icd10, undefined);
    const workspace = await request(
      'clinician',
      `/api/hospitals/${hid}/workspace?departmentId=general`,
    );
    await expectStatus(workspace, 200);
    assert.equal(
      workspace.data.cases.find((item: { id: string }) => item.id === 'diagnosis-coded').diagnosis,
      'Synthetic mesenteric adenitis',
    );
    const overview = await request(
      'clinician',
      `/api/reporting/overview?hospitalId=${hid}&departmentId=general`,
    );
    await expectStatus(overview, 200);
    assert.equal(JSON.stringify(overview.data).includes('Synthetic mesenteric adenitis'), false);
    const viewer = await request('viewer', `/api/hospitals/${hid}/workspace?departmentId=general`);
    assert.equal(JSON.stringify(viewer.data).includes('Synthetic mesenteric adenitis'), false);
    await root
      .collection('cases')
      .doc('diagnosis-private')
      .set({
        ...edited,
        id: 'diagnosis-private',
        departmentId: 'private',
      });
    await expectStatus(
      await send(
        'clinician',
        op('diagnosis', {
          caseId: 'diagnosis-private',
          version: 2,
          diagnosis: 'Synthetic cross-department diagnosis',
          icd10Code: 'K35',
          reason: 'Synthetic department check',
        }),
      ),
      403,
    );
    await root
      .collection('cases')
      .doc('diagnosis-done')
      .set({
        ...edited,
        id: 'diagnosis-done',
        status: 'Completed',
      });
    await expectStatus(
      await send(
        'clinician',
        op('diagnosis', {
          caseId: 'diagnosis-done',
          version: 2,
          diagnosis: 'Synthetic late change',
          icd10Code: '',
          reason: 'Synthetic closed-case check',
        }),
      ),
      409,
    );
    await expectStatus(
      await send(
        'clinician',
        op('diagnosis', {
          caseId: 'diagnosis-coded',
          version: 1,
          diagnosis: 'Stale synthetic diagnosis',
          icd10Code: 'K35',
          reason: 'Synthetic stale edit',
        }),
      ),
      409,
    );
    const cleared = await send(
      'clinician',
      op('diagnosis', {
        caseId: 'diagnosis-coded',
        version: 2,
        diagnosis: '   ',
        icd10Code: '',
        reason: 'Synthetic diagnosis cleared',
      }),
    );
    await expectStatus(cleared, 200);
    const finalCase = (await root.collection('cases').doc('diagnosis-coded').get()).data()!;
    assert.equal('diagnosis' in finalCase, false);
    assert.equal('icd10' in finalCase, false);
    assert.equal(finalCase.version, 3);
    assert.equal(cleared.data.changes.surgicalCase.diagnosis, undefined);
  });
  await check('revocation is rechecked before replaying accepted operations', async () => {
    await db
      .doc(`profiles/${users[0]}`)
      .update({ memberships: [{ hospitalId: hid, role: 'clinician', departments: ['private'] }] });
    await expectStatus(await send('clinician', first), 403);
    await db.doc(`profiles/${users[1]}`).update({ active: false });
    await expectStatus(await request('recorder', path), 403);
  });
  await check('direct Firestore reads and writes are denied', async () => {
    env = await initializeTestEnvironment({
      projectId,
      firestore: { host: '127.0.0.1', port: 8080 },
    });
    const client = env.authenticatedContext(users[0]).firestore();
    await assertFails(getDoc(doc(client, `hospitals/${hid}/cases/case-one`)));
    await assertFails(setDoc(doc(client, `profiles/${users[0]}`), { active: true }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), `hospitals/${hid}`)));
  });
  console.log(`\n${passed} integration checks passed. Synthetic test fixtures cleaned up.`);
} finally {
  await env?.cleanup();
  const hospitalSnapshots = await db.collection('hospitals').get();
  for (const hospital of hospitalSnapshots.docs) {
    const testReads = await hospital.ref
      .collection('audit')
      .where('actorId', '>=', prefix)
      .where('actorId', '<', `${prefix}\uf8ff`)
      .get();
    await Promise.all(testReads.docs.map((entry) => entry.ref.delete()));
  }
  await db.recursiveDelete(root);
  await db.recursiveDelete(db.doc(`hospitals/${other}`));
  for (const uid of users) {
    await db.doc(`profiles/${uid}`).delete();
    await auth.deleteUser(uid).catch(() => {});
  }
  await db.terminate();
}
