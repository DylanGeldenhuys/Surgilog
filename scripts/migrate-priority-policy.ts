import { db, projectId } from '../apps/api/firebase.ts';
import { dueDate, type Priority } from '../shared/domain.ts';

const POLICY_VERSION = 'leo-2026-10-04-30-90-365';
const REASON = 'Leo-confirmed treatment targets: P1 up to 30 days, P2 31–90 days, P3 91–365 days.';

if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw new Error('Priority-policy migration is allowed only in local demo emulators.');

const markerRef = db.doc('meta/seed'),
  marker = await markerRef.get();
if (!marker.data()?.synthetic) throw new Error('Synthetic seed marker not found. Nothing changed.');

const hospitals = await db.collection('hospitals').get(),
  migratedAt = new Date().toISOString();
let migratedCases = 0;

for (const hospital of hospitals.docs) {
  const cases = await hospital.ref.collection('cases').get(),
    batch = db.batch();
  let hospitalWrites = 0;

  for (const caseDoc of cases.docs) {
    const before = caseDoc.data(),
      oldPriority = before.priority as string,
      priority = (oldPriority === 'P1a' || oldPriority === 'P1b' ? 'P1' : oldPriority) as Priority;
    if (!['P1', 'P2', 'P3'].includes(priority) || typeof before.urgencyAt !== 'string') continue;

    const nextDueAt = dueDate(before.urgencyAt, priority);
    if (oldPriority === priority && before.dueAt === nextDueAt) continue;

    const after = {
        ...before,
        priority,
        dueAt: nextDueAt,
        version: (before.version ?? 1) + 1,
        updatedAt: migratedAt,
      },
      auditRef = hospital.ref.collection('audit').doc(`${POLICY_VERSION}-${caseDoc.id}`);

    batch.update(caseDoc.ref, {
      priority: after.priority,
      dueAt: after.dueAt,
      version: after.version,
      updatedAt: after.updatedAt,
    });
    batch.set(auditRef, {
      id: auditRef.id,
      caseId: caseDoc.id,
      departmentId: before.departmentId,
      actor: 'System policy migration',
      actorId: 'system',
      action: 'policy.migrate',
      reason: REASON,
      policyVersion: POLICY_VERSION,
      at: migratedAt,
      occurredAt: migratedAt,
      recordedAt: migratedAt,
      before,
      after,
    });
    migratedCases++;
    hospitalWrites += 2;
  }

  if (hospitalWrites) await batch.commit();
}

await markerRef.set({ priorityPolicy: POLICY_VERSION }, { merge: true });
console.log(`Migrated ${migratedCases} cases to ${POLICY_VERSION}.`);
