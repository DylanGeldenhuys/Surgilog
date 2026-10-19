import Dexie, { type Table } from 'dexie';
import { sessionExpired } from './session-policy.ts';
import {
  dueDate,
  type Profile,
  type Hospital,
  type ReportingAccess,
  type Workspace,
  type ReportingWorkspace,
  type Pending,
  type Priority,
} from '../../shared/domain.ts';
const PRIORITY_POLICY = 'leo-2026-10-04-30-90-365';
export type VaultData = {
  profile: Profile;
  hospitals: Hospital[];
  reportingAccess?: ReportingAccess[];
  workspaces: Record<string, Workspace>;
  reporting?: Record<string, ReportingWorkspace>;
  pending: Pending[];
  verifiedAt: string;
  priorityPolicy?: string;
  savedWork?: SavedWorkBackup[];
};
type Row = {
  id: string;
  salt: number[];
  iv: number[];
  cipher: ArrayBuffer;
  unlockMethod?: 'account-password'; // Absent on early development data.
};
type SavedWorkBackup = {
  backupId: string;
  savedAt: string;
  row: Omit<Row, 'cipher'> & { cipher: number[] };
};
type DeviceSession = {
  id: 'current';
  vaultId: string;
  uid: string;
  key?: CryptoKey;
  lastActivity: number;
};
class Store extends Dexie {
  vaults!: Table<Row>;
  sessions!: Table<DeviceSession>;
  constructor() {
    super('theatre-tracker-v1');
    this.version(1).stores({ vaults: 'id' });
    this.version(2).stores({ vaults: 'id', sessions: 'id' });
  }
}
const db = new Store();
const encode = new TextEncoder();
async function accountId(email: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encode.encode(email.trim().toLowerCase())),
    ),
  )
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
async function keyFor(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encode.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 310000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
export type Vault = {
  id: string;
  salt: number[];
  key: CryptoKey;
  unlockMethod: 'account-password';
  release?: () => void;
  lifecycle: { closed: boolean; writes: Promise<void>; lastActivity: number };
  data: VaultData;
};
function lifecycle(lastActivity = Date.now()): Vault['lifecycle'] {
  return { closed: false, writes: Promise.resolve(), lastActivity };
}
function durableWrite(v: Vault, write: () => Promise<void>) {
  const next = v.lifecycle.writes.then(async () => {
    if (v.lifecycle.closed) throw new Error('Session ended. Sign in to continue.');
    await write();
  });
  v.lifecycle.writes = next.catch(() => {});
  return next;
}
function ensureReportingAccess(data: VaultData) {
  data.reportingAccess ??= data.profile.memberships.map((membership) => ({
    hospitalId: membership.hospitalId,
    departments: membership.departments,
  }));
}
async function decrypt(row: Row, key: CryptoKey): Promise<VaultData> {
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(row.iv), additionalData: encode.encode(row.id) },
        key,
        row.cipher,
      ),
    ),
  );
}
export function upgradePriorityPolicy(data: VaultData) {
  if (data.priorityPolicy === PRIORITY_POLICY) return false;
  const migratedCases = new Set<string>();
  for (const workspace of Object.values(data.workspaces)) {
    for (const surgicalCase of workspace.cases) {
      const raw = surgicalCase.priority as string,
        priority = (raw === 'P1a' || raw === 'P1b' ? 'P1' : raw) as Priority;
      if (!['P1', 'P2', 'P3'].includes(priority)) continue;
      const nextDueAt = dueDate(surgicalCase.urgencyAt, priority);
      if (raw === priority && surgicalCase.dueAt === nextDueAt) continue;
      surgicalCase.priority = priority;
      surgicalCase.dueAt = nextDueAt;
      surgicalCase.version++;
      migratedCases.add(`${workspace.hospital.id}/${surgicalCase.id}`);
    }
  }
  for (const entry of data.pending) {
    const operation = entry.operation;
    if (operation.type === 'register' || operation.type === 'priority') {
      const priority = operation.data.priority as string;
      if (priority === 'P1a' || priority === 'P1b') operation.data.priority = 'P1';
    }
    if (
      !['register', 'patient', 'session'].includes(operation.type) &&
      'caseId' in operation.data &&
      'version' in operation.data &&
      migratedCases.has(`${entry.hospitalId}/${operation.data.caseId}`)
    )
      operation.data.version++;
  }
  data.priorityPolicy = PRIORITY_POLICY;
  return true;
}
export async function unlock(email: string, password: string): Promise<Vault> {
  const id = await accountId(email),
    row = await db.vaults.get(id);
  if (!row) throw new Error('No offline workspace on this device. Sign in online first.');
  if (row.unlockMethod !== 'account-password')
    throw new Error('Sign in online once to prepare this device for offline use.');
  const key = await keyFor(password, new Uint8Array(row.salt));
  let data: VaultData;
  try {
    data = await decrypt(row, key);
  } catch {
    throw new Error(
      'That password does not unlock the saved workspace. Use the password from your last online sign-in on this browser, or sign in online to update it. Saved work has not been changed.',
    );
  }
  ensureReportingAccess(data);
  const session = await db.sessions.get('current');
  const lastActivity =
    session?.vaultId === id && session.uid === data.profile.uid
      ? session.lastActivity
      : Date.parse(data.verifiedAt);
  if (sessionExpired(lastActivity))
    throw new Error(
      'Offline access has expired. Sign in online to renew access and recover pending work.',
    );
  const vault: Vault = {
    id,
    salt: row.salt,
    key,
    unlockMethod: 'account-password',
    data,
    lifecycle: lifecycle(),
  };
  if (upgradePriorityPolicy(data)) await saveVault(vault);
  return vault;
}
// The caller must authenticate this account online before opening or migrating.
// If the old secret is unavailable, preserve the entire original encrypted row
// inside the new encrypted vault. One atomic write saves BOTH before opening.
export async function openOnline(
  data: Pick<VaultData, 'profile' | 'hospitals' | 'reportingAccess'>,
  password: string,
): Promise<Vault> {
  const id = await accountId(data.profile.email),
    existing = await db.vaults.get(id);
  if (!password) throw new Error('Enter your account password.');
  let previous: VaultData | undefined;
  let savedWork: SavedWorkBackup[] = [];
  if (existing) {
    try {
      previous = await decrypt(existing, await keyFor(password, new Uint8Array(existing.salt)));
    } catch {
      savedWork = [
        {
          backupId: crypto.randomUUID(),
          savedAt: new Date().toISOString(),
          row: { ...existing, cipher: Array.from(new Uint8Array(existing.cipher)) },
        },
      ];
    }
    if (previous && previous.profile.uid !== data.profile.uid)
      throw new Error(
        'This saved workspace belongs to a different staff identity. Contact your administrator; saved work has not been changed.',
      );
    if (previous) upgradePriorityPolicy(previous);
  }
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))),
    key = await keyFor(password, new Uint8Array(salt));
  const resolvedReportingAccess =
      data.reportingAccess ??
      data.profile.memberships.map((membership) => ({
        hospitalId: membership.hospitalId,
        departments: membership.departments,
      })),
    grants = new Set(
      data.profile.memberships
        .filter((m) => m.role !== 'viewer')
        .flatMap((m) => m.departments.map((d) => `${m.hospitalId}/${d}`)),
    ),
    reportingGrants = new Map(
      resolvedReportingAccess.map((grant) => [grant.hospitalId, new Set(grant.departments)]),
    );
  const v: Vault = {
    id,
    salt,
    key,
    unlockMethod: 'account-password',
    lifecycle: lifecycle(),
    data: {
      ...data,
      reportingAccess: resolvedReportingAccess,
      verifiedAt: new Date().toISOString(),
      priorityPolicy: PRIORITY_POLICY,
      pending: previous?.pending ?? [],
      savedWork: previous?.savedWork ?? savedWork,
      workspaces: Object.fromEntries(
        Object.entries(previous?.workspaces ?? {}).filter(([k]) => grants.has(k)),
      ),
      reporting: Object.fromEntries(
        Object.entries(previous?.reporting ?? {}).filter(([, report]) => {
          if (!report.scope.hospitalIds?.length || !report.scope.departments?.length) return false;
          return (
            report.scope.hospitalIds.every((hospitalId) => reportingGrants.has(hospitalId)) &&
            report.scope.departments.every((selection) =>
              reportingGrants.get(selection.hospitalId)?.has(selection.departmentId),
            )
          );
        }),
      ),
    },
  };
  await saveVault(v);
  // Firefox may wait for a browser permission prompt here. Persistence is a
  // best-effort eviction safeguard; the durable vault write above gates login.
  void Promise.resolve()
    .then(() => navigator.storage?.persist?.())
    .catch(() => false);
  return v;
}
export async function saveVault(v: Vault) {
  return durableWrite(v, async () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: encode.encode(v.id) },
      v.key,
      encode.encode(JSON.stringify(v.data)),
    );
    await db.vaults.put({
      id: v.id,
      salt: v.salt,
      iv: Array.from(iv),
      cipher,
      unlockMethod: v.unlockMethod,
    });
  });
}

