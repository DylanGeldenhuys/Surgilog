import { db, projectId } from '../apps/api/firebase.ts';
import type { Booking, SurgicalCase } from '../shared/domain.ts';

if (!projectId.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8080')
  throw new Error('Synthetic-history repair is allowed only in local demo emulators.');

const marker = await db.doc('meta/seed').get();
if (!marker.data()?.synthetic) throw new Error('Synthetic seed marker not found. Nothing changed.');

const hospitals = await db.collection('hospitals').get();
let writes = 0;
for (const hospital of hospitals.docs) {
  const h = hospital.ref,
    bookings = await h.collection('bookings').get(),
    batch = db.batch();
  let hospitalWrites = 0;
  for (const bookingDoc of bookings.docs) {
    const booking = bookingDoc.data() as Booking;
    if (!booking.id.includes('-booking-') || !booking.caseId.includes('-case-')) continue;
    const caseDoc = await h.collection('cases').doc(booking.caseId).get(),
      registration = await h.collection('audit').doc(`seed-${booking.caseId}`).get();
    if (!caseDoc.exists || registration.data()?.actorId !== 'seed') continue;
    const surgicalCase = caseDoc.data() as SurgicalCase,
      estimate = booking.estimatedMinutes ?? surgicalCase.duration ?? 60,
      bookedAt = new Date(
        Math.max(+new Date(surgicalCase.createdAt) + 60000, +new Date(booking.start) - 86400000),
      ).toISOString(),
      registered: SurgicalCase = {
        ...surgicalCase,
        status: 'Waiting',
        duration: null,
        version: 1,
        updatedAt: surgicalCase.createdAt,
      },
      booked: SurgicalCase = {
        ...registered,
        status: 'Scheduled',
        readiness: 'Ready',
        duration: estimate,
        version: 2,
        updatedAt: bookedAt,
      };
    const events = [
      {
        id: `seed-book-${booking.id}`,
        action: 'book',
        reason: 'Fictional demonstration booking',
        at: bookedAt,
        before: registered,
        after: booked,
      },
    ];
    if (booking.status === 'Completed' && booking.inAt && booking.outAt) {
      const inTheatre: SurgicalCase = {
          ...booked,
          status: 'In theatre',
          version: 3,
          updatedAt: booking.inAt,
        },
        completed: SurgicalCase = {
          ...inTheatre,
          status: 'Completed',
          version: 4,
          updatedAt: booking.outAt,
        };
      events.push(
        {
          id: `seed-start-${booking.id}`,
          action: 'activity.start',
          reason: 'Fictional theatre entry',
          at: booking.inAt,
          before: booked,
          after: inTheatre,
        },
        {
          id: `seed-complete-${booking.id}`,
          action: 'activity.complete',
          reason: 'Fictional completed surgery',
          at: booking.outAt,
          before: inTheatre,
          after: completed,
        },
      );
    }
    for (const event of events) {
      const ref = h.collection('audit').doc(event.id);
      if ((await ref.get()).exists) continue;
      batch.set(ref, {
        ...event,
        caseId: booking.caseId,
        departmentId: booking.departmentId,
        actor: 'Synthetic seed',
        actorId: 'seed',
        occurredAt: event.at,
        recordedAt: event.at,
      });
      writes++;
      hospitalWrites++;
    }
  }
  const heldCases = await h.collection('cases').where('status', '==', 'On hold').get();
  for (const caseDoc of heldCases.docs) {
    const surgicalCase = caseDoc.data() as SurgicalCase,
      registration = await h.collection('audit').doc(`seed-${surgicalCase.id}`).get();
    if (registration.data()?.actorId !== 'seed') continue;
    const ref = h.collection('audit').doc(`seed-hold-${surgicalCase.id}`);
    if ((await ref.get()).exists) continue;
    const registered: SurgicalCase = {
      ...surgicalCase,
      status: 'Waiting',
      version: 1,
      updatedAt: surgicalCase.createdAt,
    };
    batch.set(ref, {
      id: ref.id,
      caseId: surgicalCase.id,
      departmentId: surgicalCase.departmentId,
      actor: 'Synthetic seed',
      actorId: 'seed',
      action: 'hold',
      reason: 'Fictional temporary hold',
      at: surgicalCase.updatedAt,
      occurredAt: surgicalCase.updatedAt,
      recordedAt: surgicalCase.updatedAt,
      before: registered,
      after: surgicalCase,
    });
    writes++;
    hospitalWrites++;
  }
  if (hospitalWrites) await batch.commit();
}

console.log(`Added ${writes} missing synthetic history events.`);
