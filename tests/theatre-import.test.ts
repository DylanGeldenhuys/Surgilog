import { expect, it } from 'vitest';
import { parseTheatreCsv } from '../shared/theatre-import.ts';
const header =
  'patientRef,patientName,operationDate,entryTime,exitTime,theatre,procedures,surgeon,age';
const row = 'TEST1,"Synthetic, Patient",01/04/2026,08:00,09:00,Day Theatre,One;Two,Dr Test,42';
it('previews quoted register CSV, local dates, direct age and multiple procedures as drafts', () => {
  const r = parseTheatreCsv(header + '\n' + row, 'general', ['Day Theatre']);
  expect(r.errors).toEqual([]);
  expect(r.operations).toHaveLength(1);
  expect(r.operations[0].data).toMatchObject({
    patientName: 'Synthetic, Patient',
    age: 42,
    dob: '',
    procedures: ['One', 'Two'],
    status: 'Draft',
    inAt: '2026-04-01T08:00:00+02:00',
  });
});
it('rejects invalid dates, duplicate rows and unknown operating locations before import', () => {
  expect(
    parseTheatreCsv(header + '\n' + row.replace('01/04/2026', '30/02/2026'), 'general', [
      'Day Theatre',
    ]).operations,
  ).toHaveLength(0);
  expect(
    parseTheatreCsv(header + '\n' + row + '\n' + row, 'general', ['Day Theatre']).errors.join(' '),
  ).toContain('duplicate');
  expect(parseTheatreCsv(header + '\n' + row, 'general', ['ICU']).errors.join(' ')).toContain(
    'configured',
  );
});
