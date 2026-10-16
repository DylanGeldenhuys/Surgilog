import { useCallback, useEffect, useRef, useState } from 'react';
import { api, auth, RequestError } from './firebase.ts';
import { saveVault, type Vault, type VaultData } from './vault.ts';
import { sessionExpired, type SessionEnd } from './session-policy.ts';
import { shouldHoldForRetry } from './sync-policy.ts';
import { acknowledgeOperation } from './workspace-projection.ts';
import { SnapshotGuard } from './snapshot-guard.ts';
export { projected } from './workspace-projection.ts';
import {
  operationSchema,
  type Operation,
  type OperationResult,
  type Workspace,
  type ReportingWorkspace,
  type Pending,
  type Identity,
  type ReportingDepartmentSelection,
} from '../../shared/domain.ts';

export function reportingCacheKey(
  hospitalIds: string[],
  departments: ReportingDepartmentSelection[],
) {
  const hospitals = [...hospitalIds].sort().join(','),
    departmentKeys = departments
      .map((item) => `${item.hospitalId}/${item.departmentId}`)
      .sort()
      .join(',');
  return `h:${hospitals}|d:${departmentKeys}`;
}

async function sendOperation(hospitalId: string, operation: Operation) {
  const result = await api<OperationResult>(`/api/hospitals/${hospitalId}/operations`, operation);
  if (result.id !== operation.id || !Number.isFinite(Date.parse(result.acceptedAt)))
    throw new RequestError(
      0,
      'The server response could not be confirmed. Retry the same request.',
    );
  return result;
}

