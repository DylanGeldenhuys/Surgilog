import {
  dueDate,
  ICD10_SYSTEM,
  saDay,
  type Hospital,
  type Icd10Coding,
  type Patient,
  type SurgicalCase,
  type TheatreSession,
  type Booking,
} from '../shared/domain.ts';
import { createHash } from 'node:crypto';

const names = [
  'Thandi Mokoena',
  'Pieter van Zyl',
  'Naledi Dlamini',
  'Sipho Nkosi',
  'Lerato Molefe',
  'Bongani Khumalo',
  'Ayesha Jacobs',
  'Zanele Ndlovu',
  'David Petersen',
  'Nomsa Mthembu',
  'Karabo Sithole',
  'Miriam Steyn',
  'Farai Dube',
  'Sibusiso Maseko',
  'Emily Adams',
  'Nandi Ncube',
  'Andile Zulu',
  'Fatima Khan',
  'Themba Radebe',
  'Lindiwe Cele',
];
export const syntheticHospitals: Hospital[] = [
  {
    id: 'groote-schuur',
    name: 'Groote Schuur Hospital',
    city: 'Cape Town · Western Cape',
    region: 'Africa',
    country: 'South Africa',
    province: 'Western Cape',
    district: 'City of Cape Town',
    departments: [
      { id: 'general', name: 'General surgery' },
      { id: 'orthopaedics', name: 'Orthopaedics' },
    ],
    theatres: ['Theatre 1', 'Theatre 2', 'Theatre 3'],
    surgeons: ['Dr Leo Meyer', 'Dr A. Jacobs', 'Dr B. Ndlovu'],
  },
  {
    id: 'tygerberg',
    name: 'Tygerberg Hospital',
    city: 'Cape Town · Western Cape',
    region: 'Africa',
    country: 'South Africa',
    province: 'Western Cape',
    district: 'City of Cape Town',
    departments: [{ id: 'general', name: 'General surgery' }],
    theatres: ['Theatre A', 'Theatre B'],
    surgeons: ['Dr S. Naidoo', 'Dr L. Botha'],
  },
];

