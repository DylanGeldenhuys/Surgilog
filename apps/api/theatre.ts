import { createHash } from 'node:crypto';
import { db } from './firebase.ts';
import { ApiError, profileFor, resolvedReportingAccess } from './service.ts';
import {
  canClinical,
  canRecord,
  effectiveMembership,
  type Booking,
  type Hospital,
  type Operation,
  type OperationResult,
  type Patient,
  type Profile,
  type SurgicalCase,
  type TheatreSession,
} from '../../shared/domain.ts';
import {
  completedBookingEntries,
  projectedEntry,
  reportBounds,
  theatreDay,
  theatreMetrics,
  type TheatreEntry,
  type TheatreReport,
} from '../../shared/theatre.ts';

function check(value: unknown, status: number, message: string): asserts value {
  if (!value) throw new ApiError(status, message);
}
const fingerprint = (e: { patientRef: string; theatre: string; inAt: string }) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        e.patientRef.trim().toUpperCase(),
        e.theatre.toLowerCase(),
        new Date(e.inAt).toISOString(),
      ]),
    )
    .digest('hex');

export async function saveTheatreEntry(
  uid: string,
  hid: string,
  op: Extract<Operation, { type: 'theatre-entry' }>,
): Promise<OperationResult> {
  const now = new Date().toISOString(),
    h = db.doc(`hospitals/${hid}`),
    hash = createHash('sha256').update(JSON.stringify(op)).digest('hex');
  const d = op.data;
  check(
    Date.parse(d.outAt) <= Date.now() + 300000,
    422,
    'Only record activity that has already happened.',
  );
  check(
    d.entryId === (d.bookingId ?? d.entryId),
    400,
    'A linked entry must use its booking identifier.',
  );
  return db.runTransaction(async (tx) => {
    const receipt = h.collection('receipts').doc(op.id),
      ref = h.collection('theatreEntries').doc(d.entryId);
    const [profileDoc, hospitalDoc, prior, existing] = await tx.getAll(
      db.doc(`profiles/${uid}`),
      h,
      receipt,
      ref,
    );
    const profile = profileDoc.data() as Profile | undefined,
      hospital = hospitalDoc.data() as Hospital | undefined;
    check(profile?.active && hospital, 403, 'Hospital access is unavailable.');
    const scope = effectiveMembership(profile, hospital);
    check(
      scope && canRecord(scope.role) && scope.departments.includes(d.departmentId),
      403,
      'This theatre register is outside your write access.',
    );
    check(
      hospital.departments.some((dep) => dep.id === d.departmentId),
      400,
      'Unknown department.',
    );
    check(
      d.status !== 'Verified' || canClinical(scope.role),
      403,
      'A doctor or write administrator must verify a register entry.',
    );
    if (prior.exists) {
      check(
        prior.get('uid') === uid && prior.get('hash') === hash,
        409,
        'Request ID already belongs to different input.',
      );
      return { ...prior.get('result'), replayed: true };
    }
    const previous = existing.data() as TheatreEntry | undefined;
    check(
      !previous || previous.departmentId === d.departmentId,
      403,
      'This entry belongs to another department.',
    );
    check(
      !previous || previous.status !== 'Verified' || canClinical(scope.role),
      403,
      'A doctor or write administrator must amend a verified entry.',
    );
    check(
      (previous?.version ?? 0) === d.version,
      409,
      'This register entry changed. Refresh and review before saving.',
    );
    check(
      !previous || previous.bookingId === d.bookingId,
      409,
      'The booking link cannot be changed.',
    );
    check(
      hospital.theatres.includes(d.theatre),
      400,
      'Select a configured theatre or operating location.',
    );
    const entry = projectedEntry(d, now, previous);
    entry.patientRef = d.patientRef.trim().toUpperCase();
    entry.recordedAt = previous?.recordedAt ?? op.recordedAt;
    entry.recordedBy = previous?.recordedBy ?? uid;
    entry.verifiedBy = d.status === 'Verified' ? uid : null;
    if (d.bookingId) {
      const booking = (await tx.get(h.collection('bookings').doc(d.bookingId))).data() as
        Booking | undefined;
      check(
        booking && booking.departmentId === d.departmentId,
        403,
        'This booking is outside your department.',
      );
      check(
        booking.status === 'Completed' && booking.inAt && booking.outAt,
        409,
        'Record booking completion before adding register details.',
      );
      const [cs, ss] = await tx.getAll(
        h.collection('cases').doc(booking.caseId),
        h.collection('sessions').doc(booking.sessionId),
      );
      const c = cs.data() as SurgicalCase | undefined,
        s = ss.data() as TheatreSession | undefined;
      check(c && s, 409, 'The booking references need review.');
      const p = (await tx.get(h.collection('patients').doc(c.patientId))).data() as
        Patient | undefined;
      check(
        p &&
          entry.patientRef === p.ref.trim().toUpperCase() &&
          d.patientName === p.name &&
          d.dob === p.dob,
        409,
        'Linked patient details changed. Refresh the register.',
      );
      check(
        s.theatre === d.theatre &&
          Date.parse(booking.inAt) === Date.parse(d.inAt) &&
          Date.parse(booking.outAt) === Date.parse(d.outAt),
        409,
        'Linked theatre and actual timings must match the booking.',
      );
      check(d.status === 'Verified', 400, 'Completed booking details must remain verified.');
      entry.caseId = c.id;
      entry.sessionId = s.id;
    }
    const key = fingerprint(entry),
      unique = h.collection('theatreEntryKeys').doc(key),
      priorKey = previous ? fingerprint(previous) : null;
    const match = await tx.get(unique);
    check(
      !match.exists || match.get('entryId') === entry.id,
      409,
      'An entry for this patient, location and start already exists. Review the register.',
    );
    // Protect against separately re-entering an existing completed booking.
    if (!d.bookingId) {
      const registry = await tx.get(
        h
          .collection('patientRefs')
          .doc(createHash('sha256').update(entry.patientRef).digest('hex')),
      );
      if (registry.exists) {
        const cases = await tx.get(
          h.collection('cases').where('patientId', '==', registry.get('patientId')).limit(101),
        );
        check(
          cases.size <= 100,
          422,
          'This patient requires a scoped record review before import.',
        );
        const bookings = await tx.get(
          h
            .collection('bookings')
            .where('inAt', '>=', new Date(Date.parse(entry.inAt) - 86400000).toISOString())
            .where('inAt', '<', new Date(Date.parse(entry.inAt) + 86400000).toISOString())
            .limit(501),
        );
        check(bookings.size <= 500, 422, 'Too many matching timings; review before import.');
        check(
          !bookings.docs.some(
            (b) =>
              b.get('status') !== 'Cancelled' &&
              Date.parse(b.get('inAt')) === Date.parse(entry.inAt) &&
              cases.docs.some((c) => c.id === b.get('caseId')),
          ),
          409,
          'A booked operation for this patient and time already exists. Open its register entry.',
        );
      }
    }
    if (priorKey && priorKey !== key) tx.delete(h.collection('theatreEntryKeys').doc(priorKey));
    tx.set(unique, { entryId: entry.id });
    tx.set(ref, entry);
    const result: OperationResult = {
      id: op.id,
      caseId: entry.caseId,
      acceptedAt: now,
      changes: { theatreEntry: entry },
    };
    tx.create(receipt, { uid, hash, departmentId: d.departmentId, result });
    tx.create(h.collection('audit').doc(op.id), {
      id: op.id,
      caseId: entry.caseId,
      entryId: entry.id,
      departmentId: d.departmentId,
      actor: profile.name,
      actorId: uid,
      action: 'theatre-entry',
      reason: d.reason,
      at: now,
      occurredAt: op.occurredAt,
      recordedAt: op.recordedAt,
      before: previous ?? null,
      after: entry,
    });
    return result;
  });
}

