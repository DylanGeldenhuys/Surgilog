import { z } from 'zod';
import { theatreEntrySchema, type TheatreEntry } from './theatre.ts';

export const roles = [
  'super_user',
  'major_write',
  'major_read',
  'system_admin_write',
  'system_admin_read',
  'doctor',
  'nurse',
  'clerk',
  // Read older prepared workspaces without silently promoting their accounts.
  'clinician',
  'coordinator',
  'recorder',
  'admin',
  'viewer',
] as const;
export type Role = (typeof roles)[number];
export const reportingRoles = [
  'global_viewer',
  'regional_viewer',
  'country_viewer',
  'state_viewer',
  'district_viewer',
] as const;
export type ReportingRole = (typeof reportingRoles)[number];
export type ReportingGrant = {
  role: ReportingRole;
  region?: string;
  country?: string;
  province?: string;
  district?: string;
};
export type Priority = 'P1' | 'P2' | 'P3';
export const genderOptions = [
  'Female',
  'Male',
  'Non-binary',
  'Another term',
  'Prefer not to say',
  'Not recorded',
] as const;
export type Gender = (typeof genderOptions)[number];
/** WHO ICD-10, the revision used in South Africa. This is not ICD-11. */
export const ICD10_SYSTEM = 'icd-10-who' as const;
export type Icd10Coding = {
  system: typeof ICD10_SYSTEM;
  /**
   * Format-validated code only. A later catalogue lookup can add a display
   * name or edition on this object without changing `system` or `code`.
   */
  code: string;
};
/**
 * WHO ICD-10: category plus an optional one- or two-digit subdivision, for
 * example K35 or K35.8. US ICD-10-CM codes such as S72.001A are rejected.
 */
export const icd10CodePattern = /^[A-Z]\d{2}(\.\d{1,2})?$/;
export const diagnosisTextSchema = z.string().trim().max(500);
export const icd10CodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .max(8)
  .refine(
    (value) => value === '' || icd10CodePattern.test(value),
    'Enter a WHO ICD-10 code such as K35 or K35.8',
  );
export type CaseStatus =
  'Waiting' | 'Scheduled' | 'In theatre' | 'Completed' | 'On hold' | 'Closed';
export type Membership = { hospitalId: string; role: Role; departments: string[] };
export type Profile = {
  uid: string;
  name: string;
  email: string;
  active: boolean;
  superUser?: boolean;
  version?: number;
  memberships: Membership[];
  reportingGrants?: ReportingGrant[];
};
export type Hospital = {
  id: string;
  name: string;
  city: string;
  region: string;
  country: string;
  province: string;
  district: string;
  departments: { id: string; name: string }[];
  theatres: string[];
  surgeons: string[];
  version?: number;
  turnaroundMinutes?: number;
};
export type ReportingAccess = { hospitalId: string; departments: string[] };
export type Identity = {
  profile: Profile;
  hospitals: Hospital[];
  reportingAccess: ReportingAccess[];
};
export type Patient = {
  id: string;
  ref: string;
  name: string;
  dob: string;
  gender?: Gender;
  phone: string;
  version: number;
};
export type SurgicalCase = {
  id: string;
  patientId: string;
  departmentId: string;
  procedure: string;
  /** Free-text diagnosis captured before the procedure. Absent when not recorded. */
  diagnosis?: string;
  /** Optional WHO ICD-10 coding. Absent when not recorded, including older entries. */
  icd10?: Icd10Coding;
  surgeon: string;
  priority: Priority;
  priorityAssignedBy?: string;
  priorityHistory?: { priority: Priority; at: string }[];
  listedAt: string;
  urgencyAt: string;
  dueAt: string;
  status: CaseStatus;
  readiness: 'Ready' | 'Needs assessment' | 'Not ready';
  duration: number | null;
  notes: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};
