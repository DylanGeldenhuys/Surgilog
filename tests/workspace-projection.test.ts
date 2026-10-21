import 'fake-indexeddb/auto';
import { afterEach, expect, it, vi } from 'vitest';
import { acknowledgeOperation, projected } from '../apps/web/workspace-projection.ts';
import {
  openOnline,
  saveVault,
  unlock,
  endWorkspace,
  type VaultData,
  type Vault,
} from '../apps/web/vault.ts';
import { metrics, type Pending, type Workspace } from '../shared/domain.ts';

const now = '2026-10-14T10:00:00.000Z';
const workspace: Workspace = {
  hospital: {
    id: 'h',
    name: 'Synthetic',
    city: 'Test',
    region: 'Africa',
    country: 'South Africa',
    province: 'Test',
    district: 'Test',
    departments: [{ id: 'general', name: 'General' }],
    theatres: [],
    surgeons: [],
  },
  departmentId: 'general',
  asOf: now,
  truncated: false,
  sessions: [],
  bookings: [],
  metrics: metrics([], [], [], now),
  patients: [
    {
      id: 'patient',
      ref: 'SYN-1',
      name: 'Synthetic patient',
      dob: '',
      phone: '123',
      gender: 'Not recorded',
      version: 1,
    },
  ],
  cases: [
    {
      id: 'case',
      patientId: 'patient',
      departmentId: 'general',
      procedure: 'Test',
      surgeon: 'Test doctor',
      priority: 'P2',
      listedAt: now,
      urgencyAt: now,
      dueAt: now,
      status: 'Waiting',
      readiness: 'Needs assessment',
      duration: null,
      notes: 'original',
      version: 1,
      createdAt: now,
      updatedAt: now,
    },
  ],
};
const entry: Pending = {
  hospitalId: 'h',
  departmentId: 'general',
  status: 'pending',
  operation: {
    id: 'request',
    type: 'case-notes',
    recordedAt: now,
    occurredAt: now,
    data: { caseId: 'case', version: 1, notes: 'acknowledged', reason: 'Test correction' },
  },
};
const identity = {
  profile: {
    uid: 'test',
    email: 'projection@test.invalid',
    name: 'Synthetic',
    active: true,
    memberships: [{ hospitalId: 'h', role: 'doctor' as const, departments: ['general'] }],
  },
  hospitals: [workspace.hospital],
};
const data = (): VaultData => ({
  ...identity,
  workspaces: { 'h/general': structuredClone(workspace) },
  verifiedAt: new Date().toISOString(),
  priorityPolicy: 'leo-2026-10-04-30-90-365',
  pending: [structuredClone(entry)],
});
let vault: Vault | undefined;
afterEach(async () => {
  vi.restoreAllMocks();
  if (vault) await endWorkspace(vault, true);
  vault = undefined;
});

it('removes prepared patient workspaces after an online downgrade to reports-only', async () => {
  vault = await openOnline(identity, 'SyntheticPassword!');
  vault.data = data();
  await saveVault(vault);
  const reopened = await openOnline(
    {
      ...identity,
      profile: {
        ...identity.profile,
        memberships: [{ hospitalId: 'h', role: 'viewer', departments: ['general'] }],
      },
    },
    'SyntheticPassword!',
  );
  expect(reopened.data.workspaces).toEqual({});
  expect(reopened.data.pending).toEqual(vault.data.pending);
});

it('keeps an acknowledged change through encrypted reload when the follow-up refresh is unavailable', async () => {
  vault = await openOnline(identity, 'SyntheticPassword!');
  vault.data = data();
  await saveVault(vault);
  const next = acknowledgeOperation(vault.data, entry);
  await saveVault({ ...vault, data: next });
  const reopened = await unlock(identity.profile.email, 'SyntheticPassword!');
  expect(reopened.data.pending).toHaveLength(0);
  expect(reopened.data.workspaces['h/general'].cases[0]).toMatchObject({
    notes: 'acknowledged',
    version: 2,
  });
  expect(vault.data.pending).toHaveLength(1);
  expect(vault.data.workspaces['h/general'].cases[0].notes).toBe('original');
});

it('retains the original outbox and snapshot if persisting the acknowledgement fails', async () => {
  vault = await openOnline(identity, 'SyntheticPassword!');
  vault.data = data();
  await saveVault(vault);
  const encrypt = vi
    .spyOn(crypto.subtle, 'encrypt')
    .mockRejectedValueOnce(new Error('Storage failure'));
  await expect(
    saveVault({ ...vault, data: acknowledgeOperation(vault.data, entry) }),
  ).rejects.toThrow('Storage failure');
  encrypt.mockRestore();
  const reopened = await unlock(identity.profile.email, 'SyntheticPassword!');
  expect(reopened.data.pending[0].operation.id).toBe(entry.operation.id);
  expect(reopened.data.workspaces['h/general'].cases[0].notes).toBe('original');
});

it('projects dependent edits once, and skips edits already included in the server snapshot', () => {
  const next: Pending = {
    ...entry,
    operation: {
      ...entry.operation,
      id: 'next',
      type: 'case-notes',
      data: { caseId: 'case', version: 2, notes: 'second', reason: 'Another correction' },
    },
  };
  const base = acknowledgeOperation({ ...data(), pending: [entry, next] }, entry);
  expect(projected(base.workspaces['h/general'], base.pending).cases[0]).toMatchObject({
    notes: 'second',
    version: 3,
  });
  const repeated = acknowledgeOperation(base, entry);
  expect(repeated.workspaces['h/general'].cases[0]).toMatchObject({
    notes: 'acknowledged',
    version: 2,
  });
});