export function syntheticDocuments(now = new Date()) {
  const records: { path: string; data: object }[] = [];
  const today = saDay(now),
    local = (date: string, t: string) => new Date(`${date}T${t}:00+02:00`).toISOString();
  const ago = (days: number) => new Date(+now - days * 86400000).toISOString();
  for (const hospital of syntheticHospitals) {
    const hospitalPath = `hospitals/${hospital.id}`;
    records.push({ path: hospitalPath, data: hospital });
    const path = (collection: string, id: string) => `${hospitalPath}/${collection}/${id}`;
    for (const [di, department] of hospital.departments.entries()) {
      const add = (path: string, data: object) => records.push({ path, data });
      const procedures =
        department.id === 'general'
          ? [
              'Laparoscopic cholecystectomy',
              'Inguinal hernia repair',
              'Thyroidectomy',
              'Colonoscopy',
              'Haemorrhoidectomy',
            ]
          : [
              'Total knee replacement',
              'Hip replacement',
              'ACL reconstruction',
              'Shoulder arthroscopy',
            ];
      const syntheticDiagnoses: Record<string, { diagnosis: string; icd10: Icd10Coding }> = {
        'Laparoscopic cholecystectomy': {
          diagnosis: 'Cholelithiasis',
          icd10: { system: ICD10_SYSTEM, code: 'K80.2' },
        },
        'Inguinal hernia repair': {
          diagnosis: 'Inguinal hernia',
          icd10: { system: ICD10_SYSTEM, code: 'K40.9' },
        },
        Thyroidectomy: {
          diagnosis: 'Nontoxic goitre',
          icd10: { system: ICD10_SYSTEM, code: 'E04.9' },
        },
        Colonoscopy: {
          diagnosis: 'Rectal bleeding',
          icd10: { system: ICD10_SYSTEM, code: 'K62.5' },
        },
        Haemorrhoidectomy: {
          diagnosis: 'Haemorrhoids',
          icd10: { system: ICD10_SYSTEM, code: 'K64.9' },
        },
        'Total knee replacement': {
          diagnosis: 'Osteoarthritis of knee',
          icd10: { system: ICD10_SYSTEM, code: 'M17.1' },
        },
        'Hip replacement': {
          diagnosis: 'Osteoarthritis of hip',
          icd10: { system: ICD10_SYSTEM, code: 'M16.1' },
        },
        'ACL reconstruction': {
          diagnosis: 'Tear of cruciate ligament of knee',
          icd10: { system: ICD10_SYSTEM, code: 'S83.5' },
        },
        'Shoulder arthroscopy': {
          diagnosis: 'Rotator cuff syndrome',
          icd10: { system: ICD10_SYSTEM, code: 'M75.1' },
        },
      };
      const sessions: TheatreSession[] = [];
      for (let day = -6; day <= 3; day++) {
        const date = saDay(new Date(+new Date(`${today}T12:00:00+02:00`) + day * 86400000));
        const session: TheatreSession = {
          id: `${department.id}-${date}`,
          departmentId: department.id,
          theatre: hospital.theatres[di],
          date,
          start: local(date, '08:00'),
          end: local(date, '13:00'),
          surgeon: hospital.surgeons[di],
          version: 1,
        };
        sessions.push(session);
        add(path('sessions', session.id), session);
      }
      for (let i = 0; i < 38; i++) {
        const patient: Patient = {
          id: `${department.id}-pat-${i}`,
          ref: `${department.id === 'general' ? 'GS' : 'OR'}-${202600 + i}`,
          name: names[i % names.length],
          dob: `${1960 + (i % 40)}-${String(1 + (i % 12)).padStart(2, '0')}-15`,
          gender: i % 2 === 0 ? 'Female' : 'Male',
          phone: `+27 82 555 ${String(1000 + i)}`,
          version: 1,
        };
        const priority = (
          i % 11 === 0 || i % 7 === 0 ? 'P1' : i % 3 === 0 ? 'P2' : 'P3'
        ) as SurgicalCase['priority'];
        const estimatedMinutes = [45, 60, 90, 120][i % 4],
          listedAt = ago(12 + ((i * 7) % 130)),
          urgencyAt = ago(i < 10 ? 7 + i : i % 11);
        const c: SurgicalCase = {
          id: `${department.id}-case-${i}`,
          patientId: patient.id,
          departmentId: department.id,
          procedure: procedures[i % procedures.length],
          surgeon: hospital.surgeons[i % hospital.surgeons.length],
          priority,
          priorityHistory: [{ priority, at: listedAt }],
          listedAt,
          urgencyAt,
          dueAt: '',
          status: 'Waiting',
          readiness: i % 5 === 0 ? 'Needs assessment' : 'Ready',
          duration: null,
          notes: i % 5 === 0 ? 'Awaiting pre-operative assessment.' : '',
          version: 1,
          createdAt: ago(15 + i),
          updatedAt: ago(1),
        };
        // Half of the fictional rows keep the older shape, with no diagnosis stored.
        if (i % 2 === 0) Object.assign(c, syntheticDiagnoses[c.procedure]);
        c.dueAt = dueDate(c.urgencyAt, c.priority);
        const registered = structuredClone(c);
        if (i < 12) {
          const s = sessions[Math.floor(i / 2)],
            start = new Date(+new Date(s.start) + (i % 2) * 145 * 60000).toISOString(),
            outAt = new Date(+new Date(start) + estimatedMinutes * 60000).toISOString(),
            end = new Date(+new Date(outAt) + 15 * 60000).toISOString(),
            bookedAt = new Date(+new Date(start) - 86400000).toISOString(),
            booked = {
              ...registered,
              status: 'Scheduled' as const,
              readiness: 'Ready' as const,
              surgeon: s.surgeon,
              duration: estimatedMinutes,
              version: 2,
              updatedAt: bookedAt,
            },
            inTheatre = { ...booked, status: 'In theatre' as const, version: 3, updatedAt: start },
            completed = {
              ...inTheatre,
              status: 'Completed' as const,
              version: 4,
              updatedAt: outAt,
            };
          Object.assign(c, completed);
          const b: Booking = {
            id: `${department.id}-booking-${i}`,
            caseId: c.id,
            sessionId: s.id,
            departmentId: department.id,
            start,
            end,
            status: 'Completed',
            inAt: start,
            outAt,
            reason: '',
            estimatedMinutes,
            turnoverMinutes: 15,
            version: 3,
          };
          add(path('bookings', b.id), b);
          add(path('audit', `seed-book-${b.id}`), {
            id: `seed-book-${b.id}`,
            caseId: c.id,
            departmentId: department.id,
            actor: 'Synthetic seed',
            actorId: 'seed',
            action: 'book',
            reason: 'Fictional demonstration booking',
            at: bookedAt,
            occurredAt: bookedAt,
            recordedAt: bookedAt,
            before: registered,
            after: booked,
          });
          add(path('audit', `seed-start-${b.id}`), {
            id: `seed-start-${b.id}`,
            caseId: c.id,
            departmentId: department.id,
            actor: 'Synthetic seed',
            actorId: 'seed',
            action: 'activity.start',
            reason: 'Fictional theatre entry',
            at: start,
            occurredAt: start,
            recordedAt: start,
            before: booked,
            after: inTheatre,
          });
          add(path('audit', `seed-complete-${b.id}`), {
            id: `seed-complete-${b.id}`,
            caseId: c.id,
            departmentId: department.id,
            actor: 'Synthetic seed',
            actorId: 'seed',
            action: 'activity.complete',
            reason: 'Fictional completed surgery',
            at: outAt,
            occurredAt: outAt,
            recordedAt: outAt,
            before: inTheatre,
            after: completed,
          });
        }
        if (i >= 12 && i < 16) {
          const s = sessions[7 + Math.floor((i - 12) / 2)],
            start = new Date(+new Date(s.start) + ((i - 12) % 2) * 130 * 60000).toISOString(),
            end = new Date(+new Date(start) + (estimatedMinutes + 15) * 60000).toISOString(),
            bookedAt = new Date(+new Date(start) - 86400000).toISOString(),
            booked = {
              ...registered,
              status: 'Scheduled' as const,
              readiness: 'Ready' as const,
              surgeon: s.surgeon,
              duration: estimatedMinutes,
              version: 2,
              updatedAt: bookedAt,
            };
          Object.assign(c, booked);
          const b: Booking = {
            id: `${department.id}-booking-${i}`,
            caseId: c.id,
            sessionId: s.id,
            departmentId: department.id,
            start,
            end,
            status: 'Scheduled',
            inAt: null,
            outAt: null,
            reason: '',
            estimatedMinutes,
            turnoverMinutes: 15,
            version: 1,
          };
          add(path('bookings', b.id), b);
          add(path('audit', `seed-book-${b.id}`), {
            id: `seed-book-${b.id}`,
            caseId: c.id,
            departmentId: department.id,
            actor: 'Synthetic seed',
            actorId: 'seed',
            action: 'book',
            reason: 'Fictional demonstration booking',
            at: bookedAt,
            occurredAt: bookedAt,
            recordedAt: bookedAt,
            before: registered,
            after: booked,
          });
        }
        if (i === 17) {
          const heldAt = ago(1),
            held = { ...registered, status: 'On hold' as const, version: 2, updatedAt: heldAt };
          Object.assign(c, held);
          add(path('audit', `seed-hold-${c.id}`), {
            id: `seed-hold-${c.id}`,
            caseId: c.id,
            departmentId: department.id,
            actor: 'Synthetic seed',
            actorId: 'seed',
            action: 'hold',
            reason: 'Fictional temporary hold',
            at: heldAt,
            occurredAt: heldAt,
            recordedAt: heldAt,
            before: registered,
            after: held,
          });
        }
        add(path('patients', patient.id), patient);
        add(path('patientRefs', createHash('sha256').update(patient.ref).digest('hex')), {
          patientId: patient.id,
        });
        add(path('cases', c.id), c);
        add(path('audit', `seed-${c.id}`), {
          id: `seed-${c.id}`,
          caseId: c.id,
          departmentId: department.id,
          actor: 'Synthetic seed',
          actorId: 'seed',
          action: 'register',
          reason: 'Fictional demonstration record',
          at: c.createdAt,
          occurredAt: c.createdAt,
          recordedAt: c.createdAt,
          before: null,
          after: registered,
        });
      }
    }
  }

  return records;
}
