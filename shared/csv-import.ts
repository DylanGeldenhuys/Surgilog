import { calendarDateSchema, newCaseSchema } from './domain.ts';

export function caseFromCsv(
  row: Record<string, string>,
  departmentId: string,
  caseId: string,
  now: string,
) {
  const listing = row.listed_at;
  // Validate source strings before Date can normalise an impossible date or
  // infer the importing device's timezone for an assessment timestamp.
  const listedAt = !listing
    ? now
    : calendarDateSchema.safeParse(listing).success
      ? `${listing}T08:00:00+02:00`
      : '';
  return newCaseSchema.safeParse({
    caseId,
    departmentId,
    patientRef: row.patient_ref,
    patientName: row.patient_name,
    dob: row.dob ?? '',
    gender: row.gender || 'Not recorded',
    phone: row.phone ?? '',
    procedure: row.procedure,
    diagnosis: row.diagnosis ?? '',
    icd10Code: row.icd10 ?? '',
    surgeon: row.surgeon ?? '',
    priority: row.priority,
    listedAt,
    urgencyAt: row.urgency_at ?? '',
    readiness: 'Needs assessment',
    notes: '',
  });
}