it('updates patient demographics in all cached departments without touching another hospital', () => {
  const base = data();
  base.workspaces['h/other'] = { ...structuredClone(workspace), departmentId: 'other' };
  base.workspaces['another/general'] = {
    ...structuredClone(workspace),
    hospital: { ...workspace.hospital, id: 'another' },
  };
  const patientEdit: Pending = {
    ...entry,
    operation: {
      ...entry.operation,
      type: 'patient',
      data: {
        caseId: 'case',
        patientId: 'patient',
        version: 1,
        name: 'Updated Synthetic',
        dob: '',
        phone: '456',
        reason: 'Test correction',
      },
    },
  };
  const updated = acknowledgeOperation(base, patientEdit);
  expect(updated.workspaces['h/general'].patients[0].phone).toBe('456');
  expect(updated.workspaces['h/other'].patients[0].phone).toBe('456');
  expect(updated.workspaces['another/general'].patients[0].phone).toBe('123');
});

it('projects an optional diagnosis onto a new or existing backlog case', () => {
  const base = data();
  expect(base.workspaces['h/general'].cases[0].diagnosis).toBeUndefined();
  const registration: Pending = {
    ...entry,
    operation: {
      ...entry.operation,
      type: 'register',
      data: {
        caseId: 'diagnosed',
        patientRef: 'SYN-NEW',
        patientName: 'Synthetic diagnosed',
        dob: '',
        gender: 'Not recorded',
        phone: '',
        departmentId: 'general',
        procedure: 'Synthetic appendicectomy',
        diagnosis: 'Synthetic appendicitis',
        icd10Code: 'K35.8',
        surgeon: 'Test',
        priority: 'P1',
        listedAt: now,
        urgencyAt: now,
        readiness: 'Needs assessment',
        notes: '',
      },
    },
  };
  const created = projected(base.workspaces['h/general'], [registration]).cases.find(
    (item) => item.id === 'diagnosed',
  );
  expect(created).toMatchObject({
    diagnosis: 'Synthetic appendicitis',
    icd10: { system: 'icd-10-who', code: 'K35.8' },
    version: 1,
  });
  const correction: Pending = {
    ...entry,
    operation: {
      ...entry.operation,
      id: 'diagnosis-edit',
      type: 'diagnosis',
      data: {
        caseId: 'case',
        version: 1,
        diagnosis: '',
        icd10Code: 'K35',
        reason: 'Synthetic code only',
      },
    },
  };
  const corrected = projected(base.workspaces['h/general'], [correction]).cases[0];
  expect(corrected.diagnosis).toBeUndefined();
  expect(corrected.icd10).toEqual({ system: 'icd-10-who', code: 'K35' });
  expect(corrected.notes).toBe('original');
  expect(corrected.version).toBe(2);
});

it('links a further case to a prepared patient by normalised hospital reference', () => {
  const registration: Pending = {
    ...entry,
    operation: {
      ...entry.operation,
      type: 'register',
      data: {
        caseId: 'second-case',
        patientRef: ' syn-1 ',
        patientName: 'Synthetic patient',
        dob: '',
        gender: 'Not recorded',
        phone: 'incorrect replacement',
        departmentId: 'general',
        procedure: 'Other procedure',
        surgeon: 'Test',
        priority: 'P2',
        listedAt: now,
        urgencyAt: now,
        readiness: 'Needs assessment',
        notes: '',
      },
    },
  };
  const updated = acknowledgeOperation(data(), registration).workspaces['h/general'];
  expect(updated.patients).toHaveLength(1);
  expect(updated.patients[0].phone).toBe('123');
  expect(updated.cases.find((item) => item.id === 'second-case')?.patientId).toBe('patient');
});

it('uses authoritative registration identity and demographics when that patient was not prepared locally', () => {
  const base = data();
  base.workspaces['h/general'].cases = [];
  base.workspaces['h/general'].patients = [];
  const result = {
    id: entry.operation.id,
    acceptedAt: now,
    caseId: 'registered',
    changes: {
      patient: { ...workspace.patients[0], id: 'existing-server-patient', version: 4 },
      surgicalCase: {
        ...workspace.cases[0],
        id: 'registered',
        patientId: 'existing-server-patient',
        version: 1,
      },
    },
  };
  const updated = acknowledgeOperation(base, entry, result).workspaces['h/general'];
  expect(updated.cases[0].patientId).toBe('existing-server-patient');
  expect(updated.patients[0]).toMatchObject({ id: 'existing-server-patient', version: 4 });
  expect(updated.patients).toHaveLength(1);
});

it('never rolls a newer cached version back when replay returns an earlier receipt snapshot', () => {
  const base = data();
  base.workspaces['h/general'].cases[0].version = 5;
  base.workspaces['h/general'].cases[0].notes = 'newer';
  const updated = acknowledgeOperation(base, entry, {
    id: entry.operation.id,
    acceptedAt: now,
    caseId: 'case',
    changes: { surgicalCase: { ...workspace.cases[0], notes: 'older', version: 2 } },
  });
  expect(updated.workspaces['h/general'].cases[0]).toMatchObject({ version: 5, notes: 'newer' });
});
