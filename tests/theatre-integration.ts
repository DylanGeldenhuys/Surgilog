import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db, auth, projectId } from '../apps/api/firebase.ts';
import { saDay } from '../shared/domain.ts';
import type { TheatreEntryInput } from '../shared/theatre.ts';
assert.equal(projectId, 'demo-theatre-tracker');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8080');
const hid = `register-test-${randomUUID()}`,
  h = db.doc(`hospitals/${hid}`),
  tokens: Record<string, string> = {},
  users: string[] = [],
  adminIds: string[] = [];
const now = new Date().toISOString(),
  day = saDay(new Date(Date.now() - 86400000));
let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
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
const send = (role: string, op: unknown) => request(role, `/api/hospitals/${hid}/operations`, op);
const op = (type: string, data: unknown) => ({
  id: randomUUID(),
  type,
  data,
  occurredAt: now,
  recordedAt: now,
});
const expect = (r: { status: number; data: any }, status: number) =>
  assert.equal(r.status, status, JSON.stringify(r.data));
const input: TheatreEntryInput = {
  entryId: 'entry-one',
  version: 0,
  departmentId: 'general',
  bookingId: null,
  patientRef: 'SYN-ONE',
  patientName: 'Synthetic register patient',
  dob: '',
  age: 40,
  ageUnit: 'years',
  sex: 'Not recorded',
  admissionDate: day,
  ward: 'Test ward',
  theatre: 'T1',
  procedures: ['Synthetic procedure', 'Second procedure'],
  surgeon: 'Dr Test',
  assistant: '',
  anaesthetist: 'Dr Anaesthetic',
  inAt: `${day}T08:00:00+02:00`,
  outAt: `${day}T09:00:00+02:00`,
  status: 'Draft',
  source: 'Historical register',
  sourceReference: 'Synthetic page 1',
  notes: '',
  reason: 'Synthetic entry',
};
try {
  await h.create({
    id: hid,
    name: 'Synthetic register hospital',
    city: 'Test',
    region: 'Africa',
    country: 'South Africa',
    province: 'Test',
    district: 'Test',
    departments: [
      { id: 'general', name: 'General' },
      { id: 'private', name: 'Other' },
    ],
    theatres: ['T1', 'ICU', 'Day Theatre'],
    surgeons: ['Dr Test'],
    version: 1,
  });
  for (const role of ['doctor', 'nurse', 'system_admin_write', 'system_admin_read', 'viewer']) {
    const uid = `${hid}-${role}`,
      email = `${uid}@test.invalid`;
    users.push(uid);
    await auth.createUser({ uid, email, password: 'SyntheticTest!26' });
    await db.doc(`profiles/${uid}`).create({
      uid,
      email,
      name: `Synthetic ${role}`,
      active: true,
      memberships: [
        {
          hospitalId: hid,
          role,
          departments: role.startsWith('system_admin') ? ['*'] : ['general'],
        },
      ],
    });
    const login = await fetch(
      'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-theatre-tracker',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'SyntheticTest!26', returnSecureToken: true }),
      },
    );
    tokens[role] = ((await login.json()) as any).idToken;
    assert.ok(tokens[role]);
  }
  const draft = op('theatre-entry', input);
  await check('nurse drafts, clinical verification and replay are scoped and atomic', async () => {
    const saved = await send('nurse', draft);
    expect(saved, 200);
    assert.equal(saved.data.changes.theatreEntry.status, 'Draft');
    const replay = await send('nurse', draft);
    expect(replay, 200);
    assert.equal(replay.data.replayed, true);
    expect(
      await send('nurse', op('theatre-entry', { ...input, version: 1, status: 'Verified' })),
      403,
    );
    expect(
      await send('system_admin_read', op('theatre-entry', { ...input, entryId: 'denied' })),
      403,
    );
    expect(
      await send(
        'doctor',
        op('theatre-entry', { ...input, departmentId: 'private', entryId: 'private' }),
      ),
      403,
    );
    expect(
      await send('doctor', op('theatre-entry', { ...input, version: 1, status: 'Verified' })),
      200,
    );
    assert.equal((await h.collection('cases').get()).size, 0);
    assert.equal((await h.collection('bookings').get()).size, 0);
  });
  await check('duplicates and concurrent corrections do not silently overwrite', async () => {
    expect(await send('doctor', op('theatre-entry', { ...input, entryId: 'duplicate' })), 409);
    const changes = await Promise.all(
      ['One', 'Two'].map((notes) =>
        send('doctor', op('theatre-entry', { ...input, version: 2, status: 'Verified', notes })),
      ),
    );
    assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
    expect(await send('nurse', op('theatre-entry', { ...input, version: 3 })), 403);
  });
  await check('admin turnaround is versioned, bounded and not available to doctors', async () => {
    const change = {
      id: randomUUID(),
      type: 'theatre-settings',
      data: { hospitalId: hid, version: 1, turnaroundMinutes: 30 },
    };
    adminIds.push(change.id);
    expect(await request('doctor', '/api/admin/operations', change), 403);
    expect(await request('system_admin_read', '/api/admin/operations', change), 403);
    expect(
      await request('system_admin_write', '/api/admin/operations', {
        ...change,
        data: { ...change.data, turnaroundMinutes: 31 },
      }),
      400,
    );
    expect(await request('system_admin_write', '/api/admin/operations', change), 200);
    const replay = await request('system_admin_write', '/api/admin/operations', change);
    expect(replay, 200);
    assert.equal(replay.data.replayed, true);
    expect(
      await request('system_admin_write', '/api/admin/operations', {
        ...change,
        id: randomUUID(),
        data: { ...change.data, turnaroundMinutes: 20 },
      }),
      409,
    );
  });
  await check('server booking capacity uses the configured turnaround', async () => {
    const future = saDay(new Date(Date.now() + 86400000));
    expect(
      await send(
        'doctor',
        op('register', {
          caseId: 'book-case',
          patientRef: 'BOOK-ONE',
          patientName: 'Synthetic booking',
          dob: '1980-01-01',
          gender: 'Not recorded',
          phone: '',
          departmentId: 'general',
          procedure: 'Test',
          surgeon: 'Dr Test',
          priority: 'P2',
          listedAt: now,
          urgencyAt: now,
          readiness: 'Ready',
          notes: '',
        }),
      ),
      200,
    );
    expect(
      await send(
        'doctor',
        op('session', {
          sessionId: 'short',
          departmentId: 'general',
          theatre: 'T1',
          surgeon: 'Dr Test',
          date: future,
          start: `${future}T08:00:00+02:00`,
          end: `${future}T09:15:00+02:00`,
        }),
      ),
      200,
    );
    expect(
      await send(
        'doctor',
        op('book', { caseId: 'book-case', version: 1, sessionId: 'short', duration: 60 }),
      ),
      409,
    );
    const result = await send(
      'doctor',
      op('book', { caseId: 'book-case', version: 1, sessionId: 'short', duration: 45 }),
    );
    expect(result, 200);
    assert.equal(result.data.changes.booking.turnoverMinutes, 30);
  });
  await check(
    'reports include idle capacity, exclude draft rows and redact patient data',
    async () => {
      await h
        .collection('sessions')
        .doc('past')
        .create({
          id: 'past',
          departmentId: 'general',
          theatre: 'T1',
          surgeon: 'Dr Test',
          date: day,
          start: `${day}T06:00:00.000Z`,
          end: `${day}T14:00:00.000Z`,
          version: 1,
        });
      expect(
        await send(
          'nurse',
          op('theatre-entry', {
            ...input,
            entryId: 'draft-two',
            patientRef: 'SYN-TWO',
            inAt: `${day}T10:00:00+02:00`,
            outAt: `${day}T11:00:00+02:00`,
          }),
        ),
        200,
      );
      const path = `/api/reporting/theatre?hospitalId=${hid}&departmentId=general&from=${day}&to=${day}`;
      const r = await request('viewer', path);
      expect(r, 200);
      assert.equal(r.data.summary.cases, 1);
      assert.equal(r.data.summary.procedures, 2);
      assert.equal(r.data.summary.drafts, 1);
      assert.equal(r.data.summary.availableMinutes, 480);
      assert.equal(r.data.summary.utilisation, 12.5);
      assert.ok(!JSON.stringify(r.data).includes('SYN-ONE'));
      assert.ok(!JSON.stringify(r.data).includes('Synthetic register patient'));
      expect(
        await request('doctor', path.replace('departmentId=general', 'departmentId=private')),
        403,
      );
      expect(await request('doctor', path.replace(`from=${day}`, 'from=2026-02-30')), 400);
      expect(await request('doctor', path + '&departmentId=private'), 400);
    },
  );
  await check('completed bookings appear once after adding register detail', async () => {
    const c = (await h.collection('cases').doc('book-case').get()).data()!;
    await h
      .collection('bookings')
      .doc('past-booking')
      .create({
        id: 'past-booking',
        caseId: c.id,
        sessionId: 'past',
        departmentId: 'general',
        start: `${day}T10:00:00.000Z`,
        end: `${day}T11:15:00.000Z`,
        inAt: `${day}T10:00:00.000Z`,
        outAt: `${day}T11:00:00.000Z`,
        status: 'Completed',
        reason: '',
        version: 1,
      });
    const path = `/api/reporting/theatre?hospitalId=${hid}&departmentId=general&from=${day}&to=${day}`;
    assert.equal((await request('doctor', path)).data.summary.cases, 2);
    const linked = {
      ...input,
      entryId: 'past-booking',
      bookingId: 'past-booking',
      patientRef: 'BOOK-ONE',
      patientName: 'Synthetic booking',
      dob: '1980-01-01',
      age: null,
      source: 'Booked surgery',
      inAt: `${day}T10:00:00.000Z`,
      outAt: `${day}T11:00:00.000Z`,
      status: 'Verified',
    };
    expect(await send('doctor', op('theatre-entry', linked)), 200);
    assert.equal((await request('doctor', path)).data.summary.cases, 2);
    expect(
      await send(
        'doctor',
        op('theatre-entry', { ...linked, version: 1, outAt: `${day}T11:10:00.000Z` }),
      ),
      409,
    );
    expect(
      await send(
        'doctor',
        op('theatre-entry', {
          ...linked,
          entryId: 'duplicate-booked',
          bookingId: null,
          source: 'Historical register',
        }),
      ),
      409,
    );
  });
  await check(
    'workspace isolates register entries and revoked offline replay is denied',
    async () => {
      const w = await request('doctor', `/api/hospitals/${hid}/workspace?departmentId=general`);
      expect(w, 200);
      assert.equal(w.data.theatreEntries.length, 3);
      const restricted = await request(
        'viewer',
        `/api/hospitals/${hid}/workspace?departmentId=general`,
      );
      expect(restricted, 200);
      assert.equal(restricted.data.theatreEntries.length, 0);
      await db.doc(`profiles/${hid}-nurse`).update({ memberships: [] });
      expect(await send('nurse', draft), 403);
    },
  );
  await check(
    'legacy offset times cross report boundaries correctly and missing timings stay unknown',
    async () => {
      await h
        .collection('bookings')
        .doc('offset-booking')
        .create({
          id: 'offset-booking',
          caseId: 'book-case',
          sessionId: 'past',
          departmentId: 'general',
          start: `${day}T00:05:00+02:00`,
          end: `${day}T01:05:00+02:00`,
          inAt: `${day}T00:05:00+02:00`,
          outAt: `${day}T01:05:00+02:00`,
          status: 'Completed',
          reason: '',
          version: 1,
        });
      await h
        .collection('bookings')
        .doc('missing-booking')
        .create({
          id: 'missing-booking',
          caseId: 'book-case',
          sessionId: 'past',
          departmentId: 'general',
          start: `${day}T12:00:00.000Z`,
          end: `${day}T13:00:00.000Z`,
          inAt: null,
          outAt: null,
          status: 'Completed',
          reason: '',
          version: 1,
        });
      const r = await request(
        'doctor',
        `/api/reporting/theatre?hospitalId=${hid}&departmentId=general&from=${day}&to=${day}`,
      );
      expect(r, 200);
      assert.equal(r.data.summary.cases, 3);
      assert.equal(r.data.missingTimings, 1);
      assert.equal(r.data.summary.utilisation, null);
      assert.equal(r.data.series[0].utilisation, null);
    },
  );
  await check(
    'overnight records contribute occupancy across periods and future counts stay unknown',
    async () => {
      const yesterday = saDay(new Date(Date.parse(`${day}T00:00:00+02:00`) - 86400000));
      expect(
        await send(
          'doctor',
          op('theatre-entry', {
            ...input,
            entryId: 'overnight',
            patientRef: 'SYN-OVERNIGHT',
            admissionDate: '',
            theatre: 'ICU',
            inAt: `${yesterday}T23:30:00+02:00`,
            outAt: `${day}T00:30:00+02:00`,
            status: 'Verified',
          }),
        ),
        200,
      );
      await h
        .collection('sessions')
        .doc('overnight')
        .create({
          id: 'overnight',
          departmentId: 'general',
          theatre: 'ICU',
          surgeon: 'Dr Test',
          date: yesterday,
          start: `${yesterday}T23:00:00+02:00`,
          end: `${day}T01:00:00+02:00`,
          version: 1,
        });
      const r = await request(
        'doctor',
        `/api/reporting/theatre?hospitalId=${hid}&departmentId=general&from=${day}&to=${day}`,
      );
      expect(r, 200);
      assert.equal(r.data.summary.cases, 3);
      assert.equal(r.data.summary.usedMinutes, 150);
      assert.equal(r.data.summary.availableMinutes, 540);
      const tomorrow = saDay(new Date(Date.now() + 86400000));
      const future = await request(
        'doctor',
        `/api/reporting/theatre?hospitalId=${hid}&departmentId=general&from=${tomorrow}&to=${tomorrow}`,
      );
      expect(future, 200);
      assert.equal(future.data.series[0].cases, null);
      assert.equal(future.data.summary.availableMinutes, 0);
    },
  );
  console.log(`${passed} theatre integration scenarios passed.`);
} finally {
  await db.recursiveDelete(h);
  for (const uid of users) {
    await db.doc(`profiles/${uid}`).delete();
    await auth.deleteUser(uid);
  }
  for (const id of adminIds) {
    await db.doc(`adminOperations/${id}`).delete();
    await db.doc(`systemAudit/${id}`).delete();
  }
}
