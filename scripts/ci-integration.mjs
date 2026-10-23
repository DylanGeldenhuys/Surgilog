import { spawn, spawnSync } from 'node:child_process';

// Firebase emulators:exec sets this from firebase.json before running the script.
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080') {
  console.error(
    'FIRESTORE_EMULATOR_HOST must be 127.0.0.1:8080. Run this through firebase emulators:exec --project demo-theatre-tracker.',
  );
  process.exit(1);
}

// A fresh API per suite isolates its in-memory rate-limit budget. Keep the real
// request limit enabled so each suite still exercises the production behaviour.
let api;
async function stopApi() {
  if (!api || api.exitCode !== null || api.signalCode !== null) return;
  const exited = new Promise((resolve) => api.once('exit', resolve));
  api.kill('SIGTERM');
  const timeout = setTimeout(() => api.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (api.exitCode !== null || api.signalCode !== null)
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
  status = 0;
  for (const script of ['test:integration', 'test:admin', 'test:theatre']) {
    // Launch Node directly so stopping it cannot leave an npx child on the port.
    api = spawn(process.execPath, ['--import', 'tsx', 'apps/api/server.ts'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: process.env,
    });
    await waitForHealth();
    const result = spawnSync('npm', ['run', script], { stdio: 'inherit' });
    await stopApi();
    if ((result.status ?? 1) !== 0) {
      status = result.status ?? 1;
      break;
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  status = 1;
} finally {
  await stopApi();
}
process.exit(status);
