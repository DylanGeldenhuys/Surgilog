import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { Firestore } from 'firebase-admin/firestore';
import { OAuth2Client } from 'google-auth-library';

// Local deployment tooling only. Cloud Run uses its own application-default identity.
export function reviewAdmin(projectId: string, account: string) {
  if (projectId !== 'theatre-tracker-2f2e5') throw new Error('Unexpected review project.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account)) throw new Error('A Google account is required.');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('Review administration refuses emulator endpoints.');
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT = projectId;
  const run = promisify(execFile);
  const authClient = new OAuth2Client({
    quotaProjectId: projectId,
    eagerRefreshThresholdMillis: 30000,
  });
  authClient.refreshHandler = async () => {
    try {
      const { stdout } = await run(
        'gcloud',
        ['auth', 'print-access-token', account, `--project=${projectId}`, '--quiet'],
        { timeout: 30000, maxBuffer: 65536 },
      );
      const token = stdout.trim();
      if (!token || /\s/.test(token)) throw new Error('Unexpected token output.');
      return { access_token: token, expiry_date: Date.now() + 300000 };
    } catch {
      throw new Error(
        'Google Cloud sign-in failed. Sign in again with the selected project account.',
      );
    }
  };
  const app = initializeApp(
    {
      projectId,
      credential: {
        async getAccessToken() {
          const { token } = await authClient.getAccessToken();
          if (!token) throw new Error('Google Cloud did not return a token.');
          return { access_token: token, expires_in: 60 };
        },
      },
    },
    `review-admin-${crypto.randomUUID()}`,
  );
  // The Admin Firestore factory accepts only certificate/ADC credentials. Its
  // exported server client supports the explicit Google Auth client instead.
  const db = new Firestore({ projectId, authClient });
  return {
    db,
    auth: getAuth(app),
    async close() {
      await db.terminate();
      await deleteApp(app);
    },
  };
}
