import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
const javaHome =
  process.env.JAVA_HOME ||
  [
    '/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
    '/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home',
  ].find(existsSync);
const env = {
  ...process.env,
  ...(javaHome ? { JAVA_HOME: javaHome, PATH: `${javaHome}/bin:${process.env.PATH}` } : {}),
};
const args = [
  '-y',
  'firebase-tools@15.32.1',
  'emulators:start',
  '--project',
  'demo-theatre-tracker',
  '--only',
  'auth,firestore',
  '--export-on-exit=.emulator-data',
];
if (existsSync('.emulator-data/firebase-export-metadata.json'))
  args.push('--import=.emulator-data');
const child = spawn('npx', args, { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code) => process.exit(code ?? 0));