// CryptoKey is structured-cloned by IndexedDB; the password and raw key bytes
// are never stored. Explicit logout removes both the session key and ciphertext.
export function rememberWorkspace(v: Vault) {
  return durableWrite(v, async () => {
    await db.sessions.put({
      id: 'current',
      vaultId: v.id,
      uid: v.data.profile.uid,
      key: v.key,
      lastActivity: v.lifecycle.lastActivity,
    });
  });
}

export async function forgetRememberedWorkspace() {
  await db.sessions.update('current', { key: undefined });
}

export async function resumeWorkspace(uid: string): Promise<Vault | null> {
  const session = await db.sessions.get('current');
  if (!session || session.uid !== uid || !session.key) return null;
  if (sessionExpired(session.lastActivity)) {
    await db.sessions.update('current', { key: undefined });
    return null;
  }
  const row = await db.vaults.get(session.vaultId);
  if (!row) return null;
  const data = await decrypt(row, session.key);
  if (data.profile.uid !== uid) throw new Error('Saved account does not match this session.');
  ensureReportingAccess(data);
  const v: Vault = {
    id: row.id,
    salt: row.salt,
    key: session.key,
    unlockMethod: 'account-password',
    data,
    lifecycle: lifecycle(session.lastActivity),
  };
  if (upgradePriorityPolicy(data)) await saveVault(v);
  return v;
}

