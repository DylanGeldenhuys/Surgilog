import { useEffect, useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { ArrowRight, ShieldCheck, HeartPulse, Check } from 'lucide-react';
import { auth, api } from './firebase.ts';
import { isLocalDemo, isProduction } from './config.ts';
import { openOnline, unlock, acquireWorkspace, rememberWorkspace, type Vault } from './vault.ts';
import type { Identity } from '../../shared/domain.ts';
import { Brand, Field } from './ui.tsx';
import { shouldHoldForRetry } from './sync-policy.ts';

function connectionUnavailable(error: unknown) {
  const detail = error as { code?: string; status?: number };
  return (
    !navigator.onLine ||
    detail.code === 'auth/network-request-failed' ||
    (typeof detail.status === 'number' && shouldHoldForRetry(detail.status))
  );
}

export function Login({
  onOpen,
  initialNotice = '',
}: {
  onOpen: (v: Vault) => void;
  initialNotice?: string;
}) {
  const [email, setEmail] = useState(isLocalDemo ? 'leo@demo.theatre.local' : ''),
    [password, setPassword] = useState(isLocalDemo ? 'TheatreDemo!26' : ''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(initialNotice),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setError('');
  }, [email]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    let release: (() => void) | undefined;
    try {
      release = await acquireWorkspace();
      let v: Vault;
      if (!navigator.onLine) {
        v = await unlock(email, password);
      } else {
        try {
          await signInWithEmailAndPassword(auth, email, password);
          const identity = await api<Identity>('/api/me');
          v = await openOnline(identity, password);
        } catch (onlineError) {
          if (!connectionUnavailable(onlineError)) throw onlineError;
          v = await unlock(email, password);
        }
      }
      await rememberWorkspace(v);
      onOpen({ ...v, release });
    } catch (e) {
      release?.();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <section className="login-story">
        <Brand />
        <div className="story-body">
          <h1>
            Every patient. <br />
            Every theatre.
            <br />
            <em>Every day.</em>
          </h1>
          <p>A shared view of your surgical backlog, so your team can turn waiting into care.</p>
          <div className="story-points">
            <span>
              <Check /> Clinical priorities, clearly visible
            </span>
            <span>
              <Check /> One team, one theatre list
            </span>
            <span>
              <Check /> Keep recording when the internet drops
            </span>
          </div>
        </div>
        <div className="story-footer">
          <HeartPulse size={17} /> Built for South African hospital teams
        </div>
      </section>
      <section className="login-form">
        <div className="login-card">
          <div className="demo-label">
            {isLocalDemo
              ? 'LOCAL V1 · SYNTHETIC DATA ONLY'
              : isProduction
                ? 'PRODUCTION'
                : 'REVIEW VERSION · SYNTHETIC DATA ONLY'}
          </div>
          <h2>Welcome to your workspace</h2>
          <p>Sign in to bring your team’s day into focus.</p>
          <form onSubmit={submit}>
            <Field label="Staff email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
            </Field>
            <Field label="Password">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="button primary full" disabled={busy}>
              {busy ? 'Opening workspace…' : 'Open workspace'}
              <ArrowRight size={17} />
            </button>
          </form>
          <button
            className="text-button"
            disabled={busy}
            onClick={async () => {
              setError('');
              setNotice('');
              if (!email.trim()) {
                setError('Enter your staff email first.');
                return;
              }
              setBusy(true);
              try {
                await sendPasswordResetEmail(auth, email.trim());
                setNotice(
                  'If this email has an account, password setup instructions have been sent.',
                );
              } catch {
                setError('Password setup could not be requested. Check your email and connection.');
              } finally {
                setBusy(false);
              }
            }}
          >
            Set or reset password
          </button>
          {notice && <p role="status">{notice}</p>}
          {isLocalDemo && (
            <div className="demo-accounts">
              <span>TRY A DIFFERENT ROLE</span>
              <div>
                {[
                  ['super', 'Super User'],
                  ['major', 'Major User'],
                  ['hospital-admin', 'System Admin'],
                  ['leo', 'Doctor'],
                  ['sister', 'Scrub sister'],
                  ['clerk', 'Clerk'],
                  ['major-read', 'Major read only'],
                  ['reports', 'Reports'],
                  ['global', 'Global reports'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => {
                      setEmail(`${id}@demo.theatre.local`);
                      setPassword('TheatreDemo!26');
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="login-note">
            <ShieldCheck size={18} />
            <span>
              {isProduction ? (
                <>
                  Production workspace.
                  <br />
                  Sign in with the account issued for your hospital.
                </>
              ) : (
                <>
                  {isLocalDemo ? 'Local Firebase emulators.' : 'For invited reviewers.'} All
                  patients are fictional.
                  <br />
                  Nothing is connected to a live hospital.
                </>
              )}
            </span>
          </div>
          <p>
            <a href="/api/app-update.html">Check for app updates</a>
          </p>
        </div>
      </section>
    </main>
  );
}
