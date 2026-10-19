import { db, projectId } from '../apps/api/firebase.ts';
import type { Gender, Patient, Priority, SurgicalCase } from '../shared/domain.ts';

const VERSION = 'artifact-fields-v1';
const REASON =
  'Add the artifact-required gender field and reproducible priority history to synthetic records.';

if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw new Error('Artifact-field migration is allowed only in local demo emulators.');

const markerRef = db.doc('meta/seed'),
  marker = await markerRef.get();
if (!marker.data()?.synthetic) throw new Error('Synthetic seed marker not found. Nothing changed.');

const hospitals = await db.collection('hospitals').get(),
  migratedAt = new Date().toISOString();
let migratedPatients = 0,
  migratedCases = 0;

for (const hospital of hospitals.docs) {
  const [patients, cases, audit] = await Promise.all([
      hospital.ref.collection('patients').get(),
      hospital.ref.collection('cases').get(),
      hospital.ref.collection('audit').get(),
    ]),
    batch = db.batch();
  let hospitalWrites = 0;

  for (const patientDoc of patients.docs) {
    const match = patientDoc.id.match(/^(.*)-pat-(\d+)$/),
      before = patientDoc.data() as Patient;
    if (before.gender) continue;
    const gender: Gender = match
        ? Number(match[2]) % 2 === 0
          ? 'Female'
          : 'Male'
        : 'Not recorded',
      after: Patient = { ...before, gender, version: (before.version ?? 1) + 1 },
      relatedCase = cases.docs.find((item) => item.data().patientId === patientDoc.id),
      caseId = relatedCase?.id ?? null,
      auditRef = hospital.ref.collection('audit').doc(`${VERSION}-patient-${patientDoc.id}`);
    batch.update(patientDoc.ref, { gender, version: after.version });
    batch.set(auditRef, {
      id: auditRef.id,
      caseId,
      departmentId: relatedCase?.data().departmentId ?? 'unknown',
      actor: 'Synthetic data migration',
      actorId: 'system',
      action: 'schema.migrate.patient',
      reason: REASON,
      at: migratedAt,
      occurredAt: migratedAt,
      recordedAt: migratedAt,
      before,
      after,
    });
    migratedPatients++;
    hospitalWrites += 2;
  }

  for (const caseDoc of cases.docs) {
    const before = caseDoc.data() as SurgicalCase;
    if (before.priorityHistory?.length) continue;
    const rawPriority = before.priority as string,
      priority = (rawPriority === 'P1a' || rawPriority === 'P1b' ? 'P1' : rawPriority) as Priority,
      historicalEvents = audit.docs
        .map((item) => item.data() as Record<string, any>)
        .filter((item) => item.caseId === caseDoc.id)
        .sort((a, b) =>
          String(a.occurredAt ?? a.at ?? '').localeCompare(String(b.occurredAt ?? b.at ?? '')),
        ),
      recordedInitial = historicalEvents.find(
        (item) => item.action === 'register' && item.after?.priority,
      )?.after?.priority as string | undefined,
      initial = (
        recordedInitial === 'P1a' || recordedInitial === 'P1b'
          ? 'P1'
          : recordedInitial && ['P1', 'P2', 'P3'].includes(recordedInitial)
            ? recordedInitial
            : priority
      ) as Priority,
      priorityHistory: { priority: Priority; at: string }[] = [
        { priority: initial, at: before.listedAt },
      ];
    for (const event of historicalEvents.filter((item) => item.action === 'priority')) {
      const raw = event.after?.priority as string | undefined,
        eventPriority = (raw === 'P1a' || raw === 'P1b' ? 'P1' : raw) as Priority,
        at = String(event.occurredAt ?? event.at ?? before.updatedAt);
      if (
        ['P1', 'P2', 'P3'].includes(eventPriority) &&
        priorityHistory.at(-1)?.priority !== eventPriority
      )
        priorityHistory.push({ priority: eventPriority, at });
    }
    if (priorityHistory.at(-1)?.priority !== priority)
      priorityHistory.push({ priority, at: before.updatedAt });
    const after: SurgicalCase = {
        ...before,
        priority,
        priorityHistory,
        version: (before.version ?? 1) + 1,
      },
      auditRef = hospital.ref.collection('audit').doc(`${VERSION}-case-${caseDoc.id}`);
    batch.update(caseDoc.ref, {
      priority,
      priorityHistory,
      version: after.version,
    });
    batch.set(auditRef, {
      id: auditRef.id,
      caseId: caseDoc.id,
      departmentId: before.departmentId,
      actor: 'Synthetic data migration',
      actorId: 'system',
      action: 'schema.migrate.case',
      reason: REASON,
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

await markerRef.set({ artifactFields: VERSION }, { merge: true });
console.log(`Migrated ${migratedPatients} patients and ${migratedCases} cases to ${VERSION}.`);
