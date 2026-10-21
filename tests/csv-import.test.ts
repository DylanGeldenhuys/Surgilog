import { expect, it } from 'vitest';
import { caseFromCsv } from '../shared/csv-import.ts';
const row = {
  patient_ref: 'SYNTHETIC',
  patient_name: 'Synthetic Patient',
  procedure: 'Test',
  priority: 'P2',
  listed_at: '2026-02-28',
  urgency_at: '2026-02-28T08:00:00+02:00',
};
const parse = (changes: Record<string, string> = {}) =>
  caseFromCsv({ ...row, ...changes }, 'general', 'test-case', '2026-10-14T10:00:00Z');

it('requires an explicit timezone on imported urgency assessments', () => {
  expect(parse({ urgency_at: '2026-02-28T08:00:00' }).success).toBe(false);
  expect(parse({ urgency_at: '2026-02-28' }).success).toBe(false);
  expect(parse({ urgency_at: '2026-02-28T06:00:00Z' }).success).toBe(true);
  expect(parse().success).toBe(true);
});
it('rejects impossible listing dates before JavaScript can normalise them', () => {
  expect(parse({ listed_at: '2026-02-30' }).success).toBe(false);
  const result = parse();
  expect(result.success && result.data.listedAt).toBe('2026-02-28T08:00:00+02:00');
});
it('accepts a missing diagnosis and checks only the ICD-10 format', () => {
  const blank = parse();
  expect(blank.success && blank.data.diagnosis).toBe('');
  expect(blank.success && blank.data.icd10Code).toBe('');
  const coded = parse({ diagnosis: ' Synthetic appendicitis ', icd10: 'k35.8' });
  expect(coded.success && coded.data.diagnosis).toBe('Synthetic appendicitis');
  expect(coded.success && coded.data.icd10Code).toBe('K35.8');
  expect(parse({ icd10: 'not-a-code' }).success).toBe(false);
});
