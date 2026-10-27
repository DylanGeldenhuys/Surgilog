import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEV_PROJECT_ID,
  LOCAL_PROJECT_ID,
  productionHostingOrigins,
  sameOrigins,
} from '../shared/deploy-target.ts';

export type ProdFirebaseWeb = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
};

export type ProdTarget = {
  placeholder: boolean;
  notice: string;
  projectId: string;
  region: string;
  service: string;
  runtimeServiceAccountId: string;
  buildServiceAccountId: string;
  runtimeServiceAccount: string;
  buildServiceAccount: string;
  apiUrlPlaceholder: string;
  fictionalSeeding: false;
  firebase: ProdFirebaseWeb;
  hostingOrigins: readonly [string, string];
  env: Record<string, string>;
};

const ENV_KEYS = ['APP_ENV', 'FIREBASE_PROJECT_ID', 'ALLOWED_ORIGINS', 'FICTIONAL_SEEDING'];

export function parseFlatYaml(source: string) {
  const entries: Record<string, string> = {};
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) throw new Error('Invalid production env file.');
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    if (!/^[A-Z0-9_]+$/.test(key)) throw new Error(`Unexpected production env key ${key}.`);
    if (/SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL/.test(key))
      throw new Error('Production env file must not contain secrets.');
    entries[key] = value;
  }
  return entries;
}

export function loadProdTarget(root = process.cwd()): ProdTarget {
  const config = JSON.parse(readFileSync(join(root, 'config/prod.json'), 'utf8'));
  const rc = JSON.parse(readFileSync(join(root, '.firebaserc'), 'utf8'));
  const firebaseProd = JSON.parse(readFileSync(join(root, 'firebase.prod.json'), 'utf8'));
  const reviewFirebase = JSON.parse(readFileSync(join(root, 'firebase.review.json'), 'utf8'));
  const env = parseFlatYaml(readFileSync(join(root, 'config/prod-api.yaml'), 'utf8'));
  const projectId = config.projectId as string;
  if (!config.notice || typeof config.notice !== 'string')
    throw new Error('config/prod.json needs a notice describing the production target.');
  if (typeof config.placeholder !== 'boolean')
    throw new Error('config/prod.json placeholder must be true or false.');
  if (config.placeholder && !config.notice.includes('PLACEHOLDER'))
    throw new Error('The placeholder production config must stay clearly marked.');
  if (rc.projects?.default !== LOCAL_PROJECT_ID)
    throw new Error('The default Firebase alias must stay on the local demo project.');
  if (rc.projects?.dev !== DEV_PROJECT_ID || rc.projects?.review !== DEV_PROJECT_ID)
    throw new Error('The dev and review aliases must both be the dev project.');
  if (rc.projects?.prod !== projectId)
    throw new Error('The prod alias in .firebaserc must match config/prod.json.');
  if (projectId === DEV_PROJECT_ID || projectId === LOCAL_PROJECT_ID)
    throw new Error('The production project id must be distinct from dev and local.');
  if (config.region !== 'africa-south1')
    throw new Error('Production Cloud Run and Firestore stay in africa-south1.');
  if (config.fictionalSeeding !== false)
    throw new Error('Fictional seeding must stay off in the production config.');
  const serviceAccountId = /^[a-z][a-z0-9-]{2,28}[a-z0-9]$/;
  for (const name of [config.service, config.runtimeServiceAccountId, config.buildServiceAccountId])
    if (typeof name !== 'string' || !serviceAccountId.test(name))
      throw new Error('Production service and service-account ids are invalid.');
  const firebase = config.firebase as ProdFirebaseWeb;
  if (
    !firebase ||
    firebase.projectId !== projectId ||
    firebase.authDomain !== `${projectId}.firebaseapp.com` ||
    firebase.storageBucket !== `${projectId}.firebasestorage.app` ||
    !firebase.apiKey ||
    !firebase.appId
  )
    throw new Error('Production web config must match the production project id.');
  if (
    config.placeholder &&
    (!firebase.apiKey.startsWith('placeholder') || !firebase.appId.includes('placeholder'))
  )
    throw new Error(
      'A placeholder production config must not contain a real Firebase web API key.',
    );
  if (
    !config.placeholder &&
    (firebase.apiKey.startsWith('placeholder') || firebase.appId.includes('placeholder'))
  )
    throw new Error('Production web config is still a placeholder.');
  const hostingOrigins = productionHostingOrigins(projectId);
  const keys = Object.keys(env);
  if (keys.length !== ENV_KEYS.length || ENV_KEYS.some((key) => !keys.includes(key)))
    throw new Error('config/prod-api.yaml has unexpected or missing environment keys.');
  if (env.APP_ENV !== 'prod' || env.FIREBASE_PROJECT_ID !== projectId)
    throw new Error('Production API env must set APP_ENV=prod for the configured project.');
  if (env.FICTIONAL_SEEDING !== 'false')
    throw new Error('Production API env must set FICTIONAL_SEEDING=false.');
  if (!sameOrigins(env.ALLOWED_ORIGINS.split(','), hostingOrigins))
    throw new Error('Production API CORS must list only the two production Hosting origins.');
  if (JSON.stringify(reviewFirebase.firestore) !== JSON.stringify(firebaseProd.firestore))
    throw new Error('Production Firestore rules and indexes must match the dev configuration.');
  if (JSON.stringify(reviewFirebase.auth) !== JSON.stringify(firebaseProd.auth))
    throw new Error('Production Auth providers must match the dev Email/Password configuration.');
  const hosting = firebaseProd.hosting;
  if (hosting?.site !== projectId || hosting?.public !== 'dist-prod')
    throw new Error('firebase.prod.json is not the production dist-prod site.');
  if (
    !hosting.predeploy?.includes('npx tsx scripts/verify-prod-build.ts --check-api') ||
    !hosting.ignore?.includes('prod-build.json')
  )
    throw new Error('Production Hosting is missing its predeploy guard.');
  return {
    placeholder: config.placeholder,
    notice: config.notice,
    projectId,
    region: config.region,
    service: config.service,
    runtimeServiceAccountId: config.runtimeServiceAccountId,
    buildServiceAccountId: config.buildServiceAccountId,
    runtimeServiceAccount: `${config.runtimeServiceAccountId}@${projectId}.iam.gserviceaccount.com`,
    buildServiceAccount: `projects/${projectId}/serviceAccounts/${config.buildServiceAccountId}@${projectId}.iam.gserviceaccount.com`,
    apiUrlPlaceholder: config.apiUrlPlaceholder,
    fictionalSeeding: false,
    firebase,
    hostingOrigins,
    env,
  };
}

export function hostingOnlyProdConfig(
  firebaseProd: { hosting?: { site?: string; public?: string; predeploy?: string[] } },
  projectId: string,
) {
  const hosting = firebaseProd.hosting;
  if (!hosting || hosting.site !== projectId || hosting.public !== 'dist-prod')
    throw new Error('firebase.prod.json is not the production dist-prod site.');
  if (!hosting.predeploy?.some((command) => command.includes('verify-prod-build')))
    throw new Error('Production Hosting is missing its predeploy guard.');
  const config = { hosting };
  if ('firestore' in config || 'auth' in config)
    throw new Error('Production hosting deploy config must not include Firestore or Auth.');
  return config;
}
