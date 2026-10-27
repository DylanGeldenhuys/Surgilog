import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { reviewAdmin } from './review-admin.ts';
import type { Profile } from '../shared/domain.ts';
import { assertFictionalDataScriptAllowed } from '../shared/deploy-target.ts';
import { syntheticDocuments, syntheticHospitals } from './synthetic-fixtures.ts';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    account: { type: 'string' },
    'seed-fictional': { type: 'boolean' },
    reviewer: { type: 'string' },
    name: { type: 'string' },
    'super-user': { type: 'boolean' },
  },
});
const config = JSON.parse(await readFile('config/review.json', 'utf8'));
const prod = JSON.parse(await readFile('config/prod.json', 'utf8'));
assertFictionalDataScriptAllowed(process.argv, process.env);
if (process.env.APP_ENV === 'prod' || values.project === prod.projectId)
  throw new Error('Fictional review seeding and reviewer setup are disabled for production.');
if (config.projectId !== 'theatre-tracker-2f2e5' || values.project !== config.projectId)
  throw new Error('Review setup requires --project theatre-tracker-2f2e5.');
if (!values.account || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.account))
  throw new Error('Specify --account with the Google account authorised for this project.');
if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error('Review setup refuses emulator endpoints. Use npm run seed for local data.');
if (Boolean(values['seed-fictional']) === Boolean(values.reviewer))
  throw new Error('Choose either --seed-fictional or --reviewer EMAIL --name NAME.');
if (values['super-user'] && !values.reviewer)
  throw new Error('Super User setup requires an explicit reviewer email.');
if (
  values.reviewer &&
  (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.reviewer) || !values.name?.trim())
)
  throw new Error('Reviewer setup requires a valid email and --name.');

const admin = reviewAdmin(config.projectId, values.account);
const { db, auth } = admin;
try {
  const marker = db.doc('meta/reviewSetup');
  if (values['seed-fictional']) {
    const previous = await marker.get();
    if (previous.exists) {
      if (previous.get('status') === 'ready' && previous.get('projectId') === config.projectId) {
        console.log('Review fixtures already installed; preserving all reviewer changes.');
      } else {
        throw new Error(
          'Review setup was interrupted or is unrecognised. Inspect it before proceeding.',
        );
      }
    } else {
      if ((await db.listCollections()).length)
        throw new Error(
          'Initial fictional-data setup requires an empty database; nothing was changed.',
        );
      const now = new Date();
      const documents = syntheticDocuments(now);
      // create() also prevents two setup processes from both claiming the database.
      await marker.create({
        status: 'seeding',
        synthetic: true,
        projectId: config.projectId,
        startedAt: now.toISOString(),
      });
      for (let offset = 0; offset < documents.length; offset += 400) {
        const batch = db.batch();
        for (const document of documents.slice(offset, offset + 400))
          batch.create(db.doc(document.path), document.data);
        await batch.commit();
      }
      await marker.update({ status: 'ready', completedAt: new Date().toISOString() });
      console.log(
        `Installed ${documents.length} fictional documents; no login accounts were created.`,
      );
    }
  } else {
    if ((await marker.get()).get('status') !== 'ready')
      throw new Error('Install the fictional review dataset before granting reviewer access.');
    const user = await auth.getUserByEmail(values.reviewer!);
    if (user.disabled) throw new Error('The selected Firebase Authentication account is disabled.');
    const profile: Profile = {
      uid: user.uid,
      name: values.name!.trim(),
      email: user.email!,
      active: true,
      superUser: !!values['super-user'],
      version: 1,
      memberships: values['super-user']
        ? []
        : syntheticHospitals.map((hospital) => ({
            hospitalId: hospital.id,
            role: 'clinician',
            departments: hospital.departments.map((department) => department.id),
          })),
    };
    // Existing profiles require deliberate inspection, never an automatic permission overwrite.
    await db.doc(`profiles/${user.uid}`).create(profile);
    console.log(
      values['super-user']
        ? 'Super User profile created. Every hospital and department is in scope.'
        : 'Reviewer profile created with Doctor access to the two fictional hospital workspaces.',
    );
  }
} catch (error) {
  // Admin SDK errors can embed request headers and credentials in their causes.
  console.error('Review setup failed.', { code: (error as { code?: string }).code ?? 'unknown' });
  process.exitCode = 1;
} finally {
  await admin.close();
}
