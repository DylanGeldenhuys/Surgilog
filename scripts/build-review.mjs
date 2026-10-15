import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(await readFile('config/review.json', 'utf8'));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--api-url')
  throw new Error('Usage: npm run build:review -- --api-url https://YOUR-SERVICE.run.app');
const api = new URL(args[1]);
if (
  api.protocol !== 'https:' ||
  !api.hostname.endsWith('.run.app') ||
  api.pathname !== '/' ||
  api.username ||
  api.password ||
  api.search ||
  api.hash
)
  throw new Error('Supply the deployed Cloud Run HTTPS origin.');
if (config.projectId !== 'theatre-tracker-2f2e5' || config.firebase.projectId !== config.projectId)
  throw new Error('Review project configuration does not match the selected project.');
for (const command of [
  ['tsc', '--noEmit'],
  ['vite', 'build', '--mode', 'review', '--outDir', 'dist-review'],
]) {
  const result = spawnSync('npx', command, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_APP_ENV: 'review',
      VITE_API_URL: api.origin,
      VITE_FIREBASE_CONFIG: JSON.stringify(config.firebase),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await writeFile(
  'dist-review/review-build.json',
  JSON.stringify({
    mode: 'review',
    projectId: config.projectId,
    apiOrigin: api.origin,
    builtAt: new Date().toISOString(),
  }),
);
const verified = spawnSync('node', ['scripts/verify-review-build.mjs'], { stdio: 'inherit' });
process.exit(verified.status ?? 1);