export type TheatreSession = {
  id: string;
  departmentId: string;
  theatre: string;
  date: string;
  start: string;
  end: string;
  surgeon: string;
  version: number;
};
export type Booking = {
  id: string;
  caseId: string;
  sessionId: string;
  departmentId: string;
  start: string;
  end: string;
  status: 'Scheduled' | 'In theatre' | 'Completed' | 'Cancelled';
  inAt: string | null;
  outAt: string | null;
  reason: string;
  estimatedMinutes?: number;
  turnoverMinutes?: number;
  version: number;
};
export type Audit = {
  id: string;
  caseId: string | null;
  departmentId: string;
  actor: string;
  actorId: string;
  action: string;
  reason: string;
  at: string;
  occurredAt: string;
  recordedAt: string;
  before: unknown;
  after: unknown;
};
export type Metrics = {
  outstanding: number;
  ready: number;
  overdue: number;
  requiresAction: number;
  missingOutcomes: number;
  completed: number;
  medianWait: number;
  p90Wait: number;
  utilisation: number | null;
  timingCoverage: number;
  cancelled: number;
  byPriority: { name: string; count: number }[];
  weekly: { name: string; completed: number }[];
  backlogTrend: { name: string; at: string; P1: number; P2: number; P3: number }[];
  trendCoverage: number;
};
export type ReportingSummary = {
  hospitalId: string;
  hospitalName: string;
  departmentId: string | null;
  departmentName: string | null;
  metrics: Metrics;
};
export type ReportingDepartmentSelection = {
  hospitalId: string;
  departmentId: string;
};
export type ReportingWorkspace = {
  scope: {
    hospitalId: string | null;
    departmentId: string | null;
    hospitalIds: string[];
    departments: ReportingDepartmentSelection[];
    label: string;
  };
  metrics: Metrics;
  summaries: ReportingSummary[];
  asOf: string;
};
export type Workspace = {
  hospital: Hospital;
  departmentId: string;
  patients: Patient[];
  cases: SurgicalCase[];
  sessions: TheatreSession[];
  bookings: Booking[];
  metrics: Metrics;
  asOf: string;
  truncated: boolean;
  theatreEntries?: TheatreEntry[];
  theatreEntriesTruncated?: boolean;
};

const id = z.string().regex(/^[\w-]{1,100}$/);
const short = z.string().trim().min(1).max(160);
const instant = z.string().datetime({ offset: true });
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'Enter a valid date',
  );
export const newCaseSchema = z
  .object({
    patientId: id.optional(),
    caseId: id,
    patientRef: short,
    patientName: short,
    dob: z.union([calendarDateSchema, z.literal('')]),
    gender: z.enum(genderOptions).default('Not recorded'),
    phone: z.string().trim().max(40),
    departmentId: id,
    procedure: short,
    diagnosis: diagnosisTextSchema.optional(),
    icd10Code: icd10CodeSchema.optional(),
    surgeon: z.string().max(160),
    priority: z.enum(['P1', 'P2', 'P3']),
    priorityAssignedBy: z.string().trim().min(2).max(160).optional(),
    listedAt: instant,
    urgencyAt: instant,
    readiness: z.enum(['Ready', 'Needs assessment', 'Not ready']),
    // Accepted only so a pre-release pending registration from an older build can replay.
    // The case starts without an estimate; booking captures the current clinical estimate.
    duration: z.number().int().min(5).max(720).optional(),
    notes: z.string().trim().max(2000),
  })
  .strict();
