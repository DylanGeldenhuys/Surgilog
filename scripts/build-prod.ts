import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { assertCloudRunOrigin } from '../shared/deploy-target.ts';
import { loadProdTarget } from './prod-target.ts';

const target = loadProdTarget();
const args = process.argv.slice(2);
let apiUrl = target.apiUrlPlaceholder;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === '--confirm-prod') continue;
  if (arg === '--api-url') {
    const value = args[index + 1];
    if (!value || value.startsWith('--'))
      throw new Error(
        'Usage: npm run build:prod -- [--api-url https://SERVICE.africa-south1.run.app]',
      );
    apiUrl = value;
    index += 1;
    continue;
  }
  throw new Error(`Unexpected argument ${arg}.`);
}
const origin = assertCloudRunOrigin(apiUrl);
const placeholder =
  target.placeholder ||
  origin === assertCloudRunOrigin(target.apiUrlPlaceholder) ||
  target.firebase.apiKey.startsWith('placeholder');

function run(command: string, commandArgs: string[]) {
  const result = spawnSync(command, commandArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_APP_ENV: 'prod',
      VITE_API_URL: origin,
      VITE_FIREBASE_CONFIG: JSON.stringify(target.firebase),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

for (const command of [
  ['tsc', '--noEmit'],
  ['vite', 'build', '--mode', 'prod', '--outDir', 'dist-prod'],
])
  run('npx', command);

await writeFile(
  'dist-prod/prod-build.json',
  JSON.stringify({
    mode: 'prod',
    projectId: target.projectId,
    apiOrigin: origin,
    placeholder,
    builtAt: new Date().toISOString(),
  }),
);
const verified = spawnSync('npx', ['tsx', 'scripts/verify-prod-build.ts'], { stdio: 'inherit' });
process.exit(verified.status ?? 1);
