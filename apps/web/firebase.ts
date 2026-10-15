import { initializeApp } from 'firebase/app';
import {
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from 'firebase/auth';
import { isLocalDemo, firebaseConfig, apiOrigin } from './config.ts';
import { RequestError, readApiResponse } from './http.ts';
export { RequestError } from './http.ts';
const app = initializeApp(firebaseConfig);
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence],
});
if (isLocalDemo) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
let workspaceGuard: (() => void) | undefined;
export function setWorkspaceGuard(guard?: () => void) {
  workspaceGuard = guard;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  workspaceGuard?.();
  await auth.authStateReady();
  let token: string | undefined;
  try {
    token = await auth.currentUser?.getIdToken();
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/network-request-failed')
      throw new RequestError(0, 'Connection unavailable. Reconnect and try again.');
    throw new RequestError(401, 'Sign in again to continue.');
  }
  workspaceGuard?.();
  if (!token)
    throw new RequestError(
      401,
      'Sign in online to synchronise. Your saved work remains on this device.',
    );
  let res: Response;
  try {
    res = await fetch(`${apiOrigin}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new RequestError(0, 'Connection unavailable. Reconnect and try again.');
  }
  return readApiResponse<T>(res);
}
