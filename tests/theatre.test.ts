import { describe, it, expect, vi } from 'vitest';
import {
  theatreEntrySchema,
  theatreMetrics,
  theatrePeriod,
  projectedEntry,
  registerEntries,
  reportBounds,
  type TheatreEntryInput,
} from '../shared/theatre.ts';
import { nextAvailableStart, type TheatreSession, type Workspace } from '../shared/domain.ts';
import { acknowledgeOperation, projected } from '../apps/web/workspace-projection.ts';
import type { VaultData } from '../apps/web/vault.ts';
const input: TheatreEntryInput = {
  entryId: 'one',
  version: 0,
  departmentId: 'general',
  bookingId: null,
  patientRef: 'TEST1',
  patientName: 'Synthetic',
  dob: '',
  age: 35,
  ageUnit: 'years',
  sex: 'Not recorded',
  admissionDate: '',
  ward: '',
  theatre: 'T1',
  procedures: ['One', 'Two'],
  surgeon: 'Dr Test',
  assistant: '',
  anaesthetist: 'Dr Anaesthetic',
  inAt: '2026-04-01T08:00:00+02:00',
  outAt: '2026-04-01T09:00:00+02:00',
  status: 'Verified',
  source: 'Manual entry',
  sourceReference: '',
  notes: '',
  reason: 'Test record',
};
const row = (overrides: Partial<TheatreEntryInput> = {}) =>
  projectedEntry({ ...input, ...overrides }, '2026-04-02T00:00:00Z');
