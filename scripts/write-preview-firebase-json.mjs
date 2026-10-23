import { readFileSync, writeFileSync } from 'node:fs';

// The Hosting action reads firebase.json and would otherwise see the emulator
// config. This replaces that file in the CI workspace only. It copies the review
// Hosting site and leaves Auth and Firestore out, so a preview deploy cannot
// publish rules or Auth settings.
if (process.argv[2] !== '--overwrite-firebase-json') {
  console.error(
    'Refusing to replace firebase.json. Pass --overwrite-firebase-json. The preview workflow is the only caller.',
  );
  process.exit(1);
}

const review = JSON.parse(readFileSync('firebase.review.json', 'utf8'));
if (
  !review.hosting ||
  review.hosting.site !== 'theatre-tracker-2f2e5' ||
  review.hosting.public !== 'dist-review'
)
  throw new Error('firebase.review.json is not the theatre-tracker-2f2e5 dist-review site.');

const firebaseConfig = { hosting: review.hosting };
if ('firestore' in firebaseConfig || 'auth' in firebaseConfig)
  throw new Error('Preview config must not include Firestore or Auth.');

writeFileSync('firebase.json', `${JSON.stringify(firebaseConfig, null, 2)}\n`);
console.log(
  'Wrote hosting-only firebase.json from firebase.review.json. Auth and Firestore were omitted.',
);
