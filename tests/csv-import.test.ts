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
