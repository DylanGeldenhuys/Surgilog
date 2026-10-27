export const LOCAL_PROJECT_ID = 'demo-theatre-tracker';
export const DEV_PROJECT_ID = 'theatre-tracker-2f2e5';
export const DEV_API_ORIGIN = 'https://theatre-tracker-api-54783611706.africa-south1.run.app';

const PROJECT_ID = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const FICTIONAL_DATA_SCRIPT =
  /(?:^|\/)(?:seed|setup-review|backfill-seed-history|migrate-[\w.-]+|review-admin)\.[cm]?[jt]s$/;

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

/**
 * Seed, review setup, and local migrations must not run when the process is
 * marked as production. The API server does not match this script pattern.
 */
export function assertFictionalDataScriptAllowed(
  argv: readonly string[],
  env: Record<string, string | undefined>,
) {
  const fictional = argv.some((arg) => FICTIONAL_DATA_SCRIPT.test(arg.replaceAll('\\', '/')));
  if (!fictional) return;
  if (env.APP_ENV === 'prod')
    throw new Error('Fictional seeding and demo migrations are disabled in prod mode.');
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
