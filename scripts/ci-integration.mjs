import { spawn, spawnSync } from 'node:child_process';

// Firebase emulators:exec sets this from firebase.json before running the script.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  console.error(
    'FIRESTORE_EMULATOR_HOST must be 127.0.0.1:8080. Run this through firebase emulators:exec --project demo-theatre-tracker.',
  );
  process.exit(1);
}

const api = spawn('npx', ['tsx', 'apps/api/server.ts'], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: process.env,
});

function stopApi() {
  if (api.exitCode === null && api.signalCode === null) api.kill('SIGTERM');
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null)
      throw new Error(`API exited (${api.exitCode}) before /health responded.`);
    try {
      const response = await fetch('http://127.0.0.1:8787/health');
      if (response.ok) return;
    } catch {
      // The API process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Timed out waiting for http://127.0.0.1:8787/health.');
}

let status = 1;
try {
  await waitForHealth();
  status = 0;
  for (const script of ['test:integration', 'test:admin', 'test:theatre']) {
    const result = spawnSync('npm', ['run', script], { stdio: 'inherit' });
    if ((result.status ?? 1) !== 0) {
      status = result.status ?? 1;
      break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  status = 1;
} finally {
  stopApi();
  await new Promise((resolve) => {
    if (api.exitCode !== null || api.signalCode !== null) resolve();
    else {
      api.once('exit', () => resolve());
      setTimeout(resolve, 5000);
    }
  });
}
process.exit(status);
