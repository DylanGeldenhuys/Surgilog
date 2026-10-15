import { expect, it } from 'vitest';
import { authFailureStatus } from '../apps/api/auth-errors.ts';

it('treats invalid/revoked/disabled identities as authentication failures', () => {
  for (const code of [
    'auth/argument-error',
    'auth/invalid-id-token',
    'auth/id-token-expired',
    'auth/id-token-revoked',
    'auth/user-disabled',
    'auth/user-not-found',
  ])
    expect(authFailureStatus({ code })).toBe(401);
});
it('treats provider/network failures as unavailability, not account revocation', () => {
  for (const error of [
    { code: 'auth/internal-error' },
    { code: 'app/network-error' },
    new Error('timeout'),
    null,
  ])
    expect(authFailureStatus(error)).toBe(503);
});