export async function theatreReport(
  uid: string,
  hid: string,
  dep: string,
  from: string,
  to: string,
): Promise<TheatreReport> {
  let bounds;
  try {
    bounds = reportBounds(from, to);
  } catch {
    throw new ApiError(400, 'Choose valid dates covering at most one year.');
  }
  const { start, end } = bounds;
  const profile = await profileFor(uid),
    grants = await resolvedReportingAccess(profile);
  const grant = grants.find((g) => g.hospital.id === hid && g.departments.includes(dep));
  check(grant, 403, 'This reporting scope is outside your access.');
  const h = db.doc(`hospitals/${hid}`),
    base = (name: string) => h.collection(name).where('departmentId', '==', dep);
  const [es, bs, ss, plannedBookings] = await Promise.all([
    base('theatreEntries')
      .where('operationDate', '>=', theatreDay(new Date(start - 86400000)))
      .where('operationDate', '<=', to)
      .orderBy('operationDate')
      .limit(5001)
      .get(),
    base('bookings')
      .where('inAt', '>=', new Date(start - 2 * 86400000).toISOString())
      .where('inAt', '<', new Date(end + 86400000).toISOString())
      .orderBy('inAt')
      .limit(5001)
      .get(),
    base('sessions')
      .where('start', '>=', new Date(start - 2 * 86400000).toISOString())
      .where('start', '<', new Date(end + 86400000).toISOString())
      .orderBy('start')
      .limit(2001)
      .get(),
    base('bookings')
      .where('start', '>=', new Date(start - 86400000).toISOString())
      .where('start', '<', new Date(end + 86400000).toISOString())
      .orderBy('start')
      .limit(5001)
      .get(),
  ]);
  check(
    es.size <= 5000 && bs.size <= 5000 && ss.size <= 2000 && plannedBookings.size <= 5000,
    422,
    'This report exceeds the preview limit. Select a shorter period. No partial totals are shown.',
  );
  const stored = es.docs.map((d) => d.data() as TheatreEntry),
    bookings = [
      ...new Map(
        [...bs.docs, ...plannedBookings.docs].map((d) => [d.id, d.data() as Booking]),
      ).values(),
    ].filter((b) => {
      const when = Date.parse(b.inAt ?? b.start);
      return (
        when < end &&
        (when >= start || (b.status === 'Completed' && Date.parse(b.outAt ?? '') > start))
      );
    }),
    sessions = ss.docs.map((d) => d.data() as TheatreSession);
  // Read only the case references required by bookings, in bounded batches.
  const cases: SurgicalCase[] = [];
  const ids = [...new Set(bookings.filter((b) => b.status === 'Completed').map((b) => b.caseId))];
  for (let i = 0; i < ids.length; i += 100) {
    const docs = await db.getAll(
      ...ids.slice(i, i + 100).map((id) => h.collection('cases').doc(id)),
    );
    cases.push(
      ...docs
        .filter((d) => d.exists && d.get('departmentId') === dep)
        .map((d) => d.data() as SurgicalCase),
    );
  }
  // Sessions can be outside the report period when an operation happened late.
  const missingSessionIds = [...new Set(bookings.map((b) => b.sessionId))].filter(
    (id) => !sessions.some((s) => s.id === id),
  );
  const linkedSessions = [...sessions];
  for (let i = 0; i < missingSessionIds.length; i += 100) {
    const docs = await db.getAll(
      ...missingSessionIds.slice(i, i + 100).map((id) => h.collection('sessions').doc(id)),
    );
    linkedSessions.push(
      ...docs
        .filter((d) => d.exists && d.get('departmentId') === dep)
        .map((d) => d.data() as TheatreSession),
    );
  }
  const linked = new Set(stored.map((e) => e.bookingId).filter(Boolean));
  const derived = completedBookingEntries(bookings, linkedSessions, cases);
  const entries = [...stored, ...derived.filter((e) => !linked.has(e.bookingId))];
  const summary = theatreMetrics(entries, sessions, from, to);
  const missing = bookings.filter(
    (b) =>
      b.status === 'Completed' && !linked.has(b.id) && !derived.some((e) => e.bookingId === b.id),
  );
  const missingTimings = missing.length;
  if (missingTimings) summary.utilisation = null;
  const series: TheatreReport['series'] = [];
  const monthly = end - start > 40 * 86400000;
  for (let cursor = start; cursor < end;) {
    const day = theatreDay(new Date(cursor)),
      next = monthly ? Date.parse(`${day.slice(0, 7)}-01T00:00:00+02:00`) : cursor;
    const local = new Date(next + 7200000);
    const stop = monthly
      ? Math.min(end, Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1) - 7200000)
      : Math.min(end, cursor + 86400000);
    const last = theatreDay(new Date(stop - 1)),
      m = theatreMetrics(entries, sessions, day, last);
    series.push({
      label: monthly ? day.slice(0, 7) : day,
      cases: cursor >= Date.now() ? null : m.cases,
      procedures: cursor >= Date.now() ? null : m.procedures,
      utilisation: missing.some(
        (b) => theatreDay(b.inAt ?? b.start) >= day && theatreDay(b.inAt ?? b.start) <= last,
      )
        ? null
        : m.utilisation,
      turnaround: m.averageTurnaroundMinutes,
      starting: m.averageStartMinutes,
    });
    cursor = stop;
  }
  const asOf = new Date().toISOString();
  await h.collection('audit').add({
    actorId: uid,
    actor: profile.name,
    action: 'theatre-report.read',
    departmentId: dep,
    caseId: null,
    at: asOf,
    occurredAt: asOf,
    recordedAt: asOf,
    reason: '',
    before: null,
    after: { from, to },
  });
  return {
    from,
    to,
    asOf,
    hospitalName: grant.hospital.name,
    departmentName: grant.hospital.departments.find((d) => d.id === dep)?.name ?? dep,
    summary,
    series,
    missingTimings,
  };
}
