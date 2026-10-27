import { readFileSync, writeFileSync } from 'node:fs';
import { loadProdTarget, hostingOnlyProdConfig } from './prod-target.ts';

// The Hosting action reads firebase.json. This replaces that file in the CI
// workspace only, copying production Hosting and leaving Auth and Firestore out.
if (
  !process.argv.includes('--overwrite-firebase-json') ||
  !process.argv.includes('--confirm-prod')
) {
  console.error(
    'Refusing to replace firebase.json. Pass --overwrite-firebase-json --confirm-prod. The production workflow is the only caller.',
  );
  process.exit(1);
}

const target = loadProdTarget();
if (target.placeholder)
  throw new Error(
    'Refusing to write a production firebase.json while the project id is still a placeholder.',
  );
const firebaseProd = JSON.parse(readFileSync('firebase.prod.json', 'utf8'));
const firebaseConfig = hostingOnlyProdConfig(firebaseProd, target.projectId);
writeFileSync('firebase.json', `${JSON.stringify(firebaseConfig, null, 2)}\n`);
console.log(
  'Wrote hosting-only firebase.json from firebase.prod.json. Auth and Firestore were omitted.',
);
