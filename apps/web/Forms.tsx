import { useState, type FormEvent } from 'react';
import { AlertCircle, Check, Clock, Save } from 'lucide-react';
import {
  type Workspace,
  type SurgicalCase,
  type Operation,
  type Priority,
  type NewCase,
  operationSchema,
  saDay,
  compareInstants,
  nextAvailableStart,
  turnaroundMinutes,
  genderOptions,
  type Gender,
  type Role,
  canClinical,
} from '../../shared/domain.ts';
import { Modal, Field, inputTime, fromInput, date, time } from './ui.tsx';
import { shouldHoldForRetry } from './sync-policy.ts';
export type FormKind =
  | 'register'
  | 'patient'
  | 'case-notes'
  | 'priority'
  | 'readiness'
  | 'hold'
  | 'session'
  | 'book'
  | 'start'
  | 'complete'
  | 'cancel';
export function OperationForm({
  kind,
  w,
  c,
  role,
  sessionDate,
  onClose,
  onSubmit,
}: {
  kind: FormKind;
  w: Workspace;
  c?: SurgicalCase;
  role: Role;
  sessionDate?: string;
  onClose: () => void;
  onSubmit: (o: Operation) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [selected, setSelected] = useState(''),
    [estimate, setEstimate] = useState(''),
    [attempted, setAttempted] = useState<Operation | null>(null);
  const turnover = turnaroundMinutes(w.hospital);
  const current = new Date().toISOString(),
    patient = c ? w.patients.find((p) => p.id === c.patientId) : null;
  const sessions = w.sessions
    .filter((s) => +new Date(s.start) >= Date.now())
    .sort((a, b) => compareInstants(a.start, b.start));
  const estimateMinutes = Number(estimate),
    availableSessions =
      estimateMinutes >= 5 && estimateMinutes <= 720
        ? sessions.flatMap((session) => {
            const start = nextAvailableStart(session, w.bookings, estimateMinutes, turnover);
            return start ? [{ session, start }] : [];
          })
        : [],
    selectedSlot = availableSessions.find(({ session }) => session.id === selected);
  const booking = c
    ? w.bookings.find((b) => b.caseId === c.id && ['Scheduled', 'In theatre'].includes(b.status))
    : undefined;
  const titles: Record<FormKind, string> = {
    register: 'Add patient to the backlog',
    patient: 'Edit patient details',
    'case-notes': 'Update case notes',
    priority: 'Review clinical priority',
    readiness: 'Update readiness',
    hold: c?.status === 'On hold' ? 'Return to waiting list' : 'Place case on hold',
    session: 'Create a theatre session',
    book: 'Schedule surgery',
    start: 'Record theatre entry',
    complete: 'Record completion',
    cancel: 'Cancel this booking',
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    const form = new FormData(e.currentTarget),
      get = (key: string) => String(form.get(key) ?? '');
    let op: Operation;
    try {
      if (attempted) {
        await onSubmit(attempted);
        onClose();
        return;
      }
      const base = {
        id: crypto.randomUUID(),
        recordedAt: new Date().toISOString(),
        occurredAt: get('occurredAt') ? fromInput(get('occurredAt')) : new Date().toISOString(),
      };
      if (kind === 'register') {
        const listing = fromInput(get('listedAt'));
        op = {
          ...base,
          type: 'register',
          data: {
            caseId: crypto.randomUUID(),
            patientRef: get('patientRef'),
            patientName: get('patientName'),
            dob: get('dob'),
            gender: get('gender') as Gender,
            phone: get('phone'),
            departmentId: w.departmentId,
            procedure: get('procedure'),
            surgeon: get('surgeon'),
            priority: get('priority') as Priority,
            ...(!canClinical(role) ? { priorityAssignedBy: get('priorityAssignedBy') } : {}),
            listedAt: listing,
            urgencyAt: fromInput(get('urgencyAt')),
            readiness: get('readiness') as NewCase['readiness'],
            notes: get('notes'),
          },
        };
      } else if (kind === 'session') {
        const d = get('date');
        op = {
          ...base,
          type: 'session',
          data: {
            sessionId: crypto.randomUUID(),
            departmentId: w.departmentId,
            theatre: get('theatre'),
            date: d,
            start: fromInput(`${d}T${get('start')}`),
            end: fromInput(`${d}T${get('end')}`),
            surgeon: get('surgeon'),
          },
        };
      } else if (!c) throw new Error('Select a case first.');
      else if (kind === 'patient') {
        if (!patient) throw new Error('Patient details are unavailable. Refresh this case.');
        op = {
          ...base,
          type: 'patient',
          data: {
            caseId: c.id,
            patientId: patient.id,
            version: patient.version ?? 1,
            name: get('patientName'),
            dob: get('dob'),
            gender: get('gender') as Gender,
            phone: get('phone'),
            reason: get('reason'),
          },
        };
      } else if (kind === 'case-notes')
        op = {
          ...base,
          type: 'case-notes',
          data: {
            caseId: c.id,
            version: c.version,
            notes: get('notes'),
            reason: get('reason'),
          },
        };
      else if (kind === 'priority')
        op = {
          ...base,
          type: 'priority',
          data: {
            caseId: c.id,
            version: c.version,
            priority: get('priority') as Priority,
            reason: get('reason'),
          },
        };
      else if (kind === 'readiness')
        op = {
          ...base,
          type: 'readiness',
          data: {
            caseId: c.id,
            version: c.version,
            readiness: get('readiness') as SurgicalCase['readiness'],
            reason: get('reason'),
          },
        };
      else if (kind === 'hold')
        op = {
          ...base,
          type: 'hold',
          data: {
            caseId: c.id,
            version: c.version,
            hold: c.status !== 'On hold',
            reason: get('reason'),
          },
        };
      else if (kind === 'book')
        op = {
          ...base,
          type: 'book',
          data: {
            caseId: c.id,
            version: c.version,
            sessionId: get('sessionId'),
            duration: Number(get('duration')),
          },
        };
      else {
        if (!booking) throw new Error('No active booking. Refresh the case.');
        op = {
          ...base,
          type: 'activity',
          data: {
            caseId: c.id,
            version: c.version,
            bookingId: booking.id,
            kind,
            reason: get('reason'),
          },
        };
      }
      op = operationSchema.parse(op);
      setAttempted(op);
      await onSubmit(op);
      onClose();
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (!shouldHoldForRetry(status)) setAttempted(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[kind]}
      subtitle={
        patient
          ? `${patient.name} · ${patient.ref}`
          : w.hospital.departments.find((d) => d.id === w.departmentId)?.name
      }
      onClose={onClose}
      wide={kind === 'register'}
    >
      <form onSubmit={submit} className="modal-body">
        <fieldset disabled={busy || !!attempted}>
          {kind === 'register' && (
            <>
              <div className="info">
                Add the patient and their first surgical case together. If the hospital reference
                already exists, the new case will be linked to that patient after the details are
                checked.
              </div>
              <div className="form-section-label">PATIENT DETAILS</div>
              <div className="form-grid">
                <Field label="Hospital patient reference">
                  <input
                    name="patientRef"
                    required
                    maxLength={160}
                    placeholder="e.g. GS-202642"
                    list="patient-refs"
                    onChange={(e) => {
                      const p = w.patients.find((p) => p.ref === e.target.value);
                      if (p) {
                        const f = e.currentTarget.form!;
                        (f.elements.namedItem('patientName') as HTMLInputElement).value = p.name;
                        (f.elements.namedItem('dob') as HTMLInputElement).value = p.dob;
                        (f.elements.namedItem('gender') as HTMLSelectElement).value =
                          p.gender ?? 'Not recorded';
                        (f.elements.namedItem('phone') as HTMLInputElement).value = p.phone;
                      }
                    }}
                  />
                  <datalist id="patient-refs">
                    {w.patients.map((p) => (
                      <option key={p.id} value={p.ref}>
                        {p.name}
                      </option>
                    ))}
                  </datalist>
                </Field>
                <Field label="Full name">
                  <input
                    name="patientName"
                    required
                    maxLength={160}
                    placeholder="Patient’s full name"
                  />
                </Field>
                <Field label="Date of birth (if known)">
                  <input name="dob" type="date" max={saDay(current)} />
                </Field>
                <Field label="Gender">
                  <select name="gender" defaultValue="Not recorded">
                    {genderOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Contact number (optional)">
                  <input name="phone" type="tel" maxLength={40} placeholder="+27" />
                </Field>
              </div>
              <div className="form-section-label">SURGICAL CASE</div>
              <div className="form-grid">
                <Field label="Planned procedure">
                  <input
                    name="procedure"
                    required
                    maxLength={160}
                    placeholder="e.g. Inguinal hernia repair"
                  />
                </Field>
                <Field label="Responsible surgeon">
                  <select name="surgeon">
                    <option value="">Unassigned</option>
                    {w.hospital.surgeons.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={canClinical(role) ? 'Clinical priority' : 'Priority assigned by doctor'}
                >
                  <PrioritySelect value={canClinical(role) ? 'P3' : ''} />
                </Field>
                {!canClinical(role) && (
                  <Field
                    label="Doctor who assigned priority"
                    hint="Transcribe the doctor’s recorded decision; do not assign a priority yourself."
                  >
                    <input name="priorityAssignedBy" required minLength={2} maxLength={160} />
                  </Field>
                )}
                {canClinical(role) ? (
                  <Field label="Readiness">
                    <ReadinessSelect value="Needs assessment" />
                  </Field>
                ) : (
                  <Field label="Readiness">
                    <input name="readiness" readOnly value="Needs assessment" />
                    <small>A doctor will review readiness.</small>
                  </Field>
                )}
                <Field label="Listed at (SAST)">
                  <input
                    name="listedAt"
                    type="datetime-local"
                    required
                    defaultValue={inputTime()}
                    max={inputTime()}
                  />
                </Field>
                <Field
                  label="Urgency clock starts (SAST)"
                  hint="Record when this priority was clinically assigned; the treatment due time is calculated from it."
                >
                  <input
                    name="urgencyAt"
                    type="datetime-local"
                    required
                    defaultValue={inputTime()}
                    max={inputTime()}
                  />
                </Field>
              </div>
              <Field label="Relevant notes (optional)">
                <textarea
                  name="notes"
                  rows={3}
                  maxLength={2000}
                  placeholder="Readiness blockers or relevant operational notes"
                />
              </Field>
            </>
          )}
          {kind === 'patient' && patient && (
            <>
              <div className="form-grid">
                <Field
                  label="Hospital patient reference"
                  hint="The hospital reference cannot be changed here."
                >
                  <input value={patient.ref} disabled />
                </Field>
                <Field label="Full name">
                  <input name="patientName" required maxLength={160} defaultValue={patient.name} />
                </Field>
                <Field label="Date of birth (if known)">
                  <input name="dob" type="date" max={saDay(current)} defaultValue={patient.dob} />
                </Field>
                <Field label="Gender">
                  <select name="gender" defaultValue={patient.gender ?? 'Not recorded'}>
                    {genderOptions.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Contact number (optional)">
                  <input
                    name="phone"
                    type="tel"
                    maxLength={40}
                    defaultValue={patient.phone}
                    placeholder="+27"
                  />
                </Field>
              </div>
            </>
          )}
          {kind === 'case-notes' && (
            <Field
              label="Case notes"
              hint="Use this for readiness blockers or relevant operational notes."
            >
              <textarea name="notes" rows={5} maxLength={2000} defaultValue={c!.notes} />
            </Field>
          )}
          {kind === 'priority' && (
            <>
              <Field label="Clinical priority">
                <PrioritySelect value={c!.priority} />
              </Field>
              <div className="info">
                <Clock size={17} />
                <span>
                  The original urgency clock is preserved. Changing the priority recalculates the
                  treatment due time against that clock and is recorded in the history.
                </span>
              </div>
            </>
          )}
          {kind === 'readiness' && (
            <>
              <Field label="Readiness">
                <ReadinessSelect value={c!.readiness} />
              </Field>
              <div className="info readiness-guide">
                <AlertCircle size={17} />
                <span>
                  <strong>Needs assessment</strong> means the assessment is still outstanding.{' '}
                  <strong>Not ready</strong> means the case was assessed but a blocker remains.{' '}
                  <strong>Ready</strong> means the case can be considered for scheduling.
                </span>
              </div>
            </>
          )}
          {kind === 'hold' && (
            <div className="info">
              <Clock size={17} />
              <span>
                {c?.status === 'On hold'
                  ? 'Returning this case to waiting makes it available for readiness review and scheduling again.'
                  : 'On hold temporarily pauses booking while a blocker is resolved. The case stays outstanding and its waiting clock continues.'}
              </span>
            </div>
          )}
          {['patient', 'case-notes', 'priority', 'readiness', 'hold', 'cancel'].includes(kind) && (
            <Field label={kind === 'cancel' ? 'Cancellation reason' : 'Reason for this change'}>
              <textarea
                name="reason"
                minLength={3}
                maxLength={1000}
                required
                rows={3}
                placeholder={
                  kind === 'cancel'
                    ? 'Patient, clinical, staffing, equipment, beds, emergency displacement…'
                    : kind === 'hold'
                      ? 'Describe why the case is being paused or returned to waiting'
                      : kind === 'readiness'
                        ? 'Record the assessment or readiness blocker'
                        : 'Record the reason for your team'
                }
              />
            </Field>
          )}
          {kind === 'session' && (
            <>
              <div className="info">
                A session reserves the theatre and responsible surgeon for its whole time slot, even
                before patients are booked. Availability is checked across all departments in this
                hospital.
              </div>
              <div className="form-grid">
                <Field label="Date">
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={sessionDate ?? saDay(current)}
                  />
                </Field>
                <Field label="Theatre">
                  <select name="theatre">
                    {w.hospital.theatres.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Start time (SAST)">
                  <input name="start" type="time" required defaultValue="08:00" />
                </Field>
                <Field label="End time (SAST)">
                  <input name="end" type="time" required defaultValue="13:00" />
                </Field>
                <Field label="Responsible surgeon">
                  <select name="surgeon">
                    {w.hospital.surgeons.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </>
          )}
          {kind === 'book' && (
            <>
              <Field
                label="Estimated operating time (minutes)"
                hint={`Enter the expected surgery time. A separate ${turnover}-minute turnover is reserved after it for cleaning, resetting and anaesthetic preparation.`}
              >
                <input
                  name="duration"
                  type="number"
                  min="5"
                  max="720"
                  required
                  value={estimate}
                  onChange={(e) => {
                    setEstimate(e.target.value);
                    setSelected('');
                  }}
                  placeholder="e.g. 60"
                />
              </Field>
              <Field
                label="Available theatre session"
                hint="Only upcoming sessions with enough uninterrupted space for the surgery and turnover are shown."
              >
                <select
                  name="sessionId"
                  required
                  disabled={!availableSessions.length}
                  value={selected}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  <option value="">
                    {estimate ? 'Choose an available session' : 'Enter operating time first'}
                  </option>
                  {availableSessions.map(({ session, start }) => (
                    <option value={session.id} key={session.id}>
                      {date(start)} · {session.theatre} · {time(start)}–
                      {time(new Date(+new Date(start) + estimateMinutes * 60000).toISOString())} ·{' '}
                      {session.surgeon}
                    </option>
                  ))}
                </select>
              </Field>
              {estimateMinutes >= 5 && estimateMinutes <= 720 && !availableSessions.length && (
                <div className="info">
                  <Clock size={17} />
                  <span>
                    No upcoming session has enough uninterrupted space for this estimate and
                    turnover. Create another session or enter a revised clinical estimate.
                  </span>
                </div>
              )}
              {selectedSlot && (
                <div className="info">
                  <Clock size={17} />
                  <span>
                    Surgery will be planned for {time(selectedSlot.start)}–
                    {time(
                      new Date(
                        +new Date(selectedSlot.start) + estimateMinutes * 60000,
                      ).toISOString(),
                    )}
                    . Turnover is reserved until{' '}
                    {time(
                      new Date(
                        +new Date(selectedSlot.start) + (estimateMinutes + turnover) * 60000,
                      ).toISOString(),
                    )}
                    . The server assigns the first available slot again when you confirm, so two
                    people cannot take the same space.
                  </span>
                </div>
              )}
            </>
          )}
          {['start', 'complete', 'cancel'].includes(kind) && (
            <>
              <Field label="When did this happen? (SAST)">
                <input
                  name="occurredAt"
                  type="datetime-local"
                  required
                  defaultValue={inputTime()}
                  max={inputTime()}
                />
              </Field>
              {kind !== 'cancel' && (
                <Field label="Operational note (optional)">
                  <textarea name="reason" maxLength={1000} rows={2} />
                </Field>
              )}
              <div className="info">
                <Save size={17} />
                <span>
                  When connected, this saves directly to the hospital workspace. During an outage,
                  it is saved securely on this device and sent when the connection returns.
                </span>
              </div>
            </>
          )}
        </fieldset>
        {attempted && (
          <div className="info">
            Confirmation is pending. Retry checks the same submitted request; your entered values
            are retained.
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            <AlertCircle size={16} />
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} />
            {busy
              ? 'Saving…'
              : attempted
                ? 'Retry confirmation'
                : kind === 'book'
                  ? 'Confirm booking'
                  : kind === 'register'
                    ? 'Add patient and case'
                    : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PrioritySelect({ value }: { value: Priority | '' }) {
  return (
    <select name="priority" required defaultValue={value}>
      {value === '' && <option value="">Select the doctor’s recorded priority</option>}
      <option value="P1">P1 · up to 30 days</option>
      <option value="P2">P2 · 31–90 days</option>
      <option value="P3">P3 · 91–365 days</option>
    </select>
  );
}
function ReadinessSelect({ value }: { value: SurgicalCase['readiness'] }) {
  return (
    <select name="readiness" defaultValue={value}>
      <option>Needs assessment</option>
      <option>Not ready</option>
      <option>Ready</option>
    </select>
  );
}
