type Environment = Record<string, string | undefined>;

/**
 * Firebase Hosting preview channels for the fictional-data review site only.
 * A channel URL looks like https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app.
 * The label before `.web.app` is at most 63 characters: the 21-character site id,
 * `--`, and at most 40 characters of channel id and hash.
 */
const REVIEW_PREVIEW_CHANNEL_ORIGIN =
  /^https:\/\/theatre-tracker-2f2e5--[a-z0-9](?:[a-z0-9_-]{0,38}[a-z0-9])?\.(?:web\.app|firebaseapp\.com)$/;

export function isReviewPreviewChannelOrigin(origin: string) {
  return REVIEW_PREVIEW_CHANNEL_ORIGIN.test(origin);
}

export function httpsOrigin(value: string | undefined, name: string) {
  if (!value) throw new Error(`${name} is required.`);
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]'
  )
    throw new Error(`${name} must be a public HTTPS origin.`);
  return url.origin;
}

export function serverConfig(env: Environment) {
  const mode = env.APP_ENV ?? 'local';
  if (mode !== 'local' && mode !== 'review') throw new Error('APP_ENV must be local or review.');
  const local = mode === 'local';
  if (local && (env.NODE_ENV === 'production' || env.K_SERVICE))
    throw new Error('Cloud startup requires explicit APP_ENV=review configuration.');
  if (!local && (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST))
    throw new Error('Cloud startup refuses Firebase emulator endpoints.');
  const projectId = local ? 'demo-theatre-tracker' : env.FIREBASE_PROJECT_ID;
  if (
    !projectId ||
    (!local && (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) || projectId.startsWith('demo-')))
  )
    throw new Error('Cloud startup requires an explicit real FIREBASE_PROJECT_ID.');
  const origins: Array<string | RegExp> = local
    ? [
        'http://127.0.0.1:5173',
        'http://localhost:5173',
        'http://127.0.0.1:4173',
        'http://localhost:4173',
      ]
    : (env.ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => httpsOrigin(origin.trim(), 'ALLOWED_ORIGINS'));
  // Preview hosts are created per pull request and cannot be listed in advance.
  // Only this review project's Hosting channels match; other projects stay on
  // the explicit ALLOWED_ORIGINS list. The live site is not covered by the pattern.
  if (!local && projectId === 'theatre-tracker-2f2e5') origins.push(REVIEW_PREVIEW_CHANNEL_ORIGIN);
  const port = Number(env.PORT ?? (local ? 8787 : 8080));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
  return { mode, local, projectId, origins, port, host: local ? '127.0.0.1' : '0.0.0.0' };
}
