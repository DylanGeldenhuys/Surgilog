import { describe, expect, it } from 'vitest';
import { shouldHoldForRetry } from '../apps/web/sync-policy.ts';

describe('online-first save fallback', () => {
  it('holds only connection and temporary server failures for retry', () => {
    expect(shouldHoldForRetry(0)).toBe(true);
    expect(shouldHoldForRetry(undefined)).toBe(true);
    expect(shouldHoldForRetry(429)).toBe(true);
    expect(shouldHoldForRetry(503)).toBe(true);
    expect(shouldHoldForRetry(400)).toBe(false);
    expect(shouldHoldForRetry(403)).toBe(false);
    expect(shouldHoldForRetry(409)).toBe(false);
    expect(shouldHoldForRetry(422)).toBe(false);
  });
});
