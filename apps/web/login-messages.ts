// Friendly sign-in and password-reset copy. Unknown accounts use the same
// reset confirmation as known accounts, so the screen does not reveal who is registered.

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const loginCopy = {
  wrongPassword: 'The email or password is incorrect.',
  tooMany: 'Too many attempts. Wait a few minutes, then try again.',
  network: 'The connection failed. Check your network and try again.',
  invalidEmail: 'Enter a valid email address.',
  disabled: 'This account is disabled. Ask a hospital administrator to restore access.',
  missingEmail: 'Enter your staff email.',
  missingPassword: 'Enter your password.',
  signInFailed: 'Sign-in could not be completed. Try again.',
  resetFailed: 'The reset link could not be sent. Try again.',
} as const;

export function passwordResetSentMessage(email: string) {
  return `If an account exists for ${email}, we've sent a password reset link. Check your inbox and spam.`;
}

export function signInFieldError(email: string, password: string) {
  const address = email.trim();
  if (!address) return loginCopy.missingEmail;
  if (!emailPattern.test(address)) return loginCopy.invalidEmail;
  if (!password) return loginCopy.missingPassword;
  return '';
}

export function resetFieldError(email: string) {
  const address = email.trim();
  if (!address) return loginCopy.missingEmail;
  if (!emailPattern.test(address)) return loginCopy.invalidEmail;
  return '';
}

function codeOf(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function signInErrorMessage(error: unknown) {
  const code = codeOf(error);
  if (
    code === 'auth/wrong-password' ||
    code === 'auth/invalid-credential' ||
    code === 'auth/invalid-login-credentials' ||
    code === 'auth/user-not-found'
  )
    return loginCopy.wrongPassword;
  if (code === 'auth/too-many-requests') return loginCopy.tooMany;
  if (code === 'auth/network-request-failed' || code === 'auth/timeout') return loginCopy.network;
  if (code === 'auth/invalid-email' || code === 'auth/missing-email') return loginCopy.invalidEmail;
  if (code === 'auth/user-disabled') return loginCopy.disabled;
  if (error instanceof Error && error.message.trim()) {
    if (error.message.includes('Firebase:') || /\bauth\//.test(error.message))
      return loginCopy.signInFailed;
    return error.message;
  }
  return loginCopy.signInFailed;
}

export type PasswordResetOutcome =
  { status: 'sent'; message: string } | { status: 'error'; message: string };

export function passwordResetOutcome(error: unknown, email: string): PasswordResetOutcome {
  const code = codeOf(error);
  // Email enumeration protection is not guaranteed. An unknown or disabled
  // address must look the same as a message that was sent.
  if (code === 'auth/user-not-found' || code === 'auth/user-disabled')
    return { status: 'sent', message: passwordResetSentMessage(email) };
  if (code === 'auth/invalid-email' || code === 'auth/missing-email')
    return { status: 'error', message: loginCopy.invalidEmail };
  if (code === 'auth/too-many-requests') return { status: 'error', message: loginCopy.tooMany };
  if (code === 'auth/network-request-failed' || code === 'auth/timeout')
    return { status: 'error', message: loginCopy.network };
  return { status: 'error', message: loginCopy.resetFailed };
}
