import { readFile, readdir } from 'node:fs/promises';

const config = JSON.parse(await readFile('config/review.json', 'utf8'));
const marker = JSON.parse(await readFile('dist-review/review-build.json', 'utf8'));
if (marker.mode !== 'review' || marker.projectId !== config.projectId)
  throw new Error(
    'Hosting requires a review build for the selected project. Run npm run build:review.',
  );
if (process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== config.projectId)
  throw new Error('Deployment target does not match the review build.');
const files = (await readdir('dist-review/assets')).filter((name) => name.endsWith('.js'));
const code = (
  await Promise.all(files.map((name) => readFile(`dist-review/assets/${name}`, 'utf8')))
).join('\n');
if (!code.includes(config.projectId) || !code.includes(marker.apiOrigin))
  throw new Error('The review bundle does not include the expected project and API origin.');
for (const forbidden of [
  'TheatreDemo!26',
  'leo@demo.theatre.local',
  'http://127.0.0.1:8787',
  'http://127.0.0.1:9099',
])
  if (code.includes(forbidden))
    throw new Error('The review bundle contains local demo configuration.');
if (process.argv.includes('--check-api')) {
  const response = await fetch(`${marker.apiOrigin}/health`, {
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('The review API is not healthy; Hosting deployment stopped.');
  const health = await response.json();
  if (health.mode !== 'review' || health.projectId !== config.projectId)
    throw new Error('The API is not running in review mode for this Firebase project.');
  if (!health.capabilities?.includes('admin-v1'))
    throw new Error('Deploy the Admin-capable API before publishing this frontend.');
}
console.log(`Verified review build for ${marker.projectId}.`);
