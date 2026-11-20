import { useState, type FormEvent } from 'react';
import { signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { ArrowRight, ShieldCheck, HeartPulse, Check } from 'lucide-react';
import { auth, api } from './firebase.ts';
import { isLocalDemo, isProduction } from './config.ts';
import { openOnline, unlock, acquireWorkspace, rememberWorkspace, type Vault } from './vault.ts';
import type { Identity } from '../../shared/domain.ts';
import { Brand, Field, PasswordInput } from './ui.tsx';
import { shouldHoldForRetry } from './sync-policy.ts';
import {
  loginCopy,
  passwordResetOutcome,
  passwordResetSentMessage,
  resetFieldError,
  signInErrorMessage,
  signInFieldError,
} from './login-messages.ts';

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
    [notice] = useState(initialNotice),
    [confirmation, setConfirmation] = useState(''),
    [busy, setBusy] = useState(false),
    [mode, setMode] = useState<'sign-in' | 'reset'>('sign-in');

  function updateEmail(value: string) {
    setEmail(value);
    setError('');
    setConfirmation('');
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const fieldError = signInFieldError(email, password);
    if (fieldError) {
      setError(fieldError);
      return;
    }
    setBusy(true);
    setError('');
    const address = email.trim();
    let release: (() => void) | undefined;
    try {
      release = await acquireWorkspace();
      let v: Vault;
      if (!navigator.onLine) {
        v = await unlock(address, password);
      } else {
        try {
          await signInWithEmailAndPassword(auth, address, password);
          const identity = await api<Identity>('/api/me');
          v = await openOnline(identity, password);
        } catch (onlineError) {
          if (!connectionUnavailable(onlineError)) throw onlineError;
          v = await unlock(address, password);
        }
      }
      await rememberWorkspace(v);
      onOpen({ ...v, release });
    } catch (e) {
      release?.();
      setError(signInErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    const fieldError = resetFieldError(address);
    if (fieldError) {
      setError(fieldError);
      setConfirmation('');
      return;
    }
    if (!navigator.onLine) {
      setError(loginCopy.network);
      setConfirmation('');
      return;
    }
    setBusy(true);
    setError('');
    setConfirmation('');
    try {
      await sendPasswordResetEmail(auth, address);
      setConfirmation(passwordResetSentMessage(address));
    } catch (resetError) {
      const outcome = passwordResetOutcome(resetError, address);
      if (outcome.status === 'sent') setConfirmation(outcome.message);
      else setError(outcome.message);
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
          {!isProduction && (
            <div className="demo-label">
              {isLocalDemo
                ? 'LOCAL V1 · SYNTHETIC DATA ONLY'
                : 'REVIEW VERSION · SYNTHETIC DATA ONLY'}
            </div>
          )}
          <h2>{mode === 'reset' ? 'Reset your password' : 'Welcome to your workspace'}</h2>
          <p>
            {mode === 'reset'
              ? 'Enter your staff email and we will send a link to choose a new password.'
              : 'Sign in to bring your team’s day into focus.'}
          </p>
          {mode === 'sign-in' && notice && (
            <div className="info" role="status">
              {notice}
            </div>
          )}
          {mode === 'sign-in' ? (
            <form onSubmit={submit} noValidate>
              <Field label="Staff email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => updateEmail(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                />
              </Field>
              <div className="login-password">
                <PasswordInput
                  label="Password"
                  value={password}
                  onChange={(value) => {
                    setPassword(value);
                    setError('');
                  }}
                  disabled={busy}
                />
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    setMode('reset');
                    setError('');
                  }}
                >
                  Forgot password?
                </button>
              </div>
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button primary full"
                type="submit"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Signing in…' : 'Sign in'}
                <ArrowRight size={17} />
              </button>
            </form>
          ) : (
            <form onSubmit={sendReset} noValidate>
              <Field label="Staff email">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => updateEmail(e.target.value)}
                  autoComplete="username"
                  disabled={busy}
                />
              </Field>
              {confirmation && (
                <div className="info" role="status">
                  {confirmation}
                </div>
              )}
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="button primary full"
                type="submit"
                disabled={busy}
                aria-busy={busy}
              >
                {busy ? 'Sending reset link…' : 'Send reset link'}
                <ArrowRight size={17} />
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  setMode('sign-in');
                  setError('');
                }}
              >
                Back to sign in
              </button>
            </form>
          )}
          {isLocalDemo && mode === 'sign-in' && (
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
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      updateEmail(`${id}@demo.theatre.local`);
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
