// A failed identity-provider request is not proof that a signed-in user lost access.
// Still deny this API request, but allow the client to retain its prepared workspace.
export function authFailureStatus(error: unknown): 401 | 503 {
  const code = (error as { code?: string } | null)?.code;
  return code &&
    [
      'auth/argument-error',
      'auth/invalid-id-token',
      'auth/id-token-expired',
      'auth/id-token-revoked',
      'auth/user-disabled',
      'auth/user-not-found',
    ].includes(code)
    ? 401
    : 503;
}
