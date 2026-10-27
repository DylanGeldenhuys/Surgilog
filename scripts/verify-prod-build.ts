import { readFile, readdir } from 'node:fs/promises';
import { DEV_API_ORIGIN, DEV_PROJECT_ID, assertDeployTarget } from '../shared/deploy-target.ts';
import { loadProdTarget } from './prod-target.ts';

const target = loadProdTarget();
const marker = JSON.parse(await readFile('dist-prod/prod-build.json', 'utf8'));
const review = JSON.parse(await readFile('config/review.json', 'utf8'));
const deploying = process.argv.includes('--check-api') || process.argv.includes('--deploy');
const confirmProd = process.argv.includes('--confirm-prod') || process.env.CONFIRM_PROD === 'yes';
const named = [
  process.env.GCLOUD_PROJECT,
  process.env.PROJECT_ID,
  process.env.FIREBASE_PROJECT,
].filter((project): project is string => Boolean(project));
const targetProjectIds = [...new Set(named)];
if (targetProjectIds.length > 1)
  throw new Error('Deployment environment names more than one project.');
assertDeployTarget({
  buildMode: marker.mode,
  buildProjectId: marker.projectId,
  targetProjectId: targetProjectIds[0],
  prodProjectId: target.projectId,
  devProjectId: DEV_PROJECT_ID,
  confirmProd,
  placeholder: Boolean(target.placeholder || marker.placeholder),
  deploying,
});
if (marker.apiOrigin === DEV_API_ORIGIN)
  throw new Error('Refusing to publish a production web app pointed at the dev API.');

const files = (await readdir('dist-prod/assets')).filter((name) => name.endsWith('.js'));
const code = (
  await Promise.all(files.map((name) => readFile(`dist-prod/assets/${name}`, 'utf8')))
).join('\n');
if (!code.includes(target.projectId) || !code.includes(marker.apiOrigin))
  throw new Error('The production bundle does not include the expected project and API origin.');
if (
  code.includes(DEV_PROJECT_ID) ||
  code.includes(DEV_API_ORIGIN) ||
  code.includes(review.firebase.apiKey)
)
  throw new Error('The production bundle contains dev/review configuration.');
for (const forbidden of [
  'TheatreDemo!26',
  'leo@demo.theatre.local',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:9099',
])
  if (code.includes(forbidden))
    throw new Error('The production bundle contains local demo configuration.');

if (!deploying) {
  console.log(
    marker.placeholder
      ? `Verified placeholder production build for ${marker.projectId}. It cannot be deployed.`
      : `Verified production build for ${marker.projectId}.`,
  );
  process.exit(0);
}
if (marker.placeholder || target.placeholder)
  throw new Error(
    'Refusing to deploy a placeholder production build. Replace the project id and web config, set placeholder to false, and rebuild. Nothing was deployed.',
  );
if (marker.apiOrigin === target.apiUrlPlaceholder)
  throw new Error('Refusing to publish a production web app pointed at the placeholder API.');
const response = await fetch(`${marker.apiOrigin}/health`, { signal: AbortSignal.timeout(12000) });
if (!response.ok) throw new Error('The production API is not healthy; Hosting deployment stopped.');
const health = await response.json();
if (health.mode !== 'prod' || health.projectId !== target.projectId)
  throw new Error('The API is not running in prod mode for this Firebase project.');
if (health.projectId === DEV_PROJECT_ID)
  throw new Error('Refusing to publish production Hosting against the dev API.');
if (
  !health.capabilities?.includes('admin-v1') ||
  !health.capabilities?.includes('theatre-register-v1')
)
  throw new Error(
    'Deploy the API with Admin and theatre-register support before publishing this frontend.',
  );
console.log(`Verified production build for ${marker.projectId}.`);
