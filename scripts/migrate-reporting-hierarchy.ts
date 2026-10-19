import { auth, db, projectId } from '../apps/api/firebase.ts';
import type { Profile, ReportingGrant } from '../shared/domain.ts';

const VERSION = 'reporting-hierarchy-v1';
const PASSWORD = 'TheatreDemo!26';

if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw new Error('Reporting-hierarchy migration is allowed only in local demo emulators.');

const markerRef = db.doc('meta/seed'),
  marker = await markerRef.get();
if (!marker.data()?.synthetic) throw new Error('Synthetic seed marker not found. Nothing changed.');

const geography = {
  region: 'Africa',
  country: 'South Africa',
  province: 'Western Cape',
  district: 'City of Cape Town',
};
for (const hospitalId of ['groote-schuur', 'tygerberg'])
  await db.doc(`hospitals/${hospitalId}`).set(geography, { merge: true });

const accounts: {
  uid: string;
  name: string;
  email: string;
  grant: ReportingGrant;
}[] = [
  {
    uid: 'global-reports',
    name: 'N. Achebe',
    email: 'global@demo.theatre.local',
    grant: { role: 'global_viewer' },
  },
  {
    uid: 'regional-reports',
    name: 'P. Mahlangu',
    email: 'region@demo.theatre.local',
    grant: { role: 'regional_viewer', region: 'Africa' },
  },
  {
    uid: 'country-reports',
    name: 'R. Naidoo',
    email: 'country@demo.theatre.local',
    grant: { role: 'country_viewer', region: 'Africa', country: 'South Africa' },
  },
  {
    uid: 'province-reports',
    name: 'T. Coetzee',
    email: 'province@demo.theatre.local',
    grant: {
      role: 'state_viewer',
      region: 'Africa',
      country: 'South Africa',
      province: 'Western Cape',
    },
  },
  {
    uid: 'district-reports',
    name: 'M. van der Merwe',
    email: 'district@demo.theatre.local',
    grant: { role: 'district_viewer', ...geography },
  },
];

for (const account of accounts) {
  try {
    await auth.createUser({
      uid: account.uid,
      email: account.email,
      password: PASSWORD,
      displayName: account.name,
      emailVerified: true,
    });
  } catch (error) {
    if ((error as { code?: string }).code !== 'auth/uid-already-exists') throw error;
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

await markerRef.set({ reportingHierarchy: VERSION }, { merge: true });
console.log(`Prepared ${accounts.length} named reporting accounts for ${VERSION}.`);
