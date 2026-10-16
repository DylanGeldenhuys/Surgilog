import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, DoorOpen, Plus, RefreshCw, Users } from 'lucide-react';
import { api } from './firebase.ts';
import { Empty, Field, Modal } from './ui.tsx';
import {
  canConfigure,
  turnaroundMinutes,
  canManageUsers,
  effectiveMembership,
  roleLabels,
  type Membership,
  type Role,
} from '../../shared/domain.ts';
import {
  allowedRoles,
  assignableRoles,
  adminOperationSchema,
  type AdminWorkspace,
  type AdminOperation,
  type AdminResult,
  type AdminUser,
} from '../../shared/admin.ts';

type FormKind =
  'theatre-settings' | 'hospital' | 'department' | 'theatre' | 'user-create' | 'user-access';
export function Admin({ onChanged }: { onChanged: () => Promise<void> }) {
  const [data, setData] = useState<AdminWorkspace | null>(null),
    [error, setError] = useState(''),
    [hospitalId, setHospital] = useState(''),
    [form, setForm] = useState<FormKind | null>(null),
    [target, setTarget] = useState<AdminUser | undefined>(),
    [result, setResult] = useState<AdminResult | null>(null),
    [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await api<AdminWorkspace>('/api/admin'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const hospital = data?.hospitals.find((h) => h.id === hospitalId) ?? data?.hospitals[0],
    role = hospital && data ? effectiveMembership(data.profile, hospital)?.role : undefined,
    configure = !!data?.profile.superUser || (!!role && canConfigure(role)),
    manage = !!data?.profile.superUser || (!!role && canManageUsers(role)),
    users =
      data?.users.filter((u) =>
        hospital
          ? u.superUser || u.memberships.some((m) => m.hospitalId === hospital.id)
          : u.superUser,
      ) ?? [];
  async function submit(op: AdminOperation) {
    const saved = await api<AdminResult>('/api/admin/operations', op);
    setResult(saved);
    setForm(null);
    setTarget(undefined);
    if (op.type === 'hospital') setHospital(op.data.hospitalId);
    await load();
    // A confirmed mutation stays successful even if the following refresh loses connectivity.
    await onChanged().catch(() =>
      setError('Saved to the server. Refresh the workspace when connected.'),
    );
  }
  const open = (kind: FormKind, user?: AdminUser) => {
    setTarget(user);
    setForm(kind);
    setResult(null);
  };
  return (
    <div className="admin-page">
      <div className="admin-toolbar">
        <p>
          Manage hospitals, departments, theatres and staff access. Changes require an internet
          connection.
        </p>
        <button className="button" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={16} />
          Refresh
        </button>
        {data?.profile.superUser && (
          <button className="button primary" onClick={() => open('hospital')}>
            <Plus size={16} />
            Add hospital
          </button>
        )}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      {result && (
        <div className="panel admin-result" role="status">
          <strong>Saved to the server.</strong>
          {result.setupLink ? (
            <>
              <p>
                The new user can choose their password using this private setup link. Share it only
                with that person.
              </p>
              <input aria-label="New user password setup link" readOnly value={result.setupLink} />
              <button
                className="button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(result.setupLink!)
                    .catch(() => setError('Select and copy the setup link manually.'))
                }
              >
                Copy setup link
              </button>
            </>
          ) : (
            <p>
              The workspace is updated. New users can use “Set or reset password” on sign-in if they
              still need to choose a password.
            </p>
          )}
          <button className="text-button" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}
      {data && (
        <>
          {hospital ? (
            <>
              <div className="context-bar">
                <Field label="Admin hospital">
                  <select value={hospital.id} onChange={(e) => setHospital(e.target.value)}>
                    {data.hospitals.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <span>{role ? roleLabels[role] : ''}</span>
              </div>
              <div className="admin-grid">
                <section className="panel">
                  <div className="admin-panel-head">
                    <h2>
                      <Building2 size={20} />
                      Departments
                    </h2>
                    {configure && (
                      <button className="button" onClick={() => open('department')}>
                        <Plus size={15} />
                        Add department
                      </button>
                    )}
                  </div>
                  {hospital.departments.length ? (
                    <ul className="admin-list">
                      {hospital.departments.map((d) => (
                        <li key={d.id}>{d.name}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>Add the first department to start a surgical backlog.</p>
                  )}
                </section>
                <section className="panel">
                  <div className="admin-panel-head">
                    <h2>
                      <DoorOpen size={20} />
                      Theatres
                    </h2>
                    {configure && (
                      <button className="button" onClick={() => open('theatre')}>
                        <Plus size={15} />
                        Add theatre
                      </button>
                    )}
                  </div>
                  {hospital.theatres.length ? (
                    <ul className="admin-list">
                      {hospital.theatres.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  ) : (
                    <p>No theatres configured yet.</p>
                  )}
                  <p className="admin-hint">
                    Theatre sessions are planned in Theatre planning. Add Day Theatre or ICU here
                    when used as operating locations.
                  </p>
                  <p>
                    <strong>
                      Booking turnaround allowance: {turnaroundMinutes(hospital)} minutes
                    </strong>
                  </p>
                  <p className="admin-hint">
                    Reserved after each new booking for cleaning, reset and anaesthetic preparation.
                    Existing bookings keep their saved allowance. Actual gaps are measured
                    separately.
                  </p>
                  {configure && (
                    <button className="button" onClick={() => open('theatre-settings')}>
                      Set turnaround time
                    </button>
                  )}
                </section>
              </div>
            </>
          ) : (
            <Empty
              title="Add your first hospital"
              detail="Then add its departments, theatres and staff."
            />
          )}
          <section className="panel no-pad">
            <div className="admin-panel-head admin-pad">
              <h2>
                <Users size={20} />
                Staff and access
              </h2>
              {manage && (
                <div className="admin-actions">
                  <button className="button" onClick={() => open('user-access')}>
                    Add existing user access
                  </button>
                  <button className="button primary" onClick={() => open('user-create')}>
                    <Plus size={16} />
                    Add new user
                  </button>
                </div>
              )}
            </div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Departments</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => {
                    const m = u.memberships.find((m) => m.hospitalId === hospital?.id),
                      editable =
                        manage &&
                        u.uid !== data.profile.uid &&
                        (!u.superUser || data.profile.superUser) &&
                        (!m || data.profile.superUser || allowedRoles(role!).includes(m.role));
                    return (
                      <tr key={u.uid}>
                        <td>{u.name}</td>
                        <td>{u.email}</td>
                        <td>{u.superUser ? 'Super User' : m ? roleLabels[m.role] : ''}</td>
                        <td>
                          {u.superUser || m?.departments.includes('*')
                            ? 'All departments'
                            : m?.departments
                                .map(
                                  (id) =>
                                    hospital?.departments.find((d) => d.id === id)?.name ?? id,
                                )
                                .join(', ')}
                        </td>
                        <td>
                          {editable ? (
                            <button className="button" onClick={() => open('user-access', u)}>
                              Edit access
                            </button>
                          ) : (
                            <span>View only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!users.length && (
              <Empty
                title="No staff assigned yet"
                detail="Add a user and select the departments they can access."
              />
            )}
          </section>
          <section className="panel">
            <h2>Roles at a glance</h2>
            <dl className="admin-role-guide">
              <dt>Super User</dt>
              <dd>All hospitals and departments; all configuration, staff and clinical actions.</dd>
              <dt>Major User</dt>
              <dd>
                Selected hospitals and departments. Write access includes configuration, staff and
                clinical actions; read access cannot make changes.
              </dd>
              <dt>System Admin</dt>
              <dd>One hospital and all its departments. Available as write or read only.</dd>
              <dt>Doctor</dt>
              <dd>Clinical work and doctors, nurses and clerks within assigned departments.</dd>
              <dt>Nurse / Clerk</dt>
              <dd>
                Register patients, edit patient details and notes, and record surgery start/end.
                Priority changes, booking and cancellation require a doctor or write admin.
              </dd>
            </dl>
          </section>
        </>
      )}
      {form && data && (
        <AdminForm
          key={`${form}/${target?.uid ?? 'new'}`}
          kind={form}
          data={data}
          hospitalId={hospital?.id ?? ''}
          target={target}
          onClose={() => setForm(null)}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function AdminForm({
  kind,
  data,
  hospitalId,
  target,
  onClose,
  onSubmit,
}: {
  kind: FormKind;
  data: AdminWorkspace;
  hospitalId: string;
  target?: AdminUser;
  onClose: () => void;
  onSubmit: (op: AdminOperation) => Promise<void>;
}) {
  const initial = target?.memberships.find((m) => m.hospitalId === hospitalId);
  const legacyRole = !!initial && !assignableRoles.some((role) => role === initial.role);
  const [role, setRole] = useState<Role | ''>(
      target?.superUser ? 'super_user' : legacyRole ? '' : (initial?.role ?? 'doctor'),
    ),
    [grants, setGrants] = useState<Membership[]>(initial && !legacyRole ? [initial] : []),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [attempted, setAttempted] = useState<AdminOperation | null>(null),
    [remove, setRemove] = useState(false);
  const userForm = kind === 'user-create' || kind === 'user-access';
  const availableRoles = assignableRoles.filter(
    (r) =>
      data.profile.superUser ||
      data.hospitals.some((h) => {
        const scope = effectiveMembership(data.profile, h);
        return scope && allowedRoles(scope.role).includes(r);
      }),
  );
  const availableHospitals = data.hospitals.filter((h) => {
    const scope = effectiveMembership(data.profile, h);
    return !!role && (data.profile.superUser || (scope && allowedRoles(scope.role).includes(role)));
  });
  const hospital = data.hospitals.find((h) => h.id === hospitalId);
  const titles = {
    'theatre-settings': 'Theatre settings',
    hospital: 'Add hospital',
    department: 'Add department',
    theatre: 'Add theatre',
    'user-create': 'Add new user',
    'user-access': target ? 'Edit staff access' : 'Add existing user access',
  };
  function updateGrant(id: string, deps: string[]) {
    if (!role) return;
    setGrants((previous) => [
      ...previous.filter((m) => m.hospitalId !== id),
      ...(deps.length ? [{ hospitalId: id, role, departments: deps }] : []),
    ]);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget),
      get = (key: string) => String(values.get(key) ?? '').trim();
    try {
      let op = attempted;
      if (!op) {
        const id = crypto.randomUUID();
        if (kind === 'hospital')
          op = {
            id,
            type: kind,
            data: {
              hospitalId: crypto.randomUUID(),
              name: get('name'),
              city: get('city'),
              province: get('province'),
              district: get('district'),
            },
          };
        else if (kind === 'department')
          op = {
            id,
            type: kind,
            data: {
              hospitalId,
              departmentId: crypto.randomUUID(),
              name: get('name'),
              version: hospital?.version ?? 1,
            },
          };
        else if (kind === 'theatre-settings')
          op = {
            id,
            type: kind,
            data: {
              hospitalId,
              version: hospital?.version ?? 1,
              turnaroundMinutes: Number(get('turnaroundMinutes')),
            },
          };
        else if (kind === 'theatre')
          op = {
            id,
            type: kind,
            data: { hospitalId, name: get('name'), version: hospital?.version ?? 1 },
          };
        else {
          if (!remove && role !== 'super_user' && !grants.length)
            throw new Error('Choose at least one hospital and department.');
          const scope = {
            superUser: role === 'super_user',
            memberships: role === 'super_user' || remove ? [] : grants,
          };
          const email = get('email').toLowerCase();
          if (kind === 'user-create')
            op = adminOperationSchema.parse({
              id,
              type: kind,
              data: { name: get('name'), email, ...scope },
            });
          else
            op = adminOperationSchema.parse({
              id,
              type: kind,
              data: {
                email,
                version:
                  target?.version ??
                  data.users.find((u) => u.email.toLowerCase() === email)?.version ??
                  0,
                ...scope,
                ...(remove ? { removeHospitalId: hospitalId } : {}),
              },
            });
        }
        setAttempted(op);
      }
      await onSubmit(op);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status && status < 500) setAttempted(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={titles[kind]}
      subtitle={userForm ? 'Choose only the access this person needs.' : hospital?.name}
      onClose={onClose}
      wide={userForm}
    >
      <form className="modal-body" onSubmit={submit}>
        <fieldset disabled={busy || !!attempted}>
          {kind !== 'theatre-settings' && (!userForm || kind === 'user-create') && (
            <Field
              label={
                userForm
                  ? 'Full name'
                  : kind === 'theatre'
                    ? 'Theatre name'
                    : kind === 'department'
                      ? 'Department name'
                      : 'Hospital name'
              }
            >
              <input name="name" required minLength={2} maxLength={160} />
            </Field>
          )}
          {kind === 'theatre-settings' && (
            <Field
              label="Turnaround allowance (minutes)"
              hint="15–30 minutes. Applies to new bookings only."
            >
              <input
                name="turnaroundMinutes"
                type="number"
                min={15}
                max={30}
                step={1}
                required
                defaultValue={hospital ? turnaroundMinutes(hospital) : 15}
              />
            </Field>
          )}
          {kind === 'hospital' && (
            <div className="form-grid">
              {[
                ['city', 'City'],
                ['province', 'Province'],
                ['district', 'District'],
              ].map(([key, label]) => (
                <Field key={key} label={label}>
                  <input name={key} required minLength={2} maxLength={160} />
                </Field>
              ))}
            </div>
          )}
          {userForm && (
            <>
              <Field label="Staff email">
                <input
                  type="email"
                  name="email"
                  required
                  defaultValue={target?.email}
                  readOnly={!!target}
                />
              </Field>
              {target && !target.superUser && (
                <label className="admin-check">
                  <input
                    type="checkbox"
                    checked={remove}
                    onChange={(e) => setRemove(e.target.checked)}
                  />
                  Remove access to this hospital
                </label>
              )}
              {!remove && (
                <>
                  <Field label="Role">
                    <select
                      required
                      value={role}
                      onChange={(e) => {
                        setRole(e.target.value as Role);
                        setGrants([]);
                      }}
                    >
                      {!role && <option value="">Choose the new role explicitly</option>}
                      {availableRoles.map((r) => (
                        <option key={r} value={r}>
                          {roleLabels[r]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {role === 'super_user' ? (
                    <p>
                      This grants write access to every hospital and department, including ones
                      added later.
                    </p>
                  ) : (
                    <div className="admin-scopes">
                      {availableHospitals.map((h) => {
                        const selected = grants.find((m) => m.hospitalId === h.id),
                          wide =
                            data.profile.superUser ||
                            data.profile.memberships.some(
                              (m) => m.hospitalId === h.id && m.departments.includes('*'),
                            ),
                          canAll =
                            wide &&
                            [
                              'major_write',
                              'major_read',
                              'system_admin_write',
                              'system_admin_read',
                            ].includes(role),
                          systemAdmin = role.startsWith('system_admin');
                        return (
                          <fieldset className="admin-scope" key={h.id}>
                            <legend>{h.name}</legend>
                            {canAll && (
                              <label className="admin-check">
                                <input
                                  type="checkbox"
                                  checked={selected?.departments.includes('*') ?? false}
                                  onChange={(e) => {
                                    if (systemAdmin && role)
                                      setGrants(
                                        e.target.checked
                                          ? [{ hospitalId: h.id, role, departments: ['*'] }]
                                          : [],
                                      );
                                    else updateGrant(h.id, e.target.checked ? ['*'] : []);
                                  }}
                                />
                                All departments, including future departments
                              </label>
                            )}
                            {!systemAdmin &&
                              !selected?.departments.includes('*') &&
                              h.departments.map((d) => (
                                <label className="admin-check" key={d.id}>
                                  <input
                                    type="checkbox"
                                    checked={selected?.departments.includes(d.id) ?? false}
                                    onChange={(e) =>
                                      updateGrant(
                                        h.id,
                                        e.target.checked
                                          ? [...(selected?.departments ?? []), d.id]
                                          : (selected?.departments ?? []).filter(
                                              (id) => id !== d.id,
                                            ),
                                      )
                                    }
                                  />
                                  {d.name}
                                </label>
                              ))}
                            {!h.departments.length && !canAll && (
                              <p>Add a department before assigning this role.</p>
                            )}
                          </fieldset>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
              {kind === 'user-create' && (
                <p>
                  A private password setup link is shown after the account is created. No email is
                  sent automatically.
                </p>
              )}
            </>
          )}
        </fieldset>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : attempted ? 'Retry save' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
