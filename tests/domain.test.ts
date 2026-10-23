import { describe, it, expect } from 'vitest';
import {
  dueDate,
  waitDays,
  metrics,
  overlaps,
  operationSchema,
  backlogOrder,
  bookingNeedsOutcome,
  caseNeedsAttention,
  nextAvailableStart,
  nextOperatingSlot,
  backlogTrend,
  ageYears,
  applyDiagnosis,
  canOperate,
  diagnosisLabel,
  ICD10_SYSTEM,
  type Operation,
  type SurgicalCase,
  type TheatreSession,
  type Booking,
} from '../shared/domain.ts';
const now = '2026-10-03T18:00:00.000Z';
const c = (
  id: string,
  listedAt: string,
  status: SurgicalCase['status'] = 'Waiting',
): SurgicalCase => ({
  id,
  patientId: id,
  departmentId: 'general',
  procedure: 'Synthetic procedure',
  surgeon: 'Test surgeon',
  priority: 'P2',
  listedAt,
  urgencyAt: listedAt,
  dueAt: dueDate(listedAt, 'P2'),
  status,
  readiness: 'Ready',
  duration: 60,
  notes: '',
  version: 1,
  createdAt: listedAt,
  updatedAt: listedAt,
});
const session: TheatreSession = {
  id: 's',
  departmentId: 'general',
  date: '2026-10-02',
  theatre: 'T1',
  surgeon: 'Test surgeon',
  start: '2026-10-02T06:00:00.000Z',
  end: '2026-10-02T10:00:00.000Z',
  version: 1,
};
const b = (id: string, inAt: string | null, outAt: string | null): Booking => ({
  id,
  caseId: id,
  sessionId: 's',
  departmentId: 'general',
  start: session.start,
  end: session.end,
  status: 'Completed',
  inAt,
  outAt,
  reason: '',
  version: 1,
});
describe('priority and South African calendar boundaries', () => {
  it('orders waiting patients by the instant, including explicit timezone offsets', () => {
    const earlier = c('earlier', '2026-10-02T08:00:00+02:00');
    const later = c('later', '2026-10-02T07:00:00Z');
    expect([later, earlier].sort(backlogOrder).map((item) => item.id)).toEqual([
      'earlier',
      'later',
    ]);
  });
  it('does not offer occupied capacity when bookings use different timezone offsets', () => {
    const bookings: Booking[] = [
      {
        ...b('early', null, null),
        start: '2026-10-02T08:00:00+02:00',
        end: '2026-10-02T09:00:00+02:00',
      },
      { ...b('late', null, null), start: '2026-10-02T07:00:00Z', end: '2026-10-02T08:00:00Z' },
    ];
    expect(nextAvailableStart(session, bookings, 45)).toBe('2026-10-02T08:00:00.000Z');
  });
  it('finds the earliest free slot across theatres, not the earliest starting session', () => {
    const other = { ...session, id: 'other', theatre: 'T2', start: '2026-10-02T07:00:00Z' };
    const occupied = { ...b('occupied', null, null), end: '2026-10-02T09:00:00Z' };
    expect(
      nextOperatingSlot([session, other], [occupied], '2026-10-02T05:00:00Z')?.session.id,
    ).toBe('other');
  });
  it('withholds utilisation even when incomplete timing coverage would round to 100%', () => {
    const bookings = Array.from({ length: 201 }, (_, index) =>
      b(`attempt-${index}`, session.start, index === 200 ? null : session.end),
    );
    const result = metrics([], [session], bookings, now);
    expect(result.utilisation).toBeNull();
    expect(result.timingCoverage).toBeLessThan(100);
  });
  it('uses Leo-confirmed maximum treatment times of 30, 90 and 365 days', () => {
    expect(dueDate('2026-01-01T08:00:00.000Z', 'P1')).toBe('2026-01-31T08:00:00.000Z');
    expect(dueDate('2026-01-01T08:00:00.000Z', 'P2')).toBe('2026-04-01T08:00:00.000Z');
    expect(dueDate('2026-01-01T08:00:00.000Z', 'P3')).toBe('2027-01-01T08:00:00.000Z');
  });
  it('uses the local calendar near midnight', () => {
    expect(waitDays('2026-10-01T21:59:00.000Z', '2026-10-01T22:01:00.000Z')).toBe(1);
  });
  it('calculates age from a date-only birth date', () => {
    expect(ageYears('1980-10-04', '2026-10-03')).toBe(45);
    expect(ageYears('1980-10-04', '2026-10-04')).toBe(46);
  });
  it('does not overlap adjacent slots', () => {
    expect(
      overlaps('2026-10-01T06:00Z', '2026-10-01T07:00Z', '2026-10-01T07:00Z', '2026-10-01T08:00Z'),
    ).toBe(false);
  });
  it('finds the earliest session gap that fits surgery plus turnover', () => {
    const occupied: Booking = {
      ...b('occupied', null, null),
      caseId: 'occupied',
      status: 'Scheduled',
      start: '2026-10-02T06:00:00.000Z',
      end: '2026-10-02T07:00:00.000Z',
    };
    expect(nextAvailableStart(session, [occupied], 45)).toBe('2026-10-02T07:00:00.000Z');
    expect(nextAvailableStart(session, [occupied], 180)).toBeNull();
    expect(nextAvailableStart(session, [{ ...occupied, status: 'Cancelled' }], 45)).toBe(
      session.start,
    );
  });
  it('finds the next real unallocated theatre slot', () => {
    const upcoming: TheatreSession = {
        ...session,
        id: 'upcoming',
        date: '2026-10-04',
        start: '2026-10-04T06:00:00.000Z',
        end: '2026-10-04T10:00:00.000Z',
      },
      first: Booking = {
        ...b('first', null, null),
        sessionId: upcoming.id,
        status: 'Scheduled',
        start: '2026-10-04T06:00:00.000Z',
        end: '2026-10-04T07:00:00.000Z',
      },
      second: Booking = {
        ...b('second', null, null),
        sessionId: upcoming.id,
        status: 'Scheduled',
        start: '2026-10-04T08:30:00.000Z',
        end: '2026-10-04T09:30:00.000Z',
      };
    const slot = nextOperatingSlot([upcoming], [first, second], '2026-10-04T05:00:00.000Z');
    expect(slot?.start).toBe('2026-10-04T07:00:00.000Z');
    expect(slot?.freeMinutes).toBe(90);
    expect(nextOperatingSlot([upcoming], [first, second], upcoming.end)).toBeNull();
  });
  it('flags a past active booking for attention without changing case status', () => {
    const scheduledCase = c('booked', '2026-09-30T06:00:00Z', 'Scheduled');
    const booking: Booking = {
      ...b('booked', null, null),
      status: 'Scheduled',
      end: now,
    };
    expect(bookingNeedsOutcome(booking, now)).toBe(true);
    expect(caseNeedsAttention(scheduledCase, [booking], now)).toBe(true);
    const report = metrics([scheduledCase], [], [booking], now);
    expect(report.requiresAction).toBe(1);
    expect(report.missingOutcomes).toBe(1);
    expect(scheduledCase.status).toBe('Scheduled');
    expect(bookingNeedsOutcome({ ...booking, status: 'Cancelled' }, now)).toBe(false);
    expect(bookingNeedsOutcome({ ...booking, end: '2026-10-03T18:00:01.000Z' }, now)).toBe(false);
  });
  it('orders backlog cases by priority and then longest waiting', () => {
    const cases = [
      { ...c('p3', '2026-01-01T06:00:00Z'), priority: 'P3' as const },
      { ...c('p1-new', '2026-10-02T06:00:00Z'), priority: 'P1' as const },
      { ...c('p2', '2026-02-01T06:00:00Z'), priority: 'P2' as const },
      { ...c('p1-old', '2026-09-01T06:00:00Z'), priority: 'P1' as const },
    ];
    expect(cases.sort(backlogOrder).map((item) => item.id)).toEqual([
      'p1-old',
      'p1-new',
      'p2',
      'p3',
    ]);
  });
  it('rejects invalid dates and injected fields', () => {
    const base = {
      id: crypto.randomUUID(),
      occurredAt: now,
      recordedAt: now,
      type: 'register',
      data: {
        caseId: 'c',
        patientRef: 'x',
        patientName: 'Synthetic',
        dob: '2026-02-30',
        phone: '',
        departmentId: 'general',
        procedure: 'Test',
        surgeon: '',
        priority: 'P1',
        listedAt: now,
        urgencyAt: now,
        readiness: 'Ready',
        notes: '',
      },
    };
    expect(operationSchema.safeParse(base).success).toBe(false);
    expect(
      operationSchema.safeParse({ ...base, data: { ...base.data, dob: '', role: 'admin' } })
        .success,
    ).toBe(false);
    expect(
      operationSchema.safeParse({ ...base, data: { ...base.data, dob: '', priority: 'P1a' } })
        .success,
    ).toBe(false);
  });
});
describe('metric cohorts and missing data', () => {
  it('does not invent historical priorities for cases with no recorded history', () => {
    const missing = c('missing', '2026-05-10T06:00:00Z');
    const partial = {
      ...missing,
      id: 'partial',
      priorityHistory: [{ priority: 'P1' as const, at: '2026-09-01T06:00:00Z' }],
    };
    const result = metrics([missing, partial], [], [], '2026-10-15T10:00:00Z');
    expect(
      result.backlogTrend.slice(0, 4).every((point) => point.P1 + point.P2 + point.P3 === 0),
    ).toBe(true);
    expect(result.backlogTrend[5]).toMatchObject({ P1: 1, P2: 0, P3: 0 });
    expect(result.trendCoverage).toBe(50);
    expect(result.outstanding).toBe(2);
  });
  it('reconstructs monthly P1, P2 and P3 backlog from lifecycle and priority history', () => {
    const first: SurgicalCase = {
        ...c('first', '2026-05-10T06:00:00Z'),
        priority: 'P1',
        priorityHistory: [
          { priority: 'P3', at: '2026-05-10T06:00:00Z' },
          { priority: 'P1', at: '2026-09-05T06:00:00Z' },
        ],
      },
      second: SurgicalCase = {
        ...c('second', '2026-06-15T06:00:00Z', 'Completed'),
        priority: 'P2',
        priorityHistory: [{ priority: 'P2', at: '2026-06-15T06:00:00Z' }],
        updatedAt: '2026-08-20T08:00:00Z',
      },
      completion: Booking = {
        ...b('second', '2026-08-20T07:00:00Z', '2026-08-20T08:00:00Z'),
        caseId: 'second',
      };
    expect(
      backlogTrend([first, second], [completion], '2026-10-15T10:00:00Z').map(({ P1, P2, P3 }) => [
        P1,
        P2,
        P3,
      ]),
    ).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
      [1, 0, 0],
      [1, 0, 0],
    ]);
  });
  it('includes scheduled and held cases and uses a true median', () => {
    const m = metrics(
      [
        c('a', '2026-10-01T06:00:00Z'),
        c('b', '2026-09-30T06:00:00Z', 'Scheduled'),
        c('c', '2026-09-27T06:00:00Z', 'On hold'),
        c('d', '2026-09-26T06:00:00Z'),
        c('e', '2020-01-01T06:00:00Z', 'Completed'),
      ],
      [],
      [],
      now,
    );
    expect(m.outstanding).toBe(4);
    expect(m.medianWait).toBe(4.5);
    expect(m.p90Wait).toBe(7);
    expect(m.ready).toBe(2);
  });
  it('clips and unions theatre occupancy without double counting', () => {
    const m = metrics(
      [],
      [session],
      [
        b('1', '2026-10-02T05:00:00Z', '2026-10-02T08:00:00Z'),
        b('2', '2026-10-02T07:00:00Z', '2026-10-02T09:00:00Z'),
      ],
      now,
    );
    expect(m.utilisation).toBe(75);
    expect(m.timingCoverage).toBe(100);
  });
  it('distinguishes missing timings from zero utilisation', () => {
    expect(metrics([], [session], [b('1', null, null)], now).utilisation).toBeNull();
    expect(metrics([], [session], [], now).utilisation).toBe(0);
    expect(metrics([], [], [], now).utilisation).toBeNull();
  });
  it('counts delayed uploads by actual completion and deduplicates case outcomes', () => {
    const complete = b('1', '2026-10-02T06:00:00Z', '2026-10-02T07:00:00Z');
    const m = metrics(
      [],
      [],
      [
        complete,
        { ...complete, id: 'duplicate' },
        { ...complete, id: 'old', caseId: 'old', outAt: '2026-08-01T07:00:00Z' },
        { ...complete, id: 'future', caseId: 'future', outAt: '2026-10-04T07:00:00Z' },
      ],
      now,
    );
    expect(m.completed).toBe(1);
    expect(m.weekly.reduce((n, d) => n + d.completed, 0)).toBe(1);
  });
});
describe('pre-procedure diagnosis', () => {
  const registration = {
    id: crypto.randomUUID(),
    occurredAt: now,
    recordedAt: now,
    type: 'register' as const,
    data: {
      caseId: 'c',
      patientRef: 'SYN-1',
      patientName: 'Synthetic',
      dob: '',
      phone: '',
      departmentId: 'general',
      procedure: 'Synthetic procedure',
      surgeon: '',
      priority: 'P2' as const,
      listedAt: now,
      urgencyAt: now,
      readiness: 'Needs assessment' as const,
      notes: '',
    },
  };
  it('keeps a registration without a diagnosis valid', () => {
    const parsed = operationSchema.parse(registration);
    expect(parsed.type === 'register' && parsed.data.diagnosis).toBeUndefined();
    expect(parsed.type === 'register' && parsed.data.icd10Code).toBeUndefined();
    const stored = applyDiagnosis({ procedure: 'Synthetic procedure' }, undefined, undefined);
    expect(stored).toEqual({ procedure: 'Synthetic procedure' });
    expect(diagnosisLabel(stored)).toBe('');
  });
  it('accepts WHO ICD-10 format only and stores the code for a later lookup', () => {
    for (const code of ['K35', 'k35.8', ' A00.0 ', 'M17.1', 'Z99', 'S72.00']) {
      const parsed = operationSchema.parse({
        ...registration,
        data: { ...registration.data, diagnosis: '  Synthetic appendicitis  ', icd10Code: code },
      });
      if (parsed.type !== 'register') throw new Error('expected registration');
      expect(parsed.data.diagnosis).toBe('Synthetic appendicitis');
      expect(parsed.data.icd10Code).toMatch(/^[A-Z]\d{2}(\.\d{1,2})?$/);
    }
    for (const code of [
      '11A',
      'K3',
      'K355',
      'K35.',
      'K35.12345',
      'CA40.0',
      'ICD10',
      'K35.8*',
      'S72.001A',
      'S72.001',
      'K35.A',
      'C34.9X',
    ]) {
      expect(
        operationSchema.safeParse({
          ...registration,
          data: { ...registration.data, icd10Code: code },
        }).success,
      ).toBe(false);
    }
    const stored = applyDiagnosis({}, 'Synthetic appendicitis', 'k35.8');
    expect(stored).toEqual({
      diagnosis: 'Synthetic appendicitis',
      icd10: { system: ICD10_SYSTEM, code: 'K35.8' },
    });
    expect(diagnosisLabel(stored)).toBe('Synthetic appendicitis · K35.8');
    expect(applyDiagnosis(stored, '', '').diagnosis).toBeUndefined();
    expect(applyDiagnosis(stored, '', '').icd10).toBeUndefined();
    expect(diagnosisLabel({ icd10: { code: 'K40.9' } })).toBe('K40.9');
  });
  it('limits the free-text diagnosis to 500 characters', () => {
    const withDiagnosis = (diagnosis: string) =>
      operationSchema.safeParse({ ...registration, data: { ...registration.data, diagnosis } });
    expect(withDiagnosis('x'.repeat(500)).success).toBe(true);
    expect(withDiagnosis('x'.repeat(501)).success).toBe(false);
  });
  it('lets the same roles that edit case notes record a diagnosis', () => {
    const parsed = operationSchema.parse({
      id: crypto.randomUUID(),
      occurredAt: now,
      recordedAt: now,
      type: 'diagnosis',
      data: {
        caseId: 'c',
        version: 1,
        diagnosis: 'Synthetic appendicitis',
        icd10Code: 'K35.8',
        reason: 'Synthetic correction',
      },
    });
    for (const role of ['doctor', 'nurse', 'clerk', 'clinician', 'recorder', 'super_user'] as const)
      expect(canOperate(role, parsed)).toBe(true);
    for (const role of ['system_admin_read', 'major_read', 'viewer', 'coordinator'] as const)
      expect(canOperate(role, parsed)).toBe(false);
    const cleared = operationSchema.parse({
      ...parsed,
      data: { ...parsed.data, diagnosis: '   ', icd10Code: '' },
    } as Operation);
    expect(cleared.type === 'diagnosis' && cleared.data.diagnosis).toBe('');
    expect(cleared.type === 'diagnosis' && cleared.data.icd10Code).toBe('');
  });
});
