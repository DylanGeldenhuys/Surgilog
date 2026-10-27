import type { FirebaseOptions } from 'firebase/app';
import { httpsOrigin } from '../../shared/https-origin.ts';

const mode = import.meta.env.VITE_APP_ENV ?? 'local';
if (mode !== 'local' && mode !== 'review' && mode !== 'prod')
  throw new Error('Invalid application environment.');
export const isLocalDemo = mode === 'local';
export const isProduction = mode === 'prod';
export const firebaseConfig: FirebaseOptions = isLocalDemo
  ? {
      apiKey: 'demo-theatre-tracker',
      authDomain: 'demo-theatre-tracker.firebaseapp.com',
      projectId: 'demo-theatre-tracker',
    }
  : JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG ?? '{}');
if (
  !isLocalDemo &&
  (!firebaseConfig.apiKey ||
    !firebaseConfig.appId ||
    !firebaseConfig.authDomain ||
    !firebaseConfig.projectId ||
    firebaseConfig.projectId.startsWith('demo-'))
)
  throw new Error('The hosted build is missing its Firebase web configuration.');
export const apiOrigin = isLocalDemo
  ? 'http://127.0.0.1:8787'
  : httpsOrigin(import.meta.env.VITE_API_URL, 'VITE_API_URL');
