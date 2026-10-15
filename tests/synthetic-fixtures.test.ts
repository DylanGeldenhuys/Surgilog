import { describe, expect, it } from 'vitest';
import { syntheticDocuments } from '../scripts/synthetic-fixtures.ts';
import type { Booking, SurgicalCase } from '../shared/domain.ts';

describe('shared local/review fictional fixtures', () => {
  const documents = syntheticDocuments(new Date('2026-10-05T10:00:00Z'));
  const records = new Map(documents.map((document) => [document.path, document.data]));
  it('has unique hospital-scoped records and no login accounts or profiles', () => {
    expect(records.size).toBe(documents.length);
    expect(documents.every(({ path }) => path.startsWith('hospitals/'))).toBe(true);
    expect(documents.filter(({ path }) => path.includes('/patients/'))).toHaveLength(114);
    expect(documents.filter(({ path }) => path.includes('/cases/'))).toHaveLength(114);
    expect(JSON.stringify(documents)).not.toContain('TheatreDemo!26');
  });
  it('every booking refers to its own hospital case/session and includes booking history', () => {
    for (const { path, data } of documents.filter(({ path }) => path.includes('/bookings/'))) {
      const booking = data as Booking;
      const root = path.split('/').slice(0, 2).join('/');
      const surgicalCase = records.get(`${root}/cases/${booking.caseId}`) as SurgicalCase;
      expect(surgicalCase.status).toBe(booking.status);
      expect(records.has(`${root}/sessions/${booking.sessionId}`)).toBe(true);
      expect(records.has(`${root}/patients/${surgicalCase.patientId}`)).toBe(true);
      expect(records.has(`${root}/audit/seed-book-${booking.id}`)).toBe(true);
      expect(Date.parse(booking.end)).toBeGreaterThan(Date.parse(booking.start));
    }
  });
});