export async function recordActivity(v: Vault, now = Date.now()) {
  if (v.lifecycle.closed || sessionExpired(v.lifecycle.lastActivity, now))
    throw new Error('Your session has expired. Sign in again.');
  v.lifecycle.lastActivity = now;
  return durableWrite(v, async () => {
    const session = await db.sessions.get('current');
    if (session?.vaultId === v.id && session.uid === v.data.profile.uid && session.key)
      await db.sessions.update('current', { lastActivity: v.lifecycle.lastActivity });
  });
}

export async function endWorkspace(v: Vault, discard: boolean) {
  // Mark closed before awaiting anything: late network responses and queued
  // writes cannot recreate a vault after logout.
  v.lifecycle.closed = true;
  await v.lifecycle.writes;
  await db.transaction('rw', db.vaults, db.sessions, async () => {
    const session = await db.sessions.get('current');
    if (session?.vaultId === v.id && session.uid === v.data.profile.uid) {
      if (discard) await db.sessions.delete('current');
      else await db.sessions.update('current', { key: undefined });
    }
    if (discard) await db.vaults.delete(v.id);
  });
}

// Keep a single unlocked workspace per browser origin. The browser releases
// this lock on tab close/crash; no stale localStorage lease can lose the outbox.
export async function acquireWorkspace(): Promise<() => void> {
  if (!navigator.locks)
    throw new Error(
      'This browser cannot protect the offline workspace. Use a current browser with Web Locks support.',
    );
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request('theatre-tracker-workspace', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          reject(
            new Error(
              'A workspace is already open in another tab. Close that tab before continuing here, or log out there to discard its unsynced work.',
            ),
          );
          return;
        }
        await new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
