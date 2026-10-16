import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openOnline,
  unlock,
  saveVault,
  upgradePriorityPolicy,
  rememberWorkspace,
  resumeWorkspace,
  recordActivity,
  endWorkspace,
  type VaultData,
} from '../apps/web/vault.ts';
import { SESSION_IDLE_MS, sessionExpired } from '../apps/web/session-policy.ts';
import { dueDate, type Workspace } from '../shared/domain.ts';
const storage = new Dexie('theatre-tracker-v1');
storage.version(2).stores({ vaults: 'id', sessions: 'id' });
const rows = storage.table('vaults');
const sessions = storage.table('sessions');
const identity = {
  profile: {
    uid: 'test-clinician',
    name: 'Synthetic Doctor',
    email: 'doctor@test.invalid',
    active: true,
    memberships: [
      { hospitalId: 'test-hospital', role: 'clinician' as const, departments: ['general'] },
    ],
  },
  hospitals: [],
};
const password = 'AccountPassword!26',
  previous = 'OldDevicePassphrase!26';
const pending: VaultData['pending'] = [
  {
    hospitalId: 'test-hospital',
    departmentId: 'general',
    status: 'pending',
    operation: {
      id: '591d92cf-d8c0-41ac-b76f-50b7d8d600d8',
      type: 'priority',
      occurredAt: '2026-10-03T18:00:00.000Z',
      recordedAt: '2026-10-03T18:05:00.000Z',
      data: {
        caseId: 'test-case',
        version: 1,
        priority: 'P2',
        reason: 'Synthetic offline observation',
      },
    },
  },
];
// Fixture encoded using the original v1 format, without the new unlock marker.
async function legacyFixture(secret = previous, uid = identity.profile.uid) {
  const encoder = new TextEncoder(),
    id = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(identity.profile.email))),
    )
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('');
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const data: VaultData = {
    ...identity,
    profile: { ...identity.profile, uid },
    pending,
    workspaces: {},
    verifiedAt: '2020-01-01T00:00:00.000Z',
  };
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(id) },
    key,
    encoder.encode(JSON.stringify(data)),
  );
  const row = { id, salt: Array.from(salt), iv: Array.from(iv), cipher };
  await rows.put(row);
  return row;
}
beforeEach(async () => {
  await rows.clear();
  await sessions.clear();
});