const session: TheatreSession = {
  id: 's1',
  departmentId: 'general',
  theatre: 'T1',
  date: '2026-04-01',
  start: '2026-04-01T06:00:00Z',
  end: '2026-04-01T14:00:00Z',
  surgeon: 'Dr Test',
  version: 1,
};
describe('Theatre register and reporting', () => {
  it('preserves recorded age without inventing a date of birth', () => {
    expect(theatreEntrySchema.parse(input).dob).toBe('');
    expect(row().age).toBe(35);
    expect(row().operationDate).toBe('2026-04-01');
  });
  it('rejects contradictory ages and invalid chronology', () => {
    expect(theatreEntrySchema.safeParse({ ...input, dob: '1990-01-01' }).success).toBe(false);
    expect(theatreEntrySchema.safeParse({ ...input, outAt: input.inAt }).success).toBe(false);
    expect(theatreEntrySchema.safeParse({ ...input, admissionDate: '2026-04-02' }).success).toBe(
      false,
    );
    expect(theatreEntrySchema.safeParse({ ...input, procedures: ['One', 'one'] }).success).toBe(
      false,
    );
  });
  it('includes unused staffed days in utilisation and counts procedures separately', () => {
    const unused = {
      ...session,
      id: 'unused',
      date: '2026-04-02',
      start: '2026-04-02T06:00:00Z',
      end: '2026-04-02T14:00:00Z',
    };
    const m = theatreMetrics([row()], [session, unused], '2026-04-01', '2026-04-02');
    expect(m.availableMinutes).toBe(960);
    expect(m.usedMinutes).toBe(60);
    expect(m.utilisation).toBe(6.25);
    expect(m.cases).toBe(1);
    expect(m.procedures).toBe(2);
  });
  it('excludes drafts and does not invent capacity', () => {
    const m = theatreMetrics(
      [row(), row({ entryId: 'draft', status: 'Draft' })],
      [],
      '2026-04-01',
      '2026-04-30',
    );
    expect(m.cases).toBe(1);
    expect(m.drafts).toBe(1);
    expect(m.utilisation).toBeNull();
    expect(m.averageTurnaroundMinutes).toBeNull();
  });
  it('uses only elapsed capacity in an ongoing period', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-04-01T08:00:00Z'));
    try {
      const m = theatreMetrics([row()], [session], '2026-04-01', '2026-04-30');
      expect(m.availableMinutes).toBe(120);
      expect(m.usedMinutes).toBe(60);
      expect(m.utilisation).toBe(50);
      expect(theatreMetrics([], [session], '2026-04-02', '2026-04-30').availableMinutes).toBe(0);
    } finally {
      now.mockRestore();
    }
  });
  it('includes overnight carry-in occupancy without counting the operation twice', () => {
    const overnight = row({
      inAt: '2026-03-31T23:30:00+02:00',
      outAt: '2026-04-01T00:30:00+02:00',
    });
    const s = { ...session, start: '2026-03-31T23:00:00+02:00', end: '2026-04-01T01:00:00+02:00' };
    const m = theatreMetrics([overnight], [s], '2026-04-01', '2026-04-01');
    expect(m.cases).toBe(0);
    expect(m.usedMinutes).toBe(30);
    expect(m.availableMinutes).toBe(60);
    expect(m.utilisation).toBe(50);
  });
  it('finds nested and cross-session overlaps without inventing turnaround', () => {
    const entries = [
      row({ outAt: '2026-04-01T12:00:00+02:00' }),
      row({
        entryId: 'nested',
        inAt: '2026-04-01T08:30:00+02:00',
        outAt: '2026-04-01T09:00:00+02:00',
      }),
      row({
        entryId: 'still-overlap',
        inAt: '2026-04-01T09:30:00+02:00',
        outAt: '2026-04-01T10:00:00+02:00',
      }),
    ];
    const m = theatreMetrics(entries, [session], '2026-04-01', '2026-04-01');
    expect(m.overlappingEntries).toBe(2);
    expect(m.turnaroundObservations).toBe(0);
    const later = { ...session, id: 'later', start: '2026-04-01T10:00:00+02:00' };
    const cross = theatreMetrics(
      [
        entries[0],
        {
          ...entries[2],
          inAt: '2026-04-01T10:30:00+02:00',
          outAt: '2026-04-01T11:00:00+02:00',
          sessionId: 'later',
        },
      ],
      [{ ...session, end: later.start }, later],
      '2026-04-01',
      '2026-04-01',
    );
    expect(cross.overlappingEntries).toBe(1);
  });
  it('measures actual turnaround and first entry once per staffed session', () => {
    const m = theatreMetrics(
      [
        row(),
        row({
          entryId: 'next',
          inAt: '2026-04-01T09:20:00+02:00',
          outAt: '2026-04-01T10:20:00+02:00',
        }),
      ],
      [session],
      '2026-04-01',
      '2026-04-30',
    );
    expect(m.averageTurnaroundMinutes).toBe(20);
    expect(m.turnaroundObservations).toBe(1);
    expect(m.averageStartMinutes).toBe(480);
    expect(m.startObservations).toBe(1);
    expect(m.averageDelayMinutes).toBe(0);
  });
  it('does not treat overnight gaps as same-day turnaround', () => {
    const m = theatreMetrics(
      [
        row(),
        row({
          entryId: 'next',
          inAt: '2026-04-02T08:00:00+02:00',
          outAt: '2026-04-02T09:00:00+02:00',
        }),
      ],
      [],
      '2026-04-01',
      '2026-04-30',
    );
    expect(m.turnaroundObservations).toBe(0);
    expect(m.startObservations).toBe(2);
  });
  it('unions occupancy and flags overlapping actual intervals', () => {
    const m = theatreMetrics(
      [
        row(),
        row({
          entryId: 'overlap',
          inAt: '2026-04-01T08:30:00+02:00',
          outAt: '2026-04-01T09:30:00+02:00',
        }),
      ],
      [session],
      '2026-04-01',
      '2026-04-30',
    );
    expect(m.usedMinutes).toBe(90);
    expect(m.overlappingEntries).toBe(1);
    expect(m.averageTurnaroundMinutes).toBeNull();
  });
  it('uses April–March financial years, real quarters and Monday weeks', () => {
    expect(theatrePeriod('Financial year', '2027-03-31')).toEqual({
      from: '2026-04-01',
      to: '2027-03-31',
      financialYear: '2026/27',
    });
    expect(theatrePeriod('Quarter', '2027-02-20').from).toBe('2027-01-01');
    expect(theatrePeriod('Week', '2026-04-01')).toMatchObject({
      from: '2026-03-30',
      to: '2026-04-05',
    });
    expect(() => reportBounds('2026-02-30', '2026-03-01')).toThrow();
    expect(() => reportBounds('2025-01-01', '2026-12-31')).toThrow();
  });
  it('reserves configured turnaround and respects old booking windows', () => {
    const short = { ...session, end: '2026-04-01T07:15:00Z' };
    expect(nextAvailableStart(short, [], 60, 15)).toBe(new Date(session.start).toISOString());
    expect(nextAvailableStart(short, [], 60, 30)).toBeNull();
    expect(
      nextAvailableStart(
        session,
        [
          {
            id: 'b',
            sessionId: 's1',
            status: 'Scheduled',
            start: session.start,
            end: '2026-04-01T07:15:00Z',
          } as any,
        ],
        60,
        30,
      ),
    ).toBe('2026-04-01T07:15:00.000Z');
  });
  it('projects and acknowledges register entries without altering backlog cases', () => {
    const w = {
      hospital: { id: 'h' },
      departmentId: 'general',
      patients: [],
      cases: [],
      sessions: [],
      bookings: [],
    } as unknown as Workspace;
    const entry = {
      hospitalId: 'h',
      status: 'pending' as const,
      operation: {
        id: crypto.randomUUID(),
        type: 'theatre-entry' as const,
        data: input,
        occurredAt: input.outAt,
        recordedAt: '2026-04-02T00:00:00Z',
      },
    };
    const local = projected(w, [entry]);
    expect(registerEntries(local)).toHaveLength(1);
    expect(local.cases).toHaveLength(0);
    const data = { pending: [entry], workspaces: { 'h/general': w } } as unknown as VaultData;
    const ack = acknowledgeOperation(data, entry, {
      id: entry.operation.id,
      acceptedAt: entry.operation.recordedAt,
      caseId: null,
      changes: { theatreEntry: { ...row(), verifiedBy: 'doctor' } },
    });
    expect(ack.pending).toHaveLength(0);
    expect(ack.workspaces['h/general'].theatreEntries?.[0].verifiedBy).toBe('doctor');
  });
});
