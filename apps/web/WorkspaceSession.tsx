import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { api, auth, RequestError, setWorkspaceGuard } from './firebase.ts';
import { Login } from './Login.tsx';
import {
  acquireWorkspace,
  endWorkspace,
  forgetRememberedWorkspace,
  recordActivity,
  resumeWorkspace,
  saveVault,
  type Vault,
} from './vault.ts';
import { sessionExpired, type SessionEnd } from './session-policy.ts';
import type { Identity } from '../../shared/domain.ts';

export function WorkspaceSession({
  children,
}: {
  children: (vault: Vault, end: (reason: SessionEnd) => void) => ReactNode;
}) {
  const [vault, setVault] = useState<Vault | null>(null);
  const [loading, setLoading] = useState(true);
  const [ending, setEnding] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const closing = useRef<{ vault: Vault; reason: SessionEnd } | null>(null);
  const finishing = useRef(false);

  const finish = useCallback(async () => {
    const task = closing.current;
    if (!task || finishing.current) return;
    finishing.current = true;
    setFailure('');
    try {
      await endWorkspace(task.vault, task.reason === 'logout');
      await signOut(auth);
      task.vault.release?.();
      closing.current = null;
      setWorkspaceGuard();
      setNotice(
        task.reason === 'expired'
          ? 'Your session expired after three days of inactivity. Sign in again.'
          : task.reason === 'access'
            ? 'Sign in again to check your account access.'
            : 'You have logged out.',
      );
      setEnding(false);
    } catch {
      setFailure('Log out could not finish on this device. Please retry.');
    } finally {
      finishing.current = false;
    }
  }, []);

  const end = useCallback(
    (reason: SessionEnd) => {
      if (!vault || closing.current) return;
      vault.lifecycle.closed = true;
      closing.current = { vault, reason };
      setEnding(true);
      setVault(null);
      void finish();
    },
    [vault, finish],
  );

  useEffect(() => {
    let disposed = false;
    let release: (() => void) | undefined;
    let restored: Vault | null = null;
    void (async () => {
      try {
        // Acquire before touching shared Auth or storage. A second tab must not
        // sign out or clear the session belonging to the working tab.
        release = await acquireWorkspace();
        await auth.authStateReady();
        restored = auth.currentUser ? await resumeWorkspace(auth.currentUser.uid) : null;
        if (restored) {
          if (navigator.onLine) {
            try {
              const identity = await api<Identity>('/api/me');
              if (identity.profile.uid !== restored.data.profile.uid)
                throw new RequestError(401, 'Account changed. Sign in again.');
              const changed =
                JSON.stringify(restored.data.profile) !== JSON.stringify(identity.profile) ||
                JSON.stringify(restored.data.reportingAccess) !==
                  JSON.stringify(identity.reportingAccess) ||
                JSON.stringify(restored.data.hospitals) !== JSON.stringify(identity.hospitals);
              restored.data = {
                ...restored.data,
                ...identity,
                verifiedAt: new Date().toISOString(),
                ...(changed ? { workspaces: {}, reporting: {} } : {}),
              };
              await saveVault(restored);
            } catch (error) {
              const status = (error as RequestError).status;
              if (status && status < 500 && status !== 429) throw error;
              // A prepared, unexpired session can still open during an outage.
            }
          }
          if (disposed) return;
          await recordActivity(restored);
          setVault({ ...restored, release });
          release = undefined;
        } else {
          await forgetRememberedWorkspace();
          await signOut(auth);
        }
      } catch (error) {
        if (restored) {
          await endWorkspace(restored, false).catch(() => {});
          await signOut(auth).catch(() => {});
        }
        if (!disposed) setNotice((error as Error).message);
      } finally {
        release?.();
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!vault) return;
    const check = () => {
      if (vault.lifecycle.closed) return false;
      if (sessionExpired(vault.lifecycle.lastActivity)) {
        end('expired');
        return false;
      }
      return true;
    };
    setWorkspaceGuard(() => {
      if (!check()) throw new RequestError(401, 'Your session ended. Sign in again.');
    });
    let persistedAt = vault.lifecycle.lastActivity;
    const activity = (event?: Event) => {
      if (document.hidden || (event && !event.isTrusted) || !check()) return;
      const now = Date.now();
      if (now - persistedAt >= 10_000) {
        persistedAt = now;
        void recordActivity(vault, now).catch(() => end('access'));
      } else vault.lifecycle.lastActivity = now;
    };
    const persist = () => {
      if (check())
        void recordActivity(vault, vault.lifecycle.lastActivity).catch(() => end('access'));
    };
    const visible = (event: Event) => {
      if (document.hidden) persist();
      else activity(event);
    };
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user?.uid !== vault.data.profile.uid) end('access');
    });
    for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'])
      window.addEventListener(name, activity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pagehide', persist);
    const timer = setInterval(check, 15_000);
    return () => {
      unsubscribe();
      clearInterval(timer);
      for (const name of ['pointerdown', 'keydown', 'wheel', 'touchstart', 'focus'])
        window.removeEventListener(name, activity, { capture: true });
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pagehide', persist);
      // Explicit logout owns the lock until local deletion and Auth sign-out
      // finish. Other unmounts only release after outstanding writes settle.
      if (!vault.lifecycle.closed) {
        vault.lifecycle.closed = true;
        void vault.lifecycle.writes.finally(() => vault.release?.());
        setWorkspaceGuard();
      }
    };
  }, [vault, end]);

  if (loading || ending)
    return (
      <main className="session-progress" aria-busy={!failure}>
        <p role="status">{failure || (ending ? 'Logging out…' : 'Opening your workspace…')}</p>
        {failure && (
          <button className="button primary" onClick={() => void finish()}>
            Retry log out
          </button>
        )}
      </main>
    );
  return vault ? children(vault, end) : <Login onOpen={setVault} initialNotice={notice} />;
}
