import { describe, expect, it } from 'vitest';
import {
  loginCopy,
  passwordResetOutcome,
  passwordResetSentMessage,
  resetFieldError,
  signInErrorMessage,
  signInFieldError,
} from '../apps/web/login-messages.ts';
import { passwordFieldState } from '../apps/web/ui.tsx';

const address = 'nurse@hospital.example';
const sent = `If an account exists for ${address}, we've sent a password reset link. Check your inbox and spam.`;

describe('password visibility', () => {
  it('switches the field between a hidden password and visible text', () => {
    expect(passwordFieldState(false)).toEqual({ type: 'password', label: 'Show password' });
    expect(passwordFieldState(true)).toEqual({ type: 'text', label: 'Hide password' });
  });
});

describe('sign-in messages', () => {
  it('asks for an email and password before contacting Auth', () => {
    expect(signInFieldError('  ', 'secret')).toBe(loginCopy.missingEmail);
    expect(signInFieldError('not-an-email', 'secret')).toBe(loginCopy.invalidEmail);
    expect(signInFieldError('nurse@hospital.example', '')).toBe(loginCopy.missingPassword);
    expect(signInFieldError('  nurse@hospital.example  ', 'secret')).toBe('');
  });

  it('uses one message for a wrong password and an unknown account', () => {
    for (const code of [
      'auth/wrong-password',
      'auth/invalid-credential',
      'auth/invalid-login-credentials',
      'auth/user-not-found',
    ])
      expect(signInErrorMessage({ code })).toBe(loginCopy.wrongPassword);
  });

  it('names too many attempts, a network failure, an invalid email and a disabled account', () => {
    expect(signInErrorMessage({ code: 'auth/too-many-requests' })).toBe(loginCopy.tooMany);
    expect(signInErrorMessage({ code: 'auth/network-request-failed' })).toBe(loginCopy.network);
    expect(signInErrorMessage({ code: 'auth/timeout' })).toBe(loginCopy.network);
    expect(signInErrorMessage({ code: 'auth/invalid-email' })).toBe(loginCopy.invalidEmail);
    expect(signInErrorMessage({ code: 'auth/user-disabled' })).toBe(loginCopy.disabled);
  });

  it('keeps an existing app message and replaces a raw Auth message', () => {
    expect(
      signInErrorMessage(new Error('No offline workspace on this device. Sign in online first.')),
    ).toBe('No offline workspace on this device. Sign in online first.');
    expect(signInErrorMessage(new Error('Firebase: Error (auth/internal-error).'))).toBe(
      loginCopy.signInFailed,
    );
    expect(signInErrorMessage(null)).toBe(loginCopy.signInFailed);
    expect(signInErrorMessage(new Error('   '))).toBe(loginCopy.signInFailed);
  });
});

describe('password reset messages', () => {
  it('uses the same confirmation for a sent link, an unknown account and a disabled account', () => {
    expect(passwordResetSentMessage(address)).toBe(sent);
    for (const code of ['auth/user-not-found', 'auth/user-disabled'])
      expect(passwordResetOutcome({ code }, address)).toEqual({
        status: 'sent',
        message: sent,
      });
  });

  it('shows a visible error instead of the confirmation when the request fails', () => {
    expect(passwordResetOutcome({ code: 'auth/invalid-email' }, address)).toEqual({
      status: 'error',
      message: loginCopy.invalidEmail,
    });
    expect(passwordResetOutcome({ code: 'auth/too-many-requests' }, address)).toEqual({
      status: 'error',
      message: loginCopy.tooMany,
    });
    expect(passwordResetOutcome({ code: 'auth/network-request-failed' }, address)).toEqual({
      status: 'error',
      message: loginCopy.network,
    });
    const unknown = passwordResetOutcome(
      new Error('Firebase: Error (auth/internal-error).'),
      address,
    );
    expect(unknown.status).toBe('error');
    expect(unknown.message).toBe(loginCopy.resetFailed);
    expect(unknown.message).not.toContain(address);
    expect(unknown.message).not.toContain('auth/');
  });

  it('checks the address before sending', () => {
    expect(resetFieldError('')).toBe(loginCopy.missingEmail);
    expect(resetFieldError('nurse@')).toBe(loginCopy.invalidEmail);
    expect(resetFieldError(`  ${address}  `)).toBe('');
  });
});
