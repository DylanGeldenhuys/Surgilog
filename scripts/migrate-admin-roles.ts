import { auth, db, projectId } from '../apps/api/firebase.ts';
import type { Profile, Role } from '../shared/domain.ts';
import { syntheticHospitals } from './synthetic-fixtures.ts';

if (
  projectId !== 'demo-theatre-tracker' ||
  process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080'
)
  throw new Error('Role fixtures are allowed only in the local demo emulators.');
const marker = db.doc('meta/adminRolesV1');
if ((await marker.get()).exists) {
  console.log('Local role fixtures already prepared; preserving staff changes.');
  process.exit(0);
}
const accounts: {
  uid: string;
  email: string;
  name: string;
  role: Role;
  hospitalIds: string[];
  superUser?: boolean;
}[] = [
  {
    uid: 'leo',
    email: 'leo@demo.theatre.local',
    name: 'Dr Leo Meyer',
    role: 'doctor',
    hospitalIds: ['groote-schuur', 'tygerberg'],
  },
  {
    uid: 'doctor2',
    email: 'doctor2@demo.theatre.local',
    name: 'Dr S. Naidoo',
    role: 'doctor',
    hospitalIds: ['tygerberg'],
  },
  {
    uid: 'sister',
    email: 'sister@demo.theatre.local',
    name: 'Sr Nomsa Dlamini',
    role: 'nurse',
    hospitalIds: ['groote-schuur'],
  },
  {
    uid: 'clerk',
    email: 'clerk@demo.theatre.local',
    name: 'Jamie Adams',
    role: 'clerk',
    hospitalIds: ['groote-schuur'],
  },
  {
    uid: 'scheduler',
    email: 'scheduler@demo.theatre.local',
    name: 'Sam Petersen',
    role: 'system_admin_read',
    hospitalIds: ['groote-schuur'],
  },
  {
    uid: 'super',
    email: 'super@demo.theatre.local',
    name: 'Demo Super User',
    role: 'super_user',
    hospitalIds: [],
    superUser: true,
  },
  {
    uid: 'major',
    email: 'major@demo.theatre.local',
    name: 'Demo Major User',
    role: 'major_write',
    hospitalIds: ['groote-schuur', 'tygerberg'],
  },
  {
    uid: 'major-read',
    email: 'major-read@demo.theatre.local',
    name: 'Demo Major Reader',
    role: 'major_read',
    hospitalIds: ['groote-schuur', 'tygerberg'],
  },
  {
    uid: 'hospital-admin',
    email: 'hospital-admin@demo.theatre.local',
    name: 'Demo Hospital Admin',
    role: 'system_admin_write',
    hospitalIds: ['groote-schuur'],
  },
  {
    uid: 'hospital-read',
    email: 'hospital-read@demo.theatre.local',
    name: 'Demo Hospital Reader',
    role: 'system_admin_read',
    hospitalIds: ['groote-schuur'],
  },
];
for (const a of accounts) {
  try {
    const existing = await auth.getUser(a.uid);
    if (existing.email !== a.email) throw new Error('Unexpected fixture account.');
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
    await auth.createUser({
      uid: a.uid,
      email: a.email,
      displayName: a.name,
      password: 'TheatreDemo!26',
      emailVerified: true,
    });
  }
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`profiles/${a.uid}`),
      old = await tx.get(ref);
    if (old.exists && old.get('email') !== a.email) throw new Error('Unexpected fixture profile.');
    const profile: Profile = {
      uid: a.uid,
      email: a.email,
      name: a.name,
      active: true,
      superUser: !!a.superUser,
      version: (old.get('version') ?? 0) + 1,
      memberships: a.hospitalIds.map((hospitalId) => ({
        hospitalId,
        role: a.role,
        departments: [
          'major_write',
          'major_read',
          'system_admin_write',
          'system_admin_read',
        ].includes(a.role)
          ? ['*']
          : syntheticHospitals.find((h) => h.id === hospitalId)!.departments.map((d) => d.id),
      })),
    };
    tx.set(ref, profile);
  });
}
await marker.create({ at: new Date().toISOString(), synthetic: true });
console.log(
  'Prepared Doctor, Nurse, Clerk, Super User and read/write admin fixtures; patient records were preserved.',
);
