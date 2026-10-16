import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Upload } from 'lucide-react';
import { csvHeader, parseTheatreCsv } from '../../shared/theatre-import.ts';
import {
  ageYears,
  canClinical,
  canRecord,
  operationSchema,
  saDay,
  type Operation,
  type Role,
  type Workspace,
} from '../../shared/domain.ts';
import {
  registerEntries,
  theatrePeriod,
  type TheatreEntry,
  type TheatreEntryInput,
} from '../../shared/theatre.ts';
import { date, time, Field, Modal, Empty, fromInput, inputTime } from './ui.tsx';
import { shouldHoldForRetry } from './sync-policy.ts';

type Props = { w: Workspace; role: Role; onSubmit: (op: Operation) => Promise<void> };
export function TheatreRegister({ w, role, onSubmit }: Props) {
  const range = theatrePeriod('Month', saDay(new Date()));
  const [from, setFrom] = useState(range.from),
    [to, setTo] = useState(range.to),
    [location, setLocation] = useState(''),
    [query, setQuery] = useState(''),
    [page, setPage] = useState(1),
    [form, setForm] = useState<TheatreEntry | 'new' | null>(null),
    [importing, setImporting] = useState(false);
  const rows = registerEntries(w).filter(
    (e) =>
      e.operationDate >= from &&
      e.operationDate <= to &&
      (!location || e.theatre === location) &&
      `${e.patientName} ${e.patientRef} ${e.procedures.join(' ')}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => setPage(1), [from, to, location, query]);
  const pages = Math.max(1, Math.ceil(rows.length / 10)),
    current = Math.min(page, pages);
  return (
    <section className="register-page">
      <div className="register-toolbar">
        <p>
          Actual operations, including completed bookings and historical entries. Drafts stay out of
          executive totals until verified.
        </p>
        {canRecord(role) && (
          <div className="inline-actions">
            <button className="button" onClick={() => setImporting(true)}>
              <Upload size={16} />
              Import register CSV
            </button>
            <button className="button primary" onClick={() => setForm('new')}>
              <Plus size={16} />
              Record operation
            </button>
          </div>
        )}
      </div>
      <div className="register-filters">
        <Field label="From">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Operating location">
          <select value={location} onChange={(e) => setLocation(e.target.value)}>
            <option value="">All locations</option>
            {w.hospital.theatres.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        <Field label="Search register">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, reference or procedure"
          />
        </Field>
      </div>
      {w.theatreEntriesTruncated && (
        <div className="info">
          This device has the latest 500 register entries plus completed bookings. Reports query the
          selected period on the server.
        </div>
      )}
      {rows.length ? (
        <div className="panel no-pad">
          <div className="table-scroll">
            <table className="register-table">
              <thead>
                <tr>
                  <th>Operation date</th>
                  <th>Patient / reference</th>
                  <th>Age at operation</th>
                  <th>Location / ward</th>
                  <th>Procedures</th>
                  <th>Team</th>
                  <th>Actual theatre time</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((current - 1) * 10, current * 10).map((e) => (
                  <tr key={e.id}>
                    <td>{date(e.inAt)}</td>
                    <td>
                      <strong>{e.patientName}</strong>
                      <small>{e.patientRef}</small>
                    </td>
                    <td>
                      {e.dob
                        ? `${ageYears(e.dob, e.operationDate)} years`
                        : e.age === null
                          ? 'Not recorded'
                          : `${e.age} ${e.ageUnit}`}
                    </td>
                    <td>
                      {e.theatre}
                      <small>{e.ward || 'Ward not recorded'}</small>
                    </td>
                    <td>{e.procedures.join('; ')}</td>
                    <td>
                      {e.surgeon}
                      <small>Anaesthetist: {e.anaesthetist || 'Not recorded'}</small>
                    </td>
                    <td>
                      {time(e.inAt)}–{time(e.outAt)}
                      <small>
                        {Math.round((Date.parse(e.outAt) - Date.parse(e.inAt)) / 60000)} min
                        occupancy
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge ${e.status === 'Draft' ? 'pending-badge' : 'priority-P3'}`}
                      >
                        {e.status}
                      </span>
                      <small>{e.source}</small>
                    </td>
                    <td>
                      <button className="text-button" onClick={() => setForm(e)}>
                        View / edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="register-pagination">
            <span>
              {rows.length} operations · page {current} of {pages}
            </span>
            <button
              className="button"
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <button
              className="button"
              disabled={current === pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      ) : (
        <Empty
          title="No operations in this view"
          detail="Choose another period or record an operation. Completed bookings appear automatically."
        />
      )}
      {form && (
        <RegisterForm
          w={w}
          role={role}
          entry={form === 'new' ? undefined : form}
          onSubmit={onSubmit}
          onClose={() => setForm(null)}
        />
      )}
      {importing && (
        <RegisterImport w={w} onSubmit={onSubmit} onClose={() => setImporting(false)} />
      )}
    </section>
  );
}
function RegisterForm({
  w,
  role,
  entry,
  onSubmit,
  onClose,
}: Props & { entry?: TheatreEntry; onClose: () => void }) {
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<Operation | null>(null),
    [dob, setDob] = useState(entry?.dob ?? '');
  const linked = !!entry?.bookingId,
    editable = canRecord(role) && (!entry || entry.status === 'Draft' || canClinical(role));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      let op = attempt;
      if (!op) {
        const f = new FormData(event.currentTarget),
          get = (k: string) => String(f.get(k) ?? '').trim();
        const d: TheatreEntryInput = {
          entryId: entry?.id ?? crypto.randomUUID(),
          version: entry?.version ?? 0,
          departmentId: w.departmentId,
          bookingId: entry?.bookingId ?? null,
          patientRef: get('patientRef'),
          patientName: get('patientName'),
          dob,
          age: dob || get('age') === '' ? null : Number(get('age')),
          ageUnit: get('ageUnit') as TheatreEntryInput['ageUnit'],
          sex: get('sex') as TheatreEntryInput['sex'],
          admissionDate: get('admissionDate'),
          ward: get('ward'),
          theatre: get('theatre'),
          procedures: get('procedures')
            .split('\n')
            .map((p) => p.trim())
            .filter(Boolean),
          surgeon: get('surgeon'),
          assistant: get('assistant'),
          anaesthetist: get('anaesthetist'),
          inAt: linked ? entry!.inAt : fromInput(get('inAt')),
          outAt: linked ? entry!.outAt : fromInput(get('outAt')),
          status: canClinical(role) ? (get('status') as TheatreEntryInput['status']) : 'Draft',
          source: linked ? 'Booked surgery' : (get('source') as TheatreEntryInput['source']),
          sourceReference: get('sourceReference'),
          notes: get('notes'),
          reason: get('reason'),
        };
        op = operationSchema.parse({
          id: crypto.randomUUID(),
          type: 'theatre-entry',
          recordedAt: new Date().toISOString(),
          occurredAt: d.outAt,
          data: d,
        });
        setAttempt(op);
      }
      await onSubmit(op);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      if (!shouldHoldForRetry((e as { status?: number }).status)) setAttempt(null);
    } finally {
      setBusy(false);
    }
  }
  const start = entry?.inAt ?? new Date(Date.now() - 3600000).toISOString(),
    end = entry?.outAt ?? new Date().toISOString();
  return (
    <Modal
      title={entry ? 'Operation register details' : 'Record an operation'}
      subtitle={
        w.hospital.name + ' · ' + w.hospital.departments.find((d) => d.id === w.departmentId)?.name
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <form onSubmit={submit} className="operation-form">
        <p className="info">
          {linked
            ? 'Linked to a completed booking. Patient identity, location and actual timings come from that booking.'
            : 'Record actual activity here. This does not create a backlog case or a booking.'}
        </p>
        <fieldset disabled={busy || !!attempt || !editable}>
          <div className="form-grid">
            <Field label="Patient reference">
              <input
                name="patientRef"
                required
                maxLength={160}
                defaultValue={entry?.patientRef}
                readOnly={linked}
              />
            </Field>
            <Field label="Patient name">
              <input
                name="patientName"
                required
                maxLength={160}
                defaultValue={entry?.patientName}
                readOnly={linked}
              />
            </Field>
            <Field label="Date of birth (if known)">
              <input
                type="date"
                name="dob"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                readOnly={linked}
              />
            </Field>
            <Field
              label="Recorded age at operation"
              hint="Leave blank if unknown. No approximate DOB is created."
            >
              <input
                name="age"
                type="number"
                min={0}
                max={130}
                disabled={!!dob}
                defaultValue={entry?.age ?? ''}
              />
            </Field>
            <Field label="Age unit">
              <select name="ageUnit" defaultValue={entry?.ageUnit ?? 'years'}>
                <option>years</option>
                <option>months</option>
                <option>days</option>
              </select>
            </Field>
            <Field label="Sex recorded in register">
              <select name="sex" defaultValue={entry?.sex ?? 'Not recorded'}>
                <option>Not recorded</option>
                <option>Female</option>
                <option>Male</option>
              </select>
            </Field>
            <Field label="Admission date (if known)">
              <input type="date" name="admissionDate" defaultValue={entry?.admissionDate} />
            </Field>
            <Field label="Ward">
              <input name="ward" maxLength={160} defaultValue={entry?.ward} />
            </Field>
            <Field label="Operating location">
              {linked ? (
                <input name="theatre" readOnly value={entry!.theatre} />
              ) : (
                <select name="theatre" required defaultValue={entry?.theatre ?? ''}>
                  <option value="">Choose location</option>
                  {w.hospital.theatres.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Source">
              {linked ? (
                <input readOnly value="Booked surgery" />
              ) : (
                <select name="source" defaultValue={entry?.source ?? 'Manual entry'}>
                  <option>Manual entry</option>
                  <option>Historical register</option>
                </select>
              )}
            </Field>
            <Field label="Actual theatre entry (SAST)">
              <input
                name="inAt"
                type="datetime-local"
                required
                defaultValue={inputTime(start)}
                readOnly={linked}
              />
            </Field>
            <Field label="Actual theatre exit (SAST)">
              <input
                name="outAt"
                type="datetime-local"
                required
                defaultValue={inputTime(end)}
                readOnly={linked}
              />
            </Field>
            <Field label="Surgeon">
              <input
                name="surgeon"
                list="register-surgeons"
                required
                maxLength={160}
                defaultValue={entry?.surgeon}
              />
              <datalist id="register-surgeons">
                {w.hospital.surgeons.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </Field>
            <Field label="Assistant">
              <input name="assistant" maxLength={160} defaultValue={entry?.assistant} />
            </Field>
            <Field label="Anaesthetist">
              <input name="anaesthetist" maxLength={160} defaultValue={entry?.anaesthetist} />
            </Field>
            <Field
              label="Verification"
              hint={
                canClinical(role)
                  ? 'Only verified entries contribute to executive totals.'
                  : 'A doctor or write administrator verifies draft entries.'
              }
            >
              <select
                name="status"
                defaultValue={entry?.status ?? 'Draft'}
                disabled={!canClinical(role) || linked}
              >
                <option>Draft</option>
                <option>Verified</option>
              </select>
              {linked && <input type="hidden" name="status" value="Verified" />}
            </Field>
          </div>
          <Field
            label="Actual procedures"
            hint="One procedure per line. One operation may contain several procedures."
          >
            <textarea
              name="procedures"
              required
              rows={3}
              defaultValue={entry?.procedures.join('\n')}
            />
          </Field>
          <Field
            label="Source reference"
            hint="Optional register/page/row reference for later checking."
          >
            <input name="sourceReference" maxLength={240} defaultValue={entry?.sourceReference} />
          </Field>
          <Field label="Notes">
            <textarea name="notes" rows={2} maxLength={2000} defaultValue={entry?.notes} />
          </Field>
          <Field label="Reason for recording or changing this entry">
            <input name="reason" required minLength={3} maxLength={1000} />
          </Field>
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" disabled={busy} onClick={onClose}>
            Close
          </button>
          {editable && (
            <button className="button primary" disabled={busy}>
              {busy ? 'Saving…' : attempt ? 'Retry confirmation' : 'Save register entry'}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}

function RegisterImport({ w, onSubmit, onClose }: Omit<Props, 'role'> & { onClose: () => void }) {
  const [text, setText] = useState(csvHeader + '\n'),
    [ops, setOps] = useState<Operation[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [done, setDone] = useState(0),
    [busy, setBusy] = useState(false);
  function preview() {
    const result = parseTheatreCsv(text, w.departmentId, w.hospital.theatres);
    setOps(result.operations);
    setErrors(result.errors);
    setDone(0);
  }
  async function save() {
    setBusy(true);
    setErrors([]);
    try {
      for (let i = done; i < ops.length; i++) {
        await onSubmit(ops[i]);
        setDone(i + 1);
      }
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Import historical theatre register"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <div className="operation-form">
        <p>
          Paste CSV with the header below. Dates: DD/MM/YYYY or YYYY-MM-DD; times: HH:MM in SAST.
          Separate multiple procedures with semicolons. Every imported row is a draft for clinical
          verification.
        </p>
        <Field label="Register CSV">
          <textarea
            rows={8}
            value={text}
            disabled={busy || done > 0}
            onChange={(e) => {
              setText(e.target.value);
              setOps([]);
              setDone(0);
            }}
          />
        </Field>
        <button className="button" disabled={busy || done > 0} onClick={preview}>
          Preview import
        </button>
        {errors.map((e, i) => (
          <div className="error" role="alert" key={i}>
            {e}
          </div>
        ))}
        {ops.length > 0 && (
          <>
            <p>
              {ops.length} draft entries · {done} saved or queued
            </p>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Patient reference</th>
                    <th>Operation</th>
                    <th>Location</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.map(
                    (o) =>
                      o.type === 'theatre-entry' && (
                        <tr key={o.id}>
                          <td>{o.data.patientRef}</td>
                          <td>{o.data.procedures.join('; ')}</td>
                          <td>{o.data.theatre}</td>
                        </tr>
                      ),
                  )}
                </tbody>
              </table>
            </div>
            <button
              className="button primary"
              disabled={busy || done === ops.length}
              onClick={() => void save()}
            >
              {busy ? 'Importing…' : done === ops.length ? 'Import saved' : 'Save draft entries'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