describe('persistent sessions and explicit logout', () => {
  it('opens and remembers durable work while browser persistence permission is unanswered', async () => {
    const persist = vi.fn(() => new Promise<boolean>(() => {}));
    vi.stubGlobal('navigator', { storage: { persist } });
    try {
      const v = await openOnline(identity, password);
      await rememberWorkspace(v);
      expect(persist).toHaveBeenCalledOnce();
      expect(await rows.get(v.id)).toBeDefined();
      expect((await resumeWorkspace(identity.profile.uid))?.id).toBe(v.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps the saved workspace usable when browser persistence is denied', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: vi.fn().mockRejectedValue(new Error('Permission denied')) },
    });
    try {
      const v = await openOnline(identity, password);
      await rememberWorkspace(v);
      expect((await unlock(identity.profile.email, password)).data.profile).toEqual(
        identity.profile,
      );
      expect((await resumeWorkspace(identity.profile.uid))?.id).toBe(v.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores the encrypted workspace and pending work without storing the password', async () => {
    const v = await openOnline(identity, password);
    v.data.pending = pending;
    await saveVault(v);
    await rememberWorkspace(v);
    const saved = await sessions.get('current');
    expect(saved.key.extractable).toBe(false);
    expect(JSON.stringify(saved)).not.toContain(password);
    const reopened = await resumeWorkspace(identity.profile.uid);
    expect(reopened?.data.pending).toEqual(pending);
    expect(reopened?.lifecycle.closed).toBe(false);
    expect(await resumeWorkspace('another-user')).toBeNull();
  });

  it('uses three days of human inactivity, renewed by activity rather than the original login', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    const v = await openOnline(identity, password);
    await rememberWorkspace(v);
    clock.mockReturnValue(start + SESSION_IDLE_MS - 1);
    expect(await resumeWorkspace(identity.profile.uid)).not.toBeNull();
    await recordActivity(v);
    clock.mockReturnValue(start + SESSION_IDLE_MS + 60_000);
    expect(await resumeWorkspace(identity.profile.uid)).not.toBeNull();
    clock.mockReturnValue(start + 2 * SESSION_IDLE_MS - 1);
    expect(await resumeWorkspace(identity.profile.uid)).toBeNull();
    expect((await sessions.get('current')).key).toBeUndefined();
    expect(await rows.get(v.id)).toBeDefined();
    await expect(recordActivity(v)).rejects.toThrow('expired');
  });

  it('expires at the exact inactivity boundary and rejects malformed or future timestamps', () => {
    const now = Date.now();
    expect(sessionExpired(now - SESSION_IDLE_MS + 1, now)).toBe(false);
    expect(sessionExpired(now - SESSION_IDLE_MS, now)).toBe(true);
    expect(sessionExpired(NaN, now)).toBe(true);
    expect(sessionExpired(now + 120_000, now)).toBe(true);
  });

  it('explicit logout deletes only that account’s local work, key and backups', async () => {
    const other = await openOnline(
      {
        ...identity,
        profile: {
          ...identity.profile,
          uid: 'other-user',
          email: 'other@test.invalid',
        },
      },
      password,
    );
    await legacyFixture();
    const v = await openOnline(identity, password);
    v.data.pending = pending;
    await saveVault(v);
    await rememberWorkspace(v);
    await endWorkspace(v, true);
    expect(await rows.get(v.id)).toBeUndefined();
    expect(await sessions.get('current')).toBeUndefined();
    expect(await rows.get(other.id)).toBeDefined();
    expect(await resumeWorkspace(identity.profile.uid)).toBeNull();
    await expect(unlock(identity.profile.email, password)).rejects.toThrow('No offline workspace');
    expect((await openOnline(identity, password)).data.pending).toEqual([]);
  });

  it('automatic session ending removes the remembered key but retains encrypted pending work', async () => {
    const v = await openOnline(identity, password);
    v.data.pending = pending;
    await saveVault(v);
    await rememberWorkspace(v);
    await endWorkspace(v, false);
    expect(await resumeWorkspace(identity.profile.uid)).toBeNull();
    expect((await sessions.get('current')).key).toBeUndefined();
    expect((await openOnline(identity, password)).data.pending).toEqual(pending);
  });

  it('waits for in-flight storage and prevents queued or late writes recreating logged-out data', async () => {
    const v = await openOnline(identity, password);
    await rememberWorkspace(v);
    let started!: () => void, release!: () => void;
    const writing = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const encrypt = crypto.subtle.encrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, 'encrypt').mockImplementationOnce(async (...args) => {
      started();
      await barrier;
      return encrypt(...args);
    });
    const save = saveVault(v);
    await writing;
    const queued = saveVault({ ...v }).catch((error) => error);
    const logout = endWorkspace(v, true);
    release();
    await Promise.all([save, logout]);
    expect(await queued).toBeInstanceOf(Error);
    await expect(saveVault({ ...v })).rejects.toThrow('Session ended');
    await expect(rememberWorkspace(v)).rejects.toThrow('Session ended');
    expect(await rows.get(v.id)).toBeUndefined();
    expect(await sessions.get('current')).toBeUndefined();
  });

  it('reports deletion failure and can retry without reopening the closed workspace', async () => {
    const v = await openOnline(identity, password);
    await rememberWorkspace(v);
    vi.spyOn(IDBObjectStore.prototype, 'delete').mockImplementationOnce(() => {
      throw new DOMException('Synthetic storage failure', 'UnknownError');
    });
    await expect(endWorkspace(v, true)).rejects.toThrow();
    expect(v.lifecycle.closed).toBe(true);
    expect(await rows.get(v.id)).toBeDefined();
    await endWorkspace(v, true);
    expect(await rows.get(v.id)).toBeUndefined();
    expect(await sessions.get('current')).toBeUndefined();
  });
});
afterEach(() => vi.restoreAllMocks());
describe('one-password offline storage and safe migration', () => {
  it('upgrades prepared offline cases and queued edits to Leo’s confirmed priority policy once', () => {
    const urgencyAt = '2026-10-01T08:00:00.000Z',
      workspace = {
        hospital: { id: 'test-hospital' },
        cases: [
          {
            id: 'test-case',
            priority: 'P1b',
            urgencyAt,
            dueAt: '2026-10-04T08:00:00.000Z',
            version: 1,
          },
        ],
      } as unknown as Workspace,
      data = {
        ...identity,
        pending: structuredClone(pending),
        workspaces: { 'test-hospital/general': workspace },
        verifiedAt: new Date().toISOString(),
      } as VaultData;
    (data.pending[0].operation.data as { priority: string }).priority = 'P1a';

    expect(upgradePriorityPolicy(data)).toBe(true);
    expect(workspace.cases[0]).toMatchObject({
      priority: 'P1',
      dueAt: dueDate(urgencyAt, 'P1'),
      version: 2,
    });
    expect(data.pending[0].operation.data).toMatchObject({ priority: 'P1', version: 2 });
    expect(upgradePriorityPolicy(data)).toBe(false);
    expect(workspace.cases[0].version).toBe(2);
  });

  it('uses the account password for offline unlock without persisting it', async () => {
    const v = await openOnline(identity, password);
    v.data.pending = pending;
    await saveVault(v);
    expect((await unlock(identity.profile.email, password)).data.pending).toEqual(pending);
    const row = await rows.get(v.id);
    expect(Object.keys(row).sort()).toEqual(['cipher', 'id', 'iv', 'salt', 'unlockMethod']);
    expect(row.unlockMethod).toBe('account-password');
    expect(v.key.extractable).toBe(false);
  });
  it('rejects a wrong offline password and leaves ciphertext untouched', async () => {
    const v = await openOnline(identity, password),
      before = await rows.get(v.id);
    await expect(unlock(identity.profile.email, 'incorrect')).rejects.toThrow('does not unlock');
    expect(await rows.get(v.id)).toEqual(before);
  });
  it('opens without the old secret and preserves an expired legacy outbox in a backup', async () => {
    const row = await legacyFixture();
    await expect(unlock(identity.profile.email, previous)).rejects.toThrow('Sign in online');
    const migrated = await openOnline(identity, password);
    expect(migrated.data.pending).toEqual([]);
    expect(migrated.data.savedWork).toHaveLength(1);
    expect(migrated.data.savedWork![0].row.cipher).toEqual(Array.from(new Uint8Array(row.cipher)));
    expect(migrated.salt).not.toEqual(row.salt);
    const reopened = await unlock(identity.profile.email, password);
    expect(reopened.data.savedWork).toEqual(migrated.data.savedWork);
    await expect(unlock(identity.profile.email, previous)).rejects.toThrow('does not unlock');
  });

  it('automatically migrates a legacy vault whose passphrase already matches the password', async () => {
    await legacyFixture(password);
    expect((await openOnline(identity, password)).data.pending).toEqual(pending);
    expect((await unlock(identity.profile.email, password)).data.pending).toEqual(pending);
  });
  it('allows a changed account password and retains older queued operations for recovery', async () => {
    const v = await openOnline(identity, password);
    v.data.pending = pending;
    await saveVault(v);
    const original = await rows.get(v.id);
    const changed = 'ChangedAccountPassword!26';
    const updated = await openOnline(identity, changed);
    expect((await unlock(identity.profile.email, changed)).data.savedWork).toHaveLength(1);
    expect(updated.data.savedWork![0].row).toEqual({
      ...original,
      cipher: Array.from(new Uint8Array(original.cipher)),
    });
    await expect(unlock(identity.profile.email, password)).rejects.toThrow('does not unlock');
  });
  it('preserves the original encrypted row if migration cannot write to storage', async () => {
    const row = await legacyFixture();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new DOMException('Synthetic full storage', 'QuotaExceededError');
    });
    await expect(openOnline(identity, password)).rejects.toThrow();
    expect(await rows.get(row.id)).toEqual(row);
    const v = await openOnline(identity, password);
    expect(v.data.savedWork![0].row).toEqual({
      ...row,
      cipher: Array.from(new Uint8Array(row.cipher)),
    });
  });
  it('will not migrate an old account identity merely because its email was reused', async () => {
    const row = await legacyFixture(password, 'different-staff-uid');
    await expect(openOnline(identity, password)).rejects.toThrow('different staff identity');
    expect(await rows.get(row.id)).toEqual(row);
  });
  it('keeps the offline expiry requirement after switching to one password', async () => {
    const v = await openOnline(identity, password);
    v.data.verifiedAt = '2020-01-01T00:00:00.000Z';
    v.data.pending = pending;
    await saveVault(v);
    await expect(unlock(identity.profile.email, password)).rejects.toThrow('expired');
    expect((await openOnline(identity, password)).data.pending).toEqual(pending);
  });
  it('keeps one backup across repeated sign-ins without the legacy passphrase', async () => {
    await legacyFixture();
    const first = await openOnline(identity, password);
    const second = await openOnline(identity, password);
    expect(second.data.savedWork).toEqual(first.data.savedWork);
  });

  it('preserves nested backups across another password change', async () => {
    await legacyFixture();
    const first = await openOnline(identity, password);
    const original = await rows.get(first.id);
    const changed = await openOnline(identity, 'AnotherPassword!26');
    expect(changed.data.savedWork![0].row).toEqual({
      ...original,
      cipher: Array.from(new Uint8Array(original.cipher)),
    });
    expect((await unlock(identity.profile.email, 'AnotherPassword!26')).data.savedWork).toEqual(
      changed.data.savedWork,
    );
  });
});
