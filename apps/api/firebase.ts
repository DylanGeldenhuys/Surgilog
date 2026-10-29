import { readFileSync } from 'node:fs';
import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  assertFictionalDataScriptAllowed,
  isGuardedDataScript,
} from '../../shared/deploy-target.ts';
import { serverConfig } from '../../shared/runtime-config.ts';

if (isGuardedDataScript(process.argv)) {
  let prodProjectId = '';
  try {
    const parsed = JSON.parse(readFileSync('config/prod.json', 'utf8')) as { projectId?: unknown };
    if (typeof parsed.projectId === 'string') prodProjectId = parsed.projectId;
  } catch {
    prodProjectId = '';
  }
  assertFictionalDataScriptAllowed(process.argv, process.env, prodProjectId);
}
export const runtime = serverConfig(process.env);
if (runtime.local) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
}
export const projectId = runtime.projectId;
const app =
  getApps()[0] ??
  initializeApp({
    projectId,
    ...(runtime.local ? {} : { credential: applicationDefault() }),
  });
export const db = getFirestore(app);
export const auth = getAuth(app);
