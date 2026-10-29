export const LOCAL_PROJECT_ID = 'demo-theatre-tracker';
export const DEV_PROJECT_ID = 'theatre-tracker-2f2e5';
export const DEV_API_ORIGIN = 'https://theatre-tracker-api-54783611706.africa-south1.run.app';

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
/** Fictional review data only. Real production migrations are a separate pattern. */
const FICTIONAL_DATA_SCRIPT =
  /(?:^|\/)(?:seed|setup-review|backfill-seed-history|review-admin|synthetic-fixtures)\.[cm]?[jt]s$/;
const MIGRATION_SCRIPT = /(?:^|\/)migrate-[\w.-]+\.[cm]?[jt]s$/;

export function productionHostingOrigins(projectId: string) {
  if (!PROJECT_ID.test(projectId) || projectId.startsWith('demo-'))
    throw new Error('Production requires an explicit real Firebase project id.');
  return [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`] as const;
}

export function sameOrigins(actual: readonly string[], expected: readonly string[]) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  return left.length === right.length && left.every((origin, index) => origin === right[index]);
}

export function assertCloudRunOrigin(value: string) {
  const api = new URL(value);
  if (
    api.protocol !== 'https:' ||
    !api.hostname.endsWith('.run.app') ||
    api.pathname !== '/' ||
    api.username ||
    api.password ||
    api.search ||
    api.hash
  )
    throw new Error('Supply the Cloud Run HTTPS origin.');
  if (api.origin === DEV_API_ORIGIN)
    throw new Error('Refusing to point a production build at the dev API.');
  return api.origin;
}

function scriptPath(arg: string) {
  return arg.replaceAll('\\', '/');
}

export function isFictionalDataScript(argv: readonly string[]) {
  return argv.some((arg) => FICTIONAL_DATA_SCRIPT.test(scriptPath(arg)));
}

export function isMigrationScript(argv: readonly string[]) {
  return argv.some((arg) => MIGRATION_SCRIPT.test(scriptPath(arg)));
}

export function isGuardedDataScript(argv: readonly string[]) {
  return isFictionalDataScript(argv) || isMigrationScript(argv);
}

/**
 * Prod mode is any one of these, not only APP_ENV=prod:
 * the env mode, a project id signal equal to the configured production project,
 * or an explicit --project argument for that project.
 */
export function isProdContext(
  env: Record<string, string | undefined>,
  prodProjectId: string,
  argv: readonly string[] = [],
) {
  if (!prodProjectId) return false;
  if (env.APP_ENV === 'prod') return true;
  const signals = [
    env.FIREBASE_PROJECT_ID,
    env.GCLOUD_PROJECT,
    env.GOOGLE_CLOUD_PROJECT,
    env.PROJECT_ID,
    env.FIREBASE_PROJECT,
  ];
  if (signals.some((project) => project === prodProjectId)) return true;
  return argv.some((arg, index) => {
    if (arg === '--project' || arg === '--projectId') return argv[index + 1] === prodProjectId;
    return arg === `--project=${prodProjectId}`;
  });
}

function prodConfirmed(env: Record<string, string | undefined>, argv: readonly string[]) {
  return env.CONFIRM_PROD === 'yes' || argv.includes('--confirm-prod');
}

/**
 * Seed and review-setup scripts are refused for a production process and whenever
 * FICTIONAL_SEEDING=false. Production data migrations stay allowed when CONFIRM_PROD
 * is set. The API server does not match either script pattern.
 */
export function assertFictionalDataScriptAllowed(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  prodProjectId = '',
) {
  const fictional = isFictionalDataScript(argv);
  const migration = isMigrationScript(argv);
  if (!fictional && !migration) return;
  if (!prodProjectId)
    throw new Error(
      'Refusing the data script because the production project id was not available to check.',
    );
  const prod = isProdContext(env, prodProjectId, argv);
  if (fictional && (prod || env.FICTIONAL_SEEDING === 'false'))
    throw new Error(
      'Fictional seeding and review setup are disabled for production. FICTIONAL_SEEDING=false is a hard stop.',
    );
  if (migration && prod && !prodConfirmed(env, argv))
    throw new Error(
      'Production data migrations require CONFIRM_PROD=yes or --confirm-prod. Fictional seeding stays disabled.',
    );
}

export type DeployTargetInput = {
  buildMode: string;
  buildProjectId: string;
  targetProjectId?: string;
  prodProjectId: string;
  devProjectId: string;
  confirmProd: boolean;
  placeholder: boolean;
  deploying: boolean;
};

export function assertDeployTarget(input: DeployTargetInput) {
  const {
    buildMode,
    buildProjectId,
    targetProjectId,
    prodProjectId,
    devProjectId,
    confirmProd,
    placeholder,
    deploying,
  } = input;
  if (prodProjectId === devProjectId)
    throw new Error('The production project id must be distinct from the dev/review project.');
  if (buildMode === 'prod' && buildProjectId !== prodProjectId)
    throw new Error('Production build is not for the configured production project.');
  if (buildMode === 'review' && buildProjectId !== devProjectId)
    throw new Error('Review build is not for the dev/review project.');
  if (buildMode !== 'prod' && buildMode !== 'review')
    throw new Error('Refusing to deploy a local or demo build.');
  if (deploying && !targetProjectId)
    throw new Error('Refusing to deploy without an explicit project id. Nothing was deployed.');
  if (targetProjectId && buildMode === 'prod' && targetProjectId === devProjectId)
    throw new Error('Refusing to deploy a production build to the dev/review project.');
  if (targetProjectId && buildMode === 'review' && targetProjectId === prodProjectId)
    throw new Error('Refusing to deploy a dev/review build to the production project.');
  if (targetProjectId && targetProjectId !== buildProjectId)
    throw new Error('Deployment target does not match the build.');
  if (deploying && buildMode === 'prod' && !confirmProd)
    throw new Error(
      'Production deploy requires confirmation. Set CONFIRM_PROD=yes or pass --confirm-prod.',
    );
  if (deploying && buildMode === 'prod' && placeholder)
    throw new Error(
      'Production config is still the placeholder project. Replace it and set placeholder to false in config/prod.json. Nothing was deployed.',
    );
}
