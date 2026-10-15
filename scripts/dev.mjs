import { spawn } from 'node:child_process';
import net from 'node:net';
const children = [];
let stopping = false;
function run(cmd, args) {
  const p = spawn(cmd, args, { stdio: 'inherit' });
  children.push(p);
  p.on('exit', (code) => {
    if (code && !stopping) {
      console.error(`${cmd} exited (${code})`);
      stop(code);
    }
  });
  return p;
}
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const p of children) p.kill('SIGINT');
  setTimeout(() => process.exit(code), 1200).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
const open = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
if (!(await open(8080)) || !(await open(9099))) run('node', ['scripts/emulators.mjs']);
const deadline = Date.now() + 180000;
while (!(await open(8080)) || !(await open(9099))) {
  if (Date.now() > deadline) {
    console.error('Emulators did not start. Check Java 21 and port availability.');
    stop(1);
    break;
  }
  await new Promise((r) => setTimeout(r, 700));
}
if (!stopping) {
  await new Promise((resolve, reject) => {
    const p = run('npx', ['tsx', 'scripts/seed.ts']);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('Seed failed'))));
  });
  await new Promise((resolve, reject) => {
    const p = run('npx', ['tsx', 'scripts/migrate-admin-roles.ts']);
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('Role fixture migration failed'))));
  });
  run('npx', ['tsx', 'watch', 'apps/api/server.ts']);
  run('npx', ['vite', '--host', '127.0.0.1']);
}