export type NewCase = z.infer<typeof newCaseSchema>;
const base = { id: z.string().uuid(), occurredAt: instant, recordedAt: instant };
export const operationSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('theatre-entry'), data: theatreEntrySchema }).strict(),
  z.object({ ...base, type: z.literal('register'), data: newCaseSchema }).strict(),
  z
    .object({
      ...base,
      type: z.literal('patient'),
      data: z
        .object({
          caseId: id,
          patientId: id,
          version: z.number().int().positive(),
          name: short,
          dob: z.union([calendarDateSchema, z.literal('')]),
          gender: z.enum(genderOptions).optional(),
          phone: z.string().trim().max(40),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('case-notes'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          notes: z.string().trim().max(2000),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('diagnosis'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          diagnosis: diagnosisTextSchema,
          icd10Code: icd10CodeSchema,
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('priority'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          priority: z.enum(['P1', 'P2', 'P3']),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('readiness'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          readiness: z.enum(['Ready', 'Needs assessment', 'Not ready']),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('hold'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          hold: z.boolean(),
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('session'),
      data: z
        .object({
          sessionId: id,
          departmentId: id,
          theatre: short,
          date: calendarDateSchema,
          start: instant,
          end: instant,
          surgeon: short,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('book'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          sessionId: id,
          duration: z.number().int().min(5).max(720),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('activity'),
      data: z
        .object({
          caseId: id,
          version: z.number().int().positive(),
          bookingId: id,
          kind: z.enum(['start', 'complete', 'cancel']),
          reason: z.string().trim().max(1000),
        })
        .strict(),
    })
    .strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export type OperationResult = {
  id: string;
  caseId: string | null;
  acceptedAt: string;
  replayed?: boolean;
  // Older receipts predate these snapshots; clients can still replay them.
  changes?: {
    patient?: Patient;
    surgicalCase?: SurgicalCase;
    booking?: Booking;
    session?: TheatreSession;
    theatreEntry?: TheatreEntry;
  };
};
export type Pending = {
  departmentId?: string;
  operation: Operation;
  hospitalId: string;
  status: 'pending' | 'conflict' | 'rejected' | 'resolved';
  error?: string;
};
export function applyDiagnosis<T extends object>(
  record: T,
  diagnosis: string | undefined,
  icd10Code: string | undefined,
): Omit<T, 'diagnosis' | 'icd10'> & { diagnosis?: string; icd10?: Icd10Coding } {
  const next: Omit<T, 'diagnosis' | 'icd10'> & { diagnosis?: string; icd10?: Icd10Coding } = {
    ...record,
  };
  const text = diagnosis?.trim() ?? '';
  const code = icd10Code?.trim().toUpperCase() ?? '';
  if (code && !icd10CodePattern.test(code))
    throw new Error('Enter a WHO ICD-10 code such as K35 or K35.8.');
  if (text) next.diagnosis = text;
  else delete next.diagnosis;
  if (code) next.icd10 = { system: ICD10_SYSTEM, code };
  else delete next.icd10;
  return next;
}
export function diagnosisLabel(entry: { diagnosis?: string; icd10?: { code?: string } }) {
  const text = entry.diagnosis?.trim() ?? '';
  const code = entry.icd10?.code?.trim() ?? '';
  if (text && code) return `${text} · ${code}`;
  return text || code;
}
export const canConfigure = (role: Role) =>
  ['super_user', 'major_write', 'system_admin_write'].includes(role);
export const canClinical = (role: Role) =>
  canConfigure(role) || ['doctor', 'clinician'].includes(role);
export const canSchedule = (role: Role) => canClinical(role);
export const canRecord = (role: Role) =>
  canSchedule(role) || ['nurse', 'clerk', 'recorder'].includes(role);
export const canEditPatient = (role: Role) =>
  canClinical(role) || ['nurse', 'clerk', 'recorder'].includes(role);
export const canManageUsers = (role: Role) => canClinical(role);
export const canViewAdmin = (role: Role) =>
  canManageUsers(role) || ['major_read', 'system_admin_read'].includes(role);
export const canOperate = (role: Role, op: Operation) =>
  op.type === 'activity'
    ? op.data.kind === 'cancel'
      ? canSchedule(role)
      : canRecord(role)
    : op.type === 'session' || op.type === 'book'
      ? canSchedule(role)
      : ['register', 'patient', 'case-notes', 'diagnosis', 'theatre-entry'].includes(op.type)
        ? canEditPatient(role)
        : canClinical(role);
export const roleLabels: Record<Role, string> = {
  super_user: 'Super User',
  major_write: 'Major User · write',
  major_read: 'Major User · read only',
  system_admin_write: 'System Admin · write',
  system_admin_read: 'System Admin · read only',
  doctor: 'Doctor',
  nurse: 'Nurse',
  clerk: 'Clerk',
  clinician: 'Doctor',
  coordinator: 'Legacy scheduler',
  recorder: 'Nurse / clerk',
  admin: 'Legacy admin',
  viewer: 'Reports only',
};
export function effectiveMembership(profile: Profile, hospital: Hospital): Membership | undefined {
  if (!profile.active) return undefined;
  if (profile.superUser)
    return {
      hospitalId: hospital.id,
      role: 'super_user',
      departments: hospital.departments.map((d) => d.id),
    };
  const grant = profile.memberships.find((m) => m.hospitalId === hospital.id);
  if (!grant || grant.role === 'super_user') return undefined;
  const hospitalWide = [
    'major_write',
    'major_read',
    'system_admin_write',
    'system_admin_read',
  ].includes(grant.role);
  return {
    ...grant,
    departments: hospital.departments
      .filter(
        (d) =>
          grant.departments.includes(d.id) || (hospitalWide && grant.departments.includes('*')),
      )
      .map((d) => d.id),
  };
}
export const isOutstanding = (c: SurgicalCase) => !['Completed', 'Closed'].includes(c.status);
export const priorityRank: Record<Priority, number> = { P1: 0, P2: 1, P3: 2 };
export const priorityTargetDays: Record<Priority, number> = { P1: 30, P2: 90, P3: 365 };
// API timestamps may include an explicit offset. String order is not instant order.
export const compareInstants = (a: string, b: string) => Date.parse(a) - Date.parse(b);
export const backlogOrder = (a: SurgicalCase, b: SurgicalCase) =>
  priorityRank[a.priority] - priorityRank[b.priority] || compareInstants(a.listedAt, b.listedAt);
export function dueDate(anchor: string, priority: Priority) {
  return new Date(+new Date(anchor) + priorityTargetDays[priority] * 86400000).toISOString();
}
export const saDay = (v: string | Date) =>
  new Date(+new Date(v) + 7200000).toISOString().slice(0, 10);
export const waitDays = (listed: string, now: string) =>
  Math.max(0, Math.round((Date.parse(saDay(now)) - Date.parse(saDay(listed))) / 86400000));
export function ageYears(dob: string, on = saDay(new Date())) {
  const [birthYear, birthMonth, birthDay] = dob.split('-').map(Number),
    [year, month, dayOfMonth] = on.split('-').map(Number);
  return Math.max(
    0,
    year -
      birthYear -
      (month < birthMonth || (month === birthMonth && dayOfMonth < birthDay) ? 1 : 0),
  );
}
export const overlaps = (a: string, b: string, c: string, d: string) =>
  Date.parse(a) < Date.parse(d) && Date.parse(c) < Date.parse(b);
export const TURNOVER_MINUTES = 15;
export const turnaroundMinutes = (hospital: Hospital) =>
  hospital.turnaroundMinutes ?? TURNOVER_MINUTES;
export function nextAvailableStart(
  session: TheatreSession,
  bookings: Booking[],
  operatingMinutes: number,
  turnover = TURNOVER_MINUTES,
) {
  if (!Number.isInteger(operatingMinutes) || operatingMinutes < 5 || operatingMinutes > 720)
    return null;
  if (!Number.isInteger(turnover) || turnover < 15 || turnover > 30) return null;
  const required = (operatingMinutes + turnover) * 60000;
  let cursor = +new Date(session.start);
  const active = bookings
    .filter((booking) => booking.sessionId === session.id && booking.status !== 'Cancelled')
    .sort((a, b) => compareInstants(a.start, b.start));
  for (const booking of active) {
    const start = +new Date(booking.start),
      end = +new Date(booking.end);
    if (start - cursor >= required) return new Date(cursor).toISOString();
    cursor = Math.max(cursor, end);
  }
  return +new Date(session.end) - cursor >= required ? new Date(cursor).toISOString() : null;
}
export type OperatingSlot = {
  session: TheatreSession;
  start: string;
  freeMinutes: number;
};
export function nextOperatingSlot(
  sessions: TheatreSession[],
  bookings: Booking[],
  now = new Date().toISOString(),
  turnover = TURNOVER_MINUTES,
): OperatingSlot | null {
  const current = Math.ceil(+new Date(now) / 60000) * 60000;
  let earliest: OperatingSlot | null = null;
  for (const session of sessions) {
    if (+new Date(session.end) <= current) continue;
    const availableSession = {
        ...session,
        start: new Date(Math.max(+new Date(session.start), current)).toISOString(),
      },
      start = nextAvailableStart(availableSession, bookings, 5, turnover);
    if (!start) continue;
    const nextBooking = bookings
        .filter(
          (booking) =>
            booking.sessionId === session.id &&
            booking.status !== 'Cancelled' &&
            +new Date(booking.start) >= +new Date(start),
        )
        .sort((a, b) => compareInstants(a.start, b.start))[0],
      gapEnd = nextBooking ? nextBooking.start : session.end;
    const slot = {
      session,
      start,
      freeMinutes: Math.floor((+new Date(gapEnd) - +new Date(start)) / 60000),
    };
    if (!earliest || compareInstants(slot.start, earliest.start) < 0) earliest = slot;
  }
  return earliest;
}
export const bookingNeedsOutcome = (booking: Booking, now = new Date().toISOString()) =>
  ['Scheduled', 'In theatre'].includes(booking.status) && +new Date(booking.end) <= +new Date(now);
export const caseNeedsAttention = (
  surgicalCase: SurgicalCase,
  bookings: Booking[],
  now = new Date().toISOString(),
) =>
  isOutstanding(surgicalCase) &&
  (+new Date(surgicalCase.dueAt) <= +new Date(now) ||
    bookings.some(
      (booking) => booking.caseId === surgicalCase.id && bookingNeedsOutcome(booking, now),
    ));
export function backlogTrend(
  cases: SurgicalCase[],
  bookings: Booking[],
  now = new Date().toISOString(),
) {
  const [currentYear, currentMonth] = saDay(now).split('-').map(Number),
    completionByCase = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.status !== 'Completed' || !booking.outAt) continue;
    const completedAt = +new Date(booking.outAt),
      existing = completionByCase.get(booking.caseId);
    if (!existing || completedAt < existing) completionByCase.set(booking.caseId, completedAt);
  }
  return Array.from({ length: 6 }, (_, index) => {
    const offset = index - 5,
      monthIndex = currentMonth - 1 + offset,
      year = currentYear + Math.floor(monthIndex / 12),
      month = ((monthIndex % 12) + 12) % 12,
      start = new Date(Date.UTC(year, month, 1, 10)).toISOString().slice(0, 10),
      nextMonth = new Date(Date.UTC(year, month + 1, 1, 10)).toISOString().slice(0, 10),
      monthEnd = Date.parse(`${nextMonth}T00:00:00+02:00`) - 1,
      at = offset === 0 ? +new Date(now) : monthEnd,
      point = { name: '', at: new Date(at).toISOString(), P1: 0, P2: 0, P3: 0 };
    point.name = new Date(`${start}T12:00:00+02:00`).toLocaleDateString('en-ZA', {
      timeZone: 'Africa/Johannesburg',
      month: 'short',
    });
    for (const surgicalCase of cases) {
      if (+new Date(surgicalCase.listedAt) > at) continue;
      const terminalAt =
        completionByCase.get(surgicalCase.id) ??
        (['Completed', 'Closed'].includes(surgicalCase.status)
          ? +new Date(surgicalCase.updatedAt)
          : Number.POSITIVE_INFINITY);
      if (terminalAt <= at) continue;
      const history = surgicalCase.priorityHistory ?? [],
        priority = [...history]
          .filter((entry) => +new Date(entry.at) <= at)
          .sort((a, b) => compareInstants(a.at, b.at))
          .at(-1)?.priority;
      if (priority) point[priority]++;
    }
    return point;
  });
}
export function metrics(
  cases: SurgicalCase[],
  sessions: TheatreSession[],
  bookings: Booking[],
  now = new Date().toISOString(),
): Metrics {
  const open = cases.filter(isOutstanding),
    waits = open.map((c) => waitDays(c.listedAt, now)).sort((a, b) => a - b);
  const percentile = (p: number) =>
    waits.length ? waits[Math.max(0, Math.ceil(waits.length * p) - 1)] : 0;
  const cutoff = +new Date(now) - 30 * 86400000;
  const done = bookings.filter(
    (b) =>
      b.status === 'Completed' &&
      b.outAt &&
      +new Date(b.outAt) >= cutoff &&
      +new Date(b.outAt) <= +new Date(now),
  );
  const periodSessions = sessions.filter(
    (s) => +new Date(s.end) <= +new Date(now) && +new Date(s.start) >= cutoff,
  );
  let occupied = 0,
    available = 0,
    completeTimings = 0,
    totalAttempts = 0;
  for (const s of periodSessions) {
    available += +new Date(s.end) - +new Date(s.start);
    const attempts = bookings.filter((b) => b.sessionId === s.id && b.status !== 'Cancelled');
    totalAttempts += attempts.length;
    const spans = attempts
      .filter((b) => b.inAt && b.outAt && +new Date(b.outAt) > +new Date(b.inAt))
      .map((b) => {
        completeTimings++;
        return [
          Math.max(+new Date(b.inAt!), +new Date(s.start)),
          Math.min(+new Date(b.outAt!), +new Date(s.end)),
        ];
      })
      .filter(([a, b]) => b > a)
      .sort((a, b) => a[0] - b[0]);
    let end = 0;
    for (const [a, b] of spans) {
      occupied += Math.max(0, b - Math.max(a, end));
      end = Math.max(end, b);
    }
  }
  const allTimingsRecorded = completeTimings === totalAttempts;
  const coverage = allTimingsRecorded
    ? 100
    : Math.min(99, Math.round((completeTimings / totalAttempts) * 100));
  return {
    outstanding: open.length,
    ready: open.filter((c) => c.status === 'Waiting' && c.readiness === 'Ready').length,
    overdue: open.filter((c) => +new Date(c.dueAt) <= +new Date(now)).length,
    requiresAction: open.filter((c) => caseNeedsAttention(c, bookings, now)).length,
    missingOutcomes: new Set(
      bookings
        .filter((booking) => bookingNeedsOutcome(booking, now))
        .map((booking) => booking.caseId),
    ).size,
    completed: new Set(done.map((b) => b.caseId)).size,
    medianWait: waits.length
      ? (waits[Math.floor((waits.length - 1) / 2)] + waits[Math.floor(waits.length / 2)]) / 2
      : 0,
    p90Wait: percentile(0.9),
    utilisation: available && allTimingsRecorded ? Math.round((occupied / available) * 100) : null,
    timingCoverage: coverage,
    cancelled: bookings.filter(
      (b) =>
        b.status === 'Cancelled' &&
        +new Date(b.start) >= cutoff &&
        +new Date(b.start) <= +new Date(now),
    ).length,
    byPriority: (['P1', 'P2', 'P3'] as Priority[]).map((name) => ({
      name,
      count: open.filter((c) => c.priority === name).length,
    })),
    weekly: Array.from({ length: 7 }, (_, i) => {
      const d = new Date(+new Date(now) - (6 - i) * 86400000);
      return {
        name: d.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short' }),
        completed: new Set(done.filter((b) => saDay(b.outAt!) === saDay(d)).map((b) => b.caseId))
          .size,
      };
    }),
    backlogTrend: backlogTrend(cases, bookings, now),
    trendCoverage: cases.length
      ? Math.floor(
          (cases.filter((surgicalCase) => surgicalCase.priorityHistory?.length).length /
            cases.length) *
            100,
        )
      : 100,
  };
}
