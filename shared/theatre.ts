import { z } from 'zod';
import type { Booking, Patient, SurgicalCase, TheatreSession, Workspace } from './domain.ts';

const id = z.string().regex(/^[\w-]{1,100}$/);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a real calendar date',
  );
const instant = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(160);
export const theatreEntrySchema = z
  .object({
    entryId: id,
    version: z.number().int().nonnegative(),
    departmentId: id,
    bookingId: id.nullable(),
    patientRef: text,
    patientName: text,
    dob: z.union([date, z.literal('')]),
    age: z.number().int().min(0).max(130).nullable(),
    ageUnit: z.enum(['years', 'months', 'days']),
    sex: z.enum(['Female', 'Male', 'Not recorded']),
    admissionDate: z.union([date, z.literal('')]),
    ward: z.string().trim().max(160),
    theatre: text,
    procedures: z.array(text).min(1).max(10),
    surgeon: text,
    assistant: z.string().trim().max(160),
    anaesthetist: z.string().trim().max(160),
    inAt: instant,
    outAt: instant,
    status: z.enum(['Draft', 'Verified']),
    source: z.enum(['Manual entry', 'Historical register', 'Booked surgery']),
    sourceReference: z.string().trim().max(240),
    notes: z.string().trim().max(2000),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict()
  .superRefine((d, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (
      Date.parse(d.outAt) <= Date.parse(d.inAt) ||
      Date.parse(d.outAt) - Date.parse(d.inAt) > 86400000
    )
      fail('outAt', 'Exit must follow entry and be within 24 hours');
    const day = theatreDay(d.inAt);
    if (d.dob && d.dob > day) fail('dob', 'DOB must be on or before the operation');
    if (d.admissionDate && d.admissionDate > day)
      fail('admissionDate', 'Admission must be on or before the operation');
    if (d.dob && d.age !== null) fail('age', 'Use known DOB or recorded age, not both');
    if (d.ageUnit === 'months' && d.age !== null && d.age > 24)
      fail('age', 'Use years for ages above 24 months');
    if (d.ageUnit === 'days' && d.age !== null && d.age > 90)
      fail('age', 'Use months or years above 90 days');
    if (new Set(d.procedures.map((p) => p.toLowerCase())).size !== d.procedures.length)
      fail('procedures', 'List each procedure once');
    if ((d.source === 'Booked surgery') !== !!d.bookingId)
      fail('bookingId', 'Booked surgery must link to its booking');
  });
export type TheatreEntryInput = z.infer<typeof theatreEntrySchema>;
export type TheatreEntry = Omit<TheatreEntryInput, 'entryId' | 'reason'> & {
  id: string;
  operationDate: string;
  caseId: string | null;
  sessionId: string | null;
  recordedAt: string;
  updatedAt: string;
  recordedBy: string;
  verifiedBy: string | null;
};
export const theatreDay = (value: string | Date) =>
  new Date(+new Date(value) + 7200000).toISOString().slice(0, 10);
export function projectedEntry(
  d: TheatreEntryInput,
  at: string,
  previous?: TheatreEntry,
): TheatreEntry {
  const { entryId, reason: _reason, ...values } = d;
  return {
    ...values,
    id: entryId,
    inAt: new Date(d.inAt).toISOString(),
    outAt: new Date(d.outAt).toISOString(),
    operationDate: theatreDay(d.inAt),
    version: d.version + 1,
    caseId: previous?.caseId ?? null,
    sessionId: previous?.sessionId ?? null,
    recordedAt: previous?.recordedAt ?? at,
    updatedAt: at,
    recordedBy: previous?.recordedBy ?? '',
    verifiedBy: null,
  };
}

// Existing completed bookings remain visible without migration or duplicate register records.
export function completedBookingEntries(
  bookings: Booking[],
  sessions: TheatreSession[],
  cases: SurgicalCase[],
  patients: Patient[] = [],
): TheatreEntry[] {
  return bookings.flatMap((b) => {
    if (
      b.status !== 'Completed' ||
      !b.inAt ||
      !b.outAt ||
      !Number.isFinite(Date.parse(b.inAt)) ||
      !Number.isFinite(Date.parse(b.outAt)) ||
      Date.parse(b.outAt) <= Date.parse(b.inAt)
    )
      return [];
    const s = sessions.find((s) => s.id === b.sessionId),
      c = cases.find((c) => c.id === b.caseId),
      p = patients.find((p) => p.id === c?.patientId);
    if (!s || !c) return [];
    return [
      {
        id: b.id,
        version: 0,
        departmentId: b.departmentId,
        bookingId: b.id,
        caseId: b.caseId,
        sessionId: b.sessionId,
        patientRef: p?.ref ?? '',
        patientName: p?.name ?? '',
        dob: p?.dob ?? '',
        age: null,
        ageUnit: 'years' as const,
        sex: 'Not recorded' as const,
        admissionDate: '',
        ward: '',
        theatre: s.theatre,
        procedures: [c.procedure],
        surgeon: s.surgeon,
        assistant: '',
        anaesthetist: '',
        inAt: b.inAt,
        outAt: b.outAt,
        operationDate: theatreDay(b.inAt),
        status: 'Verified' as const,
        source: 'Booked surgery' as const,
        sourceReference: '',
        notes: '',
        recordedAt: b.outAt,
        updatedAt: b.outAt,
        recordedBy: '',
        verifiedBy: null,
      },
    ];
  });
}
export function registerEntries(w: Workspace) {
  const stored = w.theatreEntries ?? [];
  const linked = new Set(stored.map((e) => e.bookingId).filter(Boolean));
  return [
    ...stored,
    ...completedBookingEntries(w.bookings, w.sessions, w.cases, w.patients).filter(
      (e) => !linked.has(e.bookingId),
    ),
  ].sort((a, b) => Date.parse(b.inAt) - Date.parse(a.inAt));
}
export type ReportPeriod = 'Week' | 'Month' | 'Quarter' | 'Financial year';
const isoDate = (v: Date) => v.toISOString().slice(0, 10);
export function theatrePeriod(period: ReportPeriod, anchor: string) {
  const d = new Date(`${date.parse(anchor)}T12:00:00Z`),
    year = d.getUTCFullYear(),
    month = d.getUTCMonth();
  let start: Date, end: Date;
  if (period === 'Week') {
    start = new Date(d);
    start.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
  } else if (period === 'Month') {
    start = new Date(Date.UTC(year, month, 1, 12));
    end = new Date(Date.UTC(year, month + 1, 1, 12));
  } else if (period === 'Quarter') {
    const q = Math.floor(month / 3) * 3;
    start = new Date(Date.UTC(year, q, 1, 12));
    end = new Date(Date.UTC(year, q + 3, 1, 12));
  } else {
    const fy = month < 3 ? year - 1 : year;
    start = new Date(Date.UTC(fy, 3, 1, 12));
    end = new Date(Date.UTC(fy + 1, 3, 1, 12));
  }
  end.setUTCDate(end.getUTCDate() - 1);
  return {
    from: isoDate(start),
    to: isoDate(end),
    financialYear: `${month < 3 ? year - 1 : year}/${String(month < 3 ? year : year + 1).slice(-2)}`,
  };
}
export function reportBounds(from: string, to: string) {
  date.parse(from);
  date.parse(to);
  const start = Date.parse(`${from}T00:00:00+02:00`),
    end = Date.parse(`${to}T00:00:00+02:00`) + 86400000;
  if (end <= start || end - start > 366 * 86400000)
    throw new Error('Choose a period of at most one year');
  return { start, end };
}
const unionMinutes = (ranges: number[][]) => {
  let end = -Infinity,
    total = 0;
  for (const [a, b] of ranges.sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, b - Math.max(a, end));
    end = Math.max(end, b);
  }
  return total / 60000;
};
export function theatreMetrics(
  entries: TheatreEntry[],
  sessions: TheatreSession[],
  from: string,
  to: string,
) {
  const bounds = reportBounds(from, to);
  const start = bounds.start,
    end = Math.min(bounds.end, Date.now());
  const rows = entries.filter((e) => e.operationDate >= from && e.operationDate <= to);
  const verified = rows.filter((e) => e.status === 'Verified');
  // Carry-in occupancy belongs to this period even when the operation count belongs to yesterday.
  const occupied = entries.filter(
    (e) => e.status === 'Verified' && Date.parse(e.inAt) < end && Date.parse(e.outAt) > start,
  );
  const planned = sessions.filter((s) => Date.parse(s.start) < end && Date.parse(s.end) > start);
  let availableMinutes = 0,
    usedMinutes = 0,
    overlappingEntries = 0;
  const locations = new Set(planned.map((s) => s.theatre));
  for (const location of locations) {
    const windows = planned
      .filter((s) => s.theatre === location)
      .map((s) => [Math.max(start, Date.parse(s.start)), Math.min(end, Date.parse(s.end))]);
    availableMinutes += unionMinutes(windows);
    usedMinutes += unionMinutes(
      occupied
        .filter((e) => e.theatre === location)
        .flatMap((e) =>
          windows
            .map(([a, b]) => [Math.max(a, Date.parse(e.inAt)), Math.min(b, Date.parse(e.outAt))])
            .filter(([a, b]) => b > a),
        ),
    );
  }
  const starts: number[] = [],
    delays: number[] = [],
    gaps: number[] = [];
  // Detect overlaps across session boundaries as well as nested intervals.
  for (const theatre of new Set(occupied.map((e) => e.theatre))) {
    let latestExit = -Infinity;
    for (const e of occupied
      .filter((e) => e.theatre === theatre)
      .sort((a, b) => Date.parse(a.inAt) - Date.parse(b.inAt))) {
      if (Date.parse(e.inAt) < latestExit) overlappingEntries++;
      latestExit = Math.max(latestExit, Date.parse(e.outAt));
    }
  }
  const groups = new Map<string, TheatreEntry[]>();
  for (const e of verified) {
    // Unplanned activity is grouped by location/day; it never invents staffed capacity.
    const session =
      planned.find((s) => s.id === e.sessionId) ??
      planned.find(
        (s) =>
          s.theatre === e.theatre &&
          Date.parse(e.inAt) >= Date.parse(s.start) &&
          Date.parse(e.inAt) < Date.parse(s.end),
      );
    const key = session ? `session:${session.id}` : `day:${e.theatre}:${e.operationDate}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  for (const [key, group] of groups) {
    group.sort((a, b) => Date.parse(a.inAt) - Date.parse(b.inAt));
    const first = group[0],
      local = new Date(Date.parse(first.inAt) + 7200000);
    starts.push(local.getUTCHours() * 60 + local.getUTCMinutes() + local.getUTCSeconds() / 60);
    const session = planned.find((s) => key === `session:${s.id}`);
    if (session) delays.push((Date.parse(first.inAt) - Date.parse(session.start)) / 60000);
    let latestExit = Date.parse(first.outAt);
    for (let i = 1; i < group.length; i++) {
      const gap = (Date.parse(group[i].inAt) - latestExit) / 60000;
      if (gap >= 0) gaps.push(gap);
      latestExit = Math.max(latestExit, Date.parse(group[i].outAt));
    }
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const breakdown = (key: 'theatre' | 'surgeon' | 'anaesthetist' | 'procedures') => {
    const map = new Map<string, { name: string; cases: number; minutes: number }>();
    for (const e of verified)
      for (const name of key === 'procedures' ? e.procedures : [e[key] || 'Not recorded']) {
        const row = map.get(name) ?? { name, cases: 0, minutes: 0 };
        row.cases++;
        row.minutes += (Date.parse(e.outAt) - Date.parse(e.inAt)) / 60000;
        map.set(name, row);
      }
    return [...map.values()].sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name));
  };
  return {
    cases: verified.length,
    procedures: verified.reduce((n, e) => n + e.procedures.length, 0),
    drafts: rows.length - verified.length,
    availableMinutes,
    usedMinutes,
    utilisation: availableMinutes ? (100 * usedMinutes) / availableMinutes : null,
    averageStartMinutes: mean(starts),
    startObservations: starts.length,
    averageDelayMinutes: mean(delays),
    delayObservations: delays.length,
    averageTurnaroundMinutes: mean(gaps),
    turnaroundObservations: gaps.length,
    overlappingEntries,
    theatres: breakdown('theatre'),
    surgeons: breakdown('surgeon'),
    anaesthetists: breakdown('anaesthetist'),
    operationTypes: breakdown('procedures'),
  };
}
export type TheatreReport = {
  from: string;
  to: string;
  asOf: string;
  hospitalName: string;
  departmentName: string;
  missingTimings: number;
  summary: ReturnType<typeof theatreMetrics>;
  series: {
    label: string;
    cases: number | null;
    procedures: number | null;
    utilisation: number | null;
    turnaround: number | null;
    starting: number | null;
  }[];
};