export function useWorkspace(initial: Vault, onEnd: (reason: SessionEnd) => void) {
  const [data, setData] = useState(initial.data),
    ref = useRef(initial),
    chain = useRef(Promise.resolve()),
    syncLock = useRef(false),
    snapshots = useRef(new SnapshotGuard()),
    alive = useRef(true);
  const [busy, setBusy] = useState(false),
    [connection, setConnection] = useState(navigator.onLine),
    [message, setMessage] = useState('');
  const commit = useCallback((fn: (data: VaultData) => VaultData) => {
    const task = chain.current.then(async () => {
      if (!alive.current || initial.lifecycle.closed)
        throw new Error('Session ended. Sign in to continue.');
      const next = { ...ref.current, data: fn(ref.current.data) };
      await saveVault(next);
      ref.current = next;
      if (alive.current) setData(next.data);
    });
    chain.current = task.catch(() => {});
    return task;
  }, []);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [initial],
  );
  const refresh = useCallback(
    async (hid: string, dep: string) => {
      await auth.authStateReady();
      if (auth.currentUser?.uid !== ref.current.data.profile.uid)
        throw new RequestError(401, 'Sign in with this workspace account to refresh.');
      try {
        const key = `${hid}/${dep}`,
          current = snapshots.current.beginRead(key);
        const w = await api<Workspace>(`/api/hospitals/${hid}/workspace?departmentId=${dep}`);
        await commit((d) => (current() ? { ...d, workspaces: { ...d.workspaces, [key]: w } } : d));
        setConnection(true);
        return w;
      } catch (e) {
        if (!(e as RequestError).status) setConnection(false);
        throw e;
      }
    },
    [commit],
  );
  const refreshReporting = useCallback(
    async (hospitalIds: string[], departments: ReportingDepartmentSelection[]) => {
      await auth.authStateReady();
      if (auth.currentUser?.uid !== ref.current.data.profile.uid)
        throw new RequestError(401, 'Sign in with this workspace account to refresh.');
      const key = reportingCacheKey(hospitalIds, departments),
        query = new URLSearchParams({
          hospitalIds: hospitalIds.join(','),
          departmentKeys: departments
            .map((item) => `${item.hospitalId}/${item.departmentId}`)
            .join(','),
        });
      try {
        const current = snapshots.current.beginRead(`report:${key}`);
        const report = await api<ReportingWorkspace>(`/api/reporting/overview?${query}`);
        await commit((d) =>
          current()
            ? {
                ...d,
                reporting: { ...(d.reporting ?? {}), [key]: report },
              }
            : d,
        );
        setConnection(true);
        return report;
      } catch (e) {
        if (!(e as RequestError).status) setConnection(false);
        throw e;
      }
    },
    [commit],
  );
  const sync = useCallback(async () => {
    if (syncLock.current || !alive.current || initial.lifecycle.closed) return;
    syncLock.current = true;
    setBusy(true);
    try {
      await auth.authStateReady();
      if (auth.currentUser?.uid !== ref.current.data.profile.uid) {
        setMessage('Sign in online with this workspace account to sync.');
        return;
      }
      const identity = await api<Identity>('/api/me');
      const previous = ref.current.data;
      if (
        !!previous.profile.superUser !== !!identity.profile.superUser ||
        JSON.stringify(previous.profile.memberships) !==
          JSON.stringify(identity.profile.memberships) ||
        JSON.stringify(previous.profile.reportingGrants ?? []) !==
          JSON.stringify(identity.profile.reportingGrants ?? []) ||
        JSON.stringify(previous.reportingAccess ?? []) !== JSON.stringify(identity.reportingAccess)
      ) {
        await commit((d) => ({ ...d, ...identity, workspaces: {}, reporting: {} }));
        setMessage('Your access changed. Sign in again to use the updated permissions.');
        onEnd('access');
        return;
      }
      const pending = ref.current.data.pending.filter((p) => p.status === 'pending');
      for (const p of pending) {
        if (!alive.current) return;
        try {
          const result = await snapshots.current.write(() =>
            sendOperation(p.hospitalId, p.operation),
          );
          await commit((d) => acknowledgeOperation(d, p, result));
          setConnection(true);
          setMessage('Saved activity synced with the hospital workspace.');
        } catch (e) {
          const error = e as RequestError;
          if (error.status === 401) throw error;
          if (!error.status || error.status >= 500 || error.status === 429) {
            setConnection(error.status !== 0);
            setMessage(error.message);
            break;
          }
          await commit((d) => ({
            ...d,
            pending: d.pending.map((x) =>
              x.operation.id === p.operation.id
                ? {
                    ...x,
                    status: error.status === 409 ? 'conflict' : 'rejected',
                    error: error.message,
                  }
                : x,
            ),
          }));
          setMessage(error.message);
          // Stop dependent edits to the same case; they remain visible for review.
          const target = (op: Operation) =>
            op.type === 'theatre-entry'
              ? `entry:${op.data.entryId}`
              : 'caseId' in op.data
                ? `case:${op.data.caseId}`
                : null;
          const cid = target(p.operation);
          if (cid)
            await commit((d) => ({
              ...d,
              pending: d.pending.map((x) =>
                x.operation.id !== p.operation.id &&
                x.hospitalId === p.hospitalId &&
                x.status === 'pending' &&
                target(x.operation) === cid
                  ? {
                      ...x,
                      status: 'conflict',
                      error: 'An earlier change for this record needs review first.',
                    }
                  : x,
              ),
            }));
          break;
        }
      }
      if (!alive.current) return;
      for (const key of Object.keys(ref.current.data.workspaces)) {
        const [h, dep] = key.split('/');
        try {
          await refresh(h, dep);
        } catch (e) {
          const error = e as RequestError;
          if (error.status === 403) {
            await commit((d) => {
              const workspaces = { ...d.workspaces };
              delete workspaces[key];
              return { ...d, workspaces };
            });
            setMessage(error.message);
          } else {
            setConnection(false);
            break;
          }
        }
      }
      for (const [key, cached] of Object.entries(ref.current.data.reporting ?? {})) {
        const hospitalIds = cached.scope.hospitalIds?.length
            ? cached.scope.hospitalIds
            : cached.scope.hospitalId
              ? [cached.scope.hospitalId]
              : (ref.current.data.reportingAccess ?? []).map((item) => item.hospitalId),
          departments = cached.scope.departments?.length
            ? cached.scope.departments
            : cached.scope.hospitalId && cached.scope.departmentId
              ? [
                  {
                    hospitalId: cached.scope.hospitalId,
                    departmentId: cached.scope.departmentId,
                  },
                ]
              : (ref.current.data.reportingAccess ?? [])
                  .filter((item) => hospitalIds.includes(item.hospitalId))
                  .flatMap((item) =>
                    item.departments.map((departmentId) => ({
                      hospitalId: item.hospitalId,
                      departmentId,
                    })),
                  );
        try {
          await refreshReporting(hospitalIds, departments);
          const currentKey = reportingCacheKey(hospitalIds, departments);
          if (currentKey !== key)
            await commit((d) => {
              const reporting = { ...(d.reporting ?? {}) };
              delete reporting[key];
              return { ...d, reporting };
            });
        } catch (e) {
          const error = e as RequestError;
          if (error.status === 403) {
            await commit((d) => {
              const reporting = { ...(d.reporting ?? {}) };
              delete reporting[key];
              return { ...d, reporting };
            });
          } else {
            setConnection(false);
            break;
          }
        }
      }
    } catch (e) {
      if (!alive.current) return;
      setMessage((e as Error).message);
      setConnection(!!(e as RequestError).status);
      if ([401, 403].includes((e as RequestError).status)) {
        await commit((d) => ({
          ...d,
          workspaces: {},
          reporting: {},
          verifiedAt: '1970-01-01T00:00:00.000Z',
        }));
        onEnd('access');
      }
    } finally {
      setBusy(false);
      syncLock.current = false;
    }
  }, [commit, refresh, refreshReporting, onEnd]);
  const submit = useCallback(
    async (hid: string, op: Operation) => {
      if (!alive.current || initial.lifecycle.closed)
        throw new Error('Session ended. Sign in to continue.');
      if (sessionExpired(initial.lifecycle.lastActivity)) {
        onEnd('expired');
        throw new Error('Your session has expired. Sign in again.');
      }
      op = operationSchema.parse(op);
      const departmentId =
        'departmentId' in op.data
          ? op.data.departmentId
          : Object.values(ref.current.data.workspaces)
              .filter((w) => w.hospital.id === hid)
              .flatMap((w) => w.cases)
              .find((c) => 'caseId' in op.data && c.id === op.data.caseId)?.departmentId;
      const pendingEntry: Pending = {
        hospitalId: hid,
        departmentId,
        operation: op,
        status: 'pending',
      };
      if (['book', 'session'].includes(op.type)) {
        if (auth.currentUser?.uid !== ref.current.data.profile.uid)
          throw new Error('Sign in with this workspace account first.');
        const result = await snapshots.current.write(() => sendOperation(hid, op));
        setConnection(true);
        try {
          await commit((d) => acknowledgeOperation(d, pendingEntry, result));
          setMessage('Confirmed by the hospital workspace.');
        } catch {
          setMessage('Saved to the server. Refresh to update this device’s offline copy.');
        }
        return;
      }
      const hasPendingAhead = ref.current.data.pending.some((p) => p.status === 'pending');
      if (navigator.onLine && !hasPendingAhead) {
        try {
          const result = await snapshots.current.write(() => sendOperation(hid, op));
          setConnection(true);
          try {
            await commit((d) => acknowledgeOperation(d, pendingEntry, result));
            setMessage('Synced with the hospital workspace.');
          } catch {
            setMessage('Saved to the server. Refresh to update this device’s offline copy.');
          }
          if (departmentId) void refresh(hid, departmentId).catch(() => {});
          return;
        } catch (e) {
          const error = e as RequestError;
          if (!shouldHoldForRetry(error.status)) throw e;
          setConnection(error.status !== 0);
        }
      }
      await commit((d) => ({
        ...d,
        pending: d.pending.some((p) => p.operation.id === op.id)
          ? d.pending
          : [...d.pending, pendingEntry],
      }));
      setMessage(
        navigator.onLine
          ? 'The hospital server is temporarily unavailable. Saved on this device and retrying.'
          : 'Connection unavailable. Saved on this device and will sync when reconnected.',
      );
      if (navigator.onLine) void sync();
    },
    [commit, refresh, sync],
  );
  useEffect(() => {
    const online = () => {
        setConnection(true);
        void sync();
      },
      offline = () => setConnection(false),
      resume = () => {
        if (navigator.onLine && !document.hidden) void sync();
      };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    if (navigator.onLine) void sync();
    const id = setInterval(() => {
      if (navigator.onLine && !document.hidden) void sync();
    }, 30000);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      clearInterval(id);
    };
  }, [sync]);
  const resolve = useCallback(
    (id: string) =>
      commit((d) => ({
        ...d,
        pending: d.pending.map((p) =>
          p.operation.id === id
            ? { ...p, status: 'resolved', error: `Reviewed: kept server version. ${p.error ?? ''}` }
            : p,
        ),
      })),
    [commit],
  );
  const refreshIdentity = useCallback(async () => {
    const identity = await api<Identity>('/api/me');
    await commit((d) => ({ ...d, ...identity, workspaces: {}, reporting: {} }));
  }, [commit]);
  return {
    data,
    submit,
    refresh,
    refreshReporting,
    sync,
    busy,
    connection,
    message,
    setMessage,
    resolve,
    refreshIdentity,
  };
}
