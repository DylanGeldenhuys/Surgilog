import Papa from 'papaparse';
import { theatreEntrySchema } from './theatre.ts';
import type { Operation } from './domain.ts';
export const csvHeader =
  'patientRef,patientName,operationDate,entryTime,exitTime,theatre,procedures,surgeon,age,ageUnit,dob,sex,admissionDate,ward,assistant,anaesthetist,sourceReference';
const csvDate = (value: string) =>
  /^\d{2}\/\d{2}\/\d{4}$/.test(value) ? value.split('/').reverse().join('-') : value;

export function parseTheatreCsv(text: string, departmentId: string, theatres: string[]) {
  const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
    }),
    issues = parsed.errors.map((e) => e.message),
    ready: Operation[] = [];
  if (parsed.data.length > 100) issues.push('Preview at most 100 entries at a time.');
  parsed.data.slice(0, 100).forEach((r, i) => {
    try {
      const day = csvDate(r.operationDate ?? '');
      if (!/^\d{2}:\d{2}$/.test(r.entryTime ?? '') || !/^\d{2}:\d{2}$/.test(r.exitTime ?? ''))
        throw new Error(
          'Use HH:MM entry and exit times on the same date; enter overnight cases manually.',
        );
      const data = theatreEntrySchema.parse({
        entryId: crypto.randomUUID(),
        version: 0,
        departmentId: departmentId,
        bookingId: null,
        patientRef: r.patientRef,
        patientName: r.patientName,
        dob: csvDate(r.dob ?? ''),
        age: r.age?.trim() ? Number(r.age) : null,
        ageUnit: r.ageUnit || 'years',
        sex: r.sex || 'Not recorded',
        admissionDate: csvDate(r.admissionDate ?? ''),
        ward: r.ward ?? '',
        theatre: r.theatre,
        procedures: (r.procedures ?? '')
          .split(';')
          .map((s) => s.trim())
          .filter(Boolean),
        surgeon: r.surgeon,
        assistant: r.assistant ?? '',
        anaesthetist: r.anaesthetist ?? '',
        inAt: `${day}T${r.entryTime}:00+02:00`,
        outAt: `${day}T${r.exitTime}:00+02:00`,
        status: 'Draft',
        source: 'Historical register',
        sourceReference: r.sourceReference ?? '',
        notes: '',
        reason: 'Historical register CSV import',
      });
      if (!theatres.includes(data.theatre))
        throw new Error('Choose a configured theatre/location.');
      if (Date.parse(data.outAt) > Date.now() + 300000)
        throw new Error('Only import completed activity.');
      ready.push({
        id: crypto.randomUUID(),
        type: 'theatre-entry',
        data,
        occurredAt: data.outAt,
        recordedAt: new Date().toISOString(),
      });
    } catch (e) {
      issues.push(`Row ${i + 2}: ${(e as Error).message}`);
    }
  });
  const keys = ready.map((o) =>
    o.type === 'theatre-entry'
      ? `${o.data.patientRef.trim().toUpperCase()}|${o.data.theatre.toLowerCase()}|${Date.parse(o.data.inAt)}`
      : '',
  );
  if (new Set(keys).size !== keys.length)
    issues.push('The CSV contains duplicate patient/location/start entries.');
  return { operations: issues.length ? [] : ready, errors: issues };
}
