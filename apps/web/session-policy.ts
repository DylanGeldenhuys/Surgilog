export const SESSION_IDLE_MS = 3 * 24 * 60 * 60 * 1000;

export function sessionExpired(lastActivity: number, now = Date.now()) {
  return (
    !Number.isFinite(lastActivity) ||
    lastActivity <= 0 ||
    lastActivity > now + 60_000 ||
    now - lastActivity >= SESSION_IDLE_MS
  );
}

export type SessionEnd = 'logout' | 'expired' | 'access';
