import { db, auth, projectId } from '../apps/api/firebase.ts';
import type { Profile } from '../shared/domain.ts';
import { syntheticHospitals as hospitals, syntheticDocuments } from './synthetic-fixtures.ts';
if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw new Error('Seeding is allowed only in local demo emulators.');
if ((await db.doc('meta/seed').get()).exists) {
  console.log('Synthetic data already present; keeping your changes.');
  process.exit(0);
}
const now = new Date();
const accounts = [
  {
    uid: 'leo',
    name: 'Dr Leo Meyer',
    email: 'leo@demo.theatre.local',
    role: 'clinician',
    hospitals: ['groote-schuur', 'tygerberg'],
  },
  {
    uid: 'sister',
    name: 'Sr Nomsa Dlamini',
    email: 'sister@demo.theatre.local',
    role: 'recorder',
    hospitals: ['groote-schuur'],
  },
  {
    uid: 'clerk',
    name: 'Jamie Adams',
    email: 'clerk@demo.theatre.local',
    role: 'recorder',
    hospitals: ['groote-schuur'],
  },
  {
    uid: 'scheduler',
    name: 'Sam Petersen',
    email: 'scheduler@demo.theatre.local',
    role: 'coordinator',
    hospitals: ['groote-schuur'],
  },
  {
    uid: 'reports',
    name: 'Alex Daniels',
    email: 'reports@demo.theatre.local',
    role: 'viewer',
    hospitals: ['groote-schuur'],
  },
  {
    uid: 'doctor2',
    name: 'Dr S. Naidoo',
    email: 'doctor2@demo.theatre.local',
    role: 'clinician',
    hospitals: ['tygerberg'],
  },
] as const;
for (const a of accounts) {
  try {
    await auth.createUser({
      uid: a.uid,
      email: a.email,
      password: 'TheatreDemo!26',
      displayName: a.name,
      emailVerified: true,
    });
  } catch (e) {
    if ((e as any).code !== 'auth/uid-already-exists') throw e;
  }
  const p: Profile = {
    uid: a.uid,
    name: a.name,
    email: a.email,
    active: true,
    memberships: a.hospitals.map((id) => ({
      hospitalId: id,
      role: a.role,
      departments: hospitals.find((h) => h.id === id)!.departments.map((d) => d.id),
    })),
  };
  await db.doc(`profiles/${a.uid}`).set(p);
}
const reportingAccounts = [
  {
    uid: 'global-reports',
    name: 'N. Achebe',
    email: 'global@demo.theatre.local',
    grant: { role: 'global_viewer' as const },
  },
  {
    uid: 'regional-reports',
    name: 'P. Mahlangu',
    email: 'region@demo.theatre.local',
    grant: { role: 'regional_viewer' as const, region: 'Africa' },
  },
  {
    uid: 'country-reports',
    name: 'R. Naidoo',
    email: 'country@demo.theatre.local',
    grant: { role: 'country_viewer' as const, region: 'Africa', country: 'South Africa' },
  },
  {
    uid: 'province-reports',
    name: 'T. Coetzee',
    email: 'province@demo.theatre.local',
    grant: {
      role: 'state_viewer' as const,
      region: 'Africa',
      country: 'South Africa',
      province: 'Western Cape',
    },
  },
  {
    uid: 'district-reports',
    name: 'M. van der Merwe',
    email: 'district@demo.theatre.local',
    grant: {
      role: 'district_viewer' as const,
      region: 'Africa',
      country: 'South Africa',
      province: 'Western Cape',
      district: 'City of Cape Town',
    },
  },
];
for (const account of reportingAccounts) {
  try {
    await auth.createUser({
      uid: account.uid,
      email: account.email,
      password: 'TheatreDemo!26',
      displayName: account.name,
      emailVerified: true,
    });
  } catch (e) {
    if ((e as any).code !== 'auth/uid-already-exists') throw e;
  }
  const profile: Profile = {
    uid: account.uid,
    name: account.name,
    email: account.email,
    active: true,
    memberships: [],
    reportingGrants: [account.grant],
  };
  await db.doc(`profiles/${account.uid}`).set(profile);
}
const documents = syntheticDocuments(now);
for (let start = 0; start < documents.length; start += 400) {
  const batch = db.batch();
  for (const record of documents.slice(start, start + 400))
    batch.set(db.doc(record.path), record.data);
  await batch.commit();
}
await db.doc('meta/seed').set({
  at: now.toISOString(),
  synthetic: true,
  priorityPolicy: 'leo-2026-10-04-30-90-365',
});
console.log('Seeded two synthetic hospitals. Login: leo@demo.theatre.local / TheatreDemo!26');
