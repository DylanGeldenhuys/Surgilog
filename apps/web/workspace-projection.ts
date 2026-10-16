import { projectedEntry } from '../../shared/theatre.ts';
import {
  dueDate,
  type Workspace,
  type Pending,
  type OperationResult,
} from '../../shared/domain.ts';
import type { VaultData } from './vault.ts';

export function projected(base: Workspace, pending: Pending[]) {
  const w = structuredClone(base);
  for (const p of pending) {
    if (p.status !== 'pending' || p.hospitalId !== w.hospital.id) continue;
    const op = p.operation;
    if (op.type === 'theatre-entry') {
      if (op.data.departmentId !== w.departmentId) continue;
      const entries = w.theatreEntries ?? [],
        previous = entries.find((e) => e.id === op.data.entryId);
      if ((previous?.version ?? 0) !== op.data.version) continue;
      w.theatreEntries = [
        ...entries.filter((e) => e.id !== op.data.entryId),
        projectedEntry(op.data, op.recordedAt, previous),
      ];
      continue;
    }
    if (op.type === 'register') {
      const d = op.data;
      if (d.departmentId !== w.departmentId || w.cases.some((c) => c.id === d.caseId)) continue;
      const reference = d.patientRef.trim().toUpperCase();
      const existing = w.patients.find((patient) => patient.ref.trim().toUpperCase() === reference);
      const patientId = existing?.id ?? d.patientId ?? `pat-${op.id}`;
      if (!existing)
        w.patients.push({
          id: patientId,
          ref: reference,
          name: d.patientName,
          dob: d.dob,
          gender: d.gender,
          phone: d.phone,
          version: 1,
        });
      w.cases.push({
        id: d.caseId,
        patientId,
        departmentId: d.departmentId,
        procedure: d.procedure,
        surgeon: d.surgeon,
        priority: d.priority,
        ...(d.priorityAssignedBy ? { priorityAssignedBy: d.priorityAssignedBy } : {}),
        priorityHistory: [{ priority: d.priority, at: d.listedAt }],
        listedAt: d.listedAt,
        urgencyAt: d.urgencyAt,
        dueAt: dueDate(d.urgencyAt, d.priority),
        readiness: d.readiness,
        duration: null,
        notes: d.notes,
        status: 'Waiting',
        version: 1,
        createdAt: op.occurredAt,
        updatedAt: op.occurredAt,
      });
      continue;
    }
    if (op.type === 'patient') {
      const patient = w.patients.find((x) => x.id === op.data.patientId);
      const patientVersion = patient?.version ?? 1;
      if (patient && patientVersion === op.data.version)
        Object.assign(patient, {
          name: op.data.name,
          dob: op.data.dob,
          gender: op.data.gender ?? patient.gender ?? 'Not recorded',
          phone: op.data.phone,
          version: patientVersion + 1,
        });
      continue;
    }
    if (op.type === 'book' || !('caseId' in op.data)) continue;
    const caseId = op.data.caseId;
    const c = w.cases.find((c) => c.id === caseId);
    if (!c || c.version !== op.data.version) continue;
    if (op.type === 'priority') {
      c.priorityHistory = [
        ...(c.priorityHistory ?? []),
        { priority: op.data.priority, at: op.occurredAt },
      ];
      c.priority = op.data.priority;
      c.dueAt = dueDate(c.urgencyAt, c.priority);
    }
    if (op.type === 'readiness') c.readiness = op.data.readiness;
    if (op.type === 'hold') c.status = op.data.hold ? 'On hold' : 'Waiting';
    if (op.type === 'case-notes') c.notes = op.data.notes;
    if (op.type === 'activity') {
      const b = w.bookings.find((b) => b.id === op.data.bookingId);
      if (!b) continue;
      if (op.data.kind === 'start') {
        c.status = 'In theatre';
        b.status = 'In theatre';
        b.inAt = op.occurredAt;
      }
      if (op.data.kind === 'complete') {
        c.status = 'Completed';
        b.status = 'Completed';
        b.outAt = op.occurredAt;
      }
      if (op.data.kind === 'cancel') {
        c.status = 'Waiting';
        b.status = 'Cancelled';
        b.reason = op.data.reason;
      }
      b.version++;
    }
    c.version++;
  }
  return w;
}
// Persist the acknowledged change and remove its outbox entry in the same vault write.
// A subsequent workspace fetch may fail or the browser may close immediately afterwards.
function confirmedWorkspace(workspace: Workspace, entry: Pending, result?: OperationResult) {
  if (workspace.hospital.id !== entry.hospitalId) return workspace;
  if (!result?.changes) return projected(workspace, [entry]);
  const w = structuredClone(workspace);
  const { patient, surgicalCase, booking, session, theatreEntry } = result.changes;
  const merge = <T extends { id: string; version: number }>(
    items: T[],
    incoming: T | undefined,
    insert = false,
  ) => {
    if (!incoming) return;
    const index = items.findIndex((item) => item.id === incoming.id);
    if (index < 0) {
      if (insert) items.push(structuredClone(incoming));
    } else if ((items[index].version ?? 1) <= (incoming.version ?? 1))
      items[index] = structuredClone(incoming);
  };
  if (theatreEntry?.departmentId === w.departmentId) {
    w.theatreEntries ??= [];
    merge(w.theatreEntries, theatreEntry, true);
  }
  if (surgicalCase?.departmentId === w.departmentId) merge(w.cases, surgicalCase, true);
  merge(w.patients, patient, !!patient && w.cases.some((c) => c.patientId === patient.id));
  if (booking?.departmentId === w.departmentId) merge(w.bookings, booking, true);
  if (session?.departmentId === w.departmentId) merge(w.sessions, session, true);
  return w;
}

export function acknowledgeOperation(
  data: VaultData,
  entry: Pending,
  result?: OperationResult,
): VaultData {
  return {
    ...data,
    workspaces: Object.fromEntries(
      Object.entries(data.workspaces).map(([key, workspace]) => [
        key,
        confirmedWorkspace(workspace, entry, result),
      ]),
    ),
    pending: data.pending.filter(
      (item) => item.operation.id !== entry.operation.id || item.hospitalId !== entry.hospitalId,
    ),
  };
}
