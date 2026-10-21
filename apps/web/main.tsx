import { TheatreRegister } from './TheatreRegister.tsx';
import { TheatreReports } from './TheatreReports.tsx';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  CloudCheck,
  CloudOff,
  FileUp,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Users,
  X,
  TriangleAlert,
  HeartPulse,
  ClipboardList,
  SlidersHorizontal,
  BarChart3,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import Papa from 'papaparse';
import { caseFromCsv } from '../../shared/csv-import.ts';
import { UpdateNotice } from './UpdateNotice.tsx';
import { WorkspaceSession } from './WorkspaceSession.tsx';
import type { SessionEnd } from './session-policy.ts';
import { Admin } from './Admin.tsx';
import { OperationForm, type FormKind } from './Forms.tsx';
import {
  Brand,
  PriorityBadge,
  Status,
  Empty,
  Modal,
  Metric,
  SectionTitle,
  LinkButton,
  date,
  time,
} from './ui.tsx';
import { useWorkspace, projected, reportingCacheKey } from './state.ts';
import { auth, api } from './firebase.ts';
import { isLocalDemo } from './config.ts';
import { type Vault } from './vault.ts';
import {
  canClinical,
  canEditPatient,
  canViewAdmin,
  roleLabels,
  canSchedule,
  canRecord,
  waitDays,
  isOutstanding,
  backlogOrder,
  bookingNeedsOutcome,
  caseNeedsAttention,
  nextOperatingSlot,
  TURNOVER_MINUTES,
  turnaroundMinutes,
  saDay,
  compareInstants,
  ageYears,
  diagnosisLabel,
  type Workspace,
  type Metrics,
  type ReportingWorkspace,
  type ReportingDepartmentSelection,
  type SurgicalCase,
  type Operation,
  type Audit,
  type Role,
  type NewCase,
  type Pending,
  type Profile,
  type ReportingRole,
} from '../../shared/domain.ts';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-800.css';
import './styles.css';

type Page = 'register' | 'overview' | 'backlog' | 'theatres' | 'reports' | 'sync' | 'admin';
const BACKLOG_PAGE_SIZE = 10;
const navigation = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'backlog', label: 'Surgical backlog', icon: Users },
  { id: 'theatres', label: 'Theatre planning', icon: CalendarDays },
  { id: 'register', label: 'Theatre register', icon: ClipboardList },
  { id: 'reports', label: 'Performance', icon: BarChart3 },
  { id: 'admin', label: 'Admin', icon: ShieldCheck },
  { id: 'sync', label: 'Saved activity', icon: CloudCheck },
] as const;
const reportingRoleLabels: Record<ReportingRole, string> = {
  global_viewer: 'Global viewer',
  regional_viewer: 'Regional viewer',
  country_viewer: 'Country viewer',
  state_viewer: 'State / province viewer',
  district_viewer: 'District viewer',
};
function profileRoleLabel(profile: Profile, role?: Role) {
  if (profile.superUser) return 'Super User';
  if (role) return roleLabels[role];
  const reportingRole = profile.reportingGrants?.[0]?.role;
  return reportingRole ? reportingRoleLabels[reportingRole] : 'Reporting viewer';
}
function App() {
  return (
    <WorkspaceSession>
      {(vault, end) => <WorkspaceApp initial={vault} onEnd={end} />}
    </WorkspaceSession>
  );
}
function WorkspaceApp({ initial, onEnd }: { initial: Vault; onEnd: (reason: SessionEnd) => void }) {
  const state = useWorkspace(initial, onEnd),
    { data } = state;
  const reportingAccess = data.reportingAccess?.length
      ? data.reportingAccess
      : data.profile.memberships.map((membership) => ({
          hospitalId: membership.hospitalId,
          departments: membership.departments,
        })),
    initialMembership =
      data.profile.memberships.find((m) => m.departments.length) ?? data.profile.memberships[0],
    initialHospitalId = initialMembership?.hospitalId ?? reportingAccess[0]?.hospitalId ?? '',
    initialHospital = data.hospitals.find((item) => item.id === initialHospitalId),
    initialDepartment =
      initialMembership?.departments[0] ??
      reportingAccess.find((item) => item.hospitalId === initialHospitalId)?.departments[0] ??
      initialHospital?.departments[0]?.id ??
      '',
    initialReportingHospital = initialHospitalId,
    initialReportingDepartment = initialDepartment;
  const [hospitalId, setHospital] = useState(initialHospitalId),
    [dep, setDep] = useState(initialDepartment),
    [reportHospitalId, setReportHospital] = useState(initialReportingHospital),
    [reportDepartmentId, setReportDepartment] = useState(initialReportingDepartment),
    [scopeGate, setScopeGate] = useState(false),
    [page, setPage] = useState<Page>(initialDepartment ? 'overview' : 'admin'),
    [sidebar, setSidebar] = useState(false),
    [query, setQuery] = useState(''),
    [priority, setPriority] = useState('All'),
    [status, setStatus] = useState('Current backlog'),
    [backlogPage, setBacklogPage] = useState(1),
    [selected, setSelected] = useState<string | null>(null),
    [form, setForm] = useState<FormKind | null>(null),
    [theatreDay, setTheatreDay] = useState(saDay(new Date())),
    [importOpen, setImport] = useState(false),
    [loadError, setLoadError] = useState(''),
    [reportError, setReportError] = useState('');
  const membership = data.profile.memberships.find((m) => m.hospitalId === hospitalId),
    adminAccess =
      !!data.profile.superUser || data.profile.memberships.some((m) => canViewAdmin(m.role)),
    hasOperationalAccess = data.profile.memberships.some(
      (m) => m.departments.length && m.role !== 'viewer',
    ),
    role: Role = membership?.role ?? 'viewer',
    hospital = data.hospitals.find((h) => h.id === hospitalId),
    reportingPage = page === 'overview' || page === 'reports',
    reportHospitals = [reportHospitalId],
    reportDepartments: ReportingDepartmentSelection[] = [
      { hospitalId: reportHospitalId, departmentId: reportDepartmentId },
    ],
    reportKey = reportingCacheKey(reportHospitals, reportDepartments),
    report = data.reporting?.[reportKey] ?? null,
    networkHospitals = reportingAccess
      .filter((item) => item.departments.length)
      .map((item) => item.hospitalId),
    networkDepartments: ReportingDepartmentSelection[] = reportingAccess.flatMap((item) =>
      item.departments.map((departmentId) => ({ hospitalId: item.hospitalId, departmentId })),
    ),
    networkKey = reportingCacheKey(networkHospitals, networkDepartments),
    networkReport = data.reporting?.[networkKey] ?? null,
    reportingHospital = data.hospitals.find((item) => item.id === reportHospitalId)!,
    reportingGrant = reportingAccess.find((item) => item.hospitalId === reportHospitalId)!,
    reportingDepartment = reportingHospital?.departments.find(
      (item) => item.id === reportDepartmentId,
    )!,
    dashboardMetrics = report?.metrics;
  const stored = data.workspaces[`${hospitalId}/${dep}`],
    w = useMemo(
      () => (stored ? (role === 'viewer' ? stored : projected(stored, data.pending)) : null),
      [stored, data.pending, role],
    );
  const current = w?.cases.find((c) => c.id === selected),
    pending = data.pending.filter((p) => p.status !== 'resolved'),
    reportWorkspace = reportHospitalId === hospitalId && reportDepartmentId === dep ? w : null,
    canViewSelectedDetails = Boolean(reportWorkspace && role !== 'viewer');
  const attentionCases = useMemo(() => {
      if (!reportWorkspace) return [];
      const now = new Date().toISOString();
      return reportWorkspace.cases
        .filter((c) => caseNeedsAttention(c, reportWorkspace.bookings, now))
        .sort((a, b) => {
          const attentionAt = (c: SurgicalCase) =>
            Math.min(
              +new Date(c.dueAt),
              ...reportWorkspace.bookings
                .filter((booking) => booking.caseId === c.id && bookingNeedsOutcome(booking, now))
                .map((booking) => +new Date(booking.end)),
            );
          return attentionAt(a) - attentionAt(b);
        });
    }, [reportWorkspace]),
    nextOrSlot = useMemo(
      () =>
        reportWorkspace
          ? nextOperatingSlot(
              reportWorkspace.sessions,
              reportWorkspace.bookings,
              undefined,
              turnaroundMinutes(reportWorkspace.hospital),
            )
          : null,
      [reportWorkspace],
    );
  const selectReportingScope = (nextHospitalId: string, nextDepartmentId?: string) => {
    if (!reportingAccess.find((item) => item.hospitalId === nextHospitalId)?.departments.length) {
      if (adminAccess) setPage('admin');
      return;
    }
    const grant = reportingAccess.find((item) => item.hospitalId === nextHospitalId)!,
      departmentId =
        nextDepartmentId && grant.departments.includes(nextDepartmentId)
          ? nextDepartmentId
          : grant.departments[0],
      operationalGrant = data.profile.memberships.find(
        (item) => item.hospitalId === nextHospitalId,
      );
    setReportHospital(nextHospitalId);
    setReportDepartment(departmentId);
    if (operationalGrant?.departments.includes(departmentId)) {
      setHospital(nextHospitalId);
      setDep(departmentId);
    }
    setSelected(null);
  };
  const navigate = (p: Page) => {
    if (p === 'admin' && !adminAccess) return;
    if (!hasOperationalAccess && (p === 'backlog' || p === 'theatres' || p === 'register')) return;
    const enteringOperational = p === 'backlog' || p === 'theatres' || p === 'register';
    setScopeGate(enteringOperational && reportingPage && !reportWorkspace);
    setPage(p);
    setSidebar(false);
    setSelected(null);
  };
  useEffect(() => {
    const operational = data.profile.memberships.find(
      (m) => m.departments.length && m.role !== 'viewer',
    );
    if (
      operational &&
      !data.profile.memberships.some(
        (m) => m.hospitalId === hospitalId && m.departments.includes(dep),
      )
    ) {
      setHospital(operational.hospitalId);
      setDep(operational.departments[0]);
      setSelected(null);
    }
    const reporting = reportingAccess.find((g) => g.departments.length);
    if (
      reporting &&
      !reportingAccess.some(
        (g) => g.hospitalId === reportHospitalId && g.departments.includes(reportDepartmentId),
      )
    ) {
      setReportHospital(reporting.hospitalId);
      setReportDepartment(reporting.departments[0]);
    }
  }, [
    data.profile.memberships,
    data.reportingAccess,
    hospitalId,
    dep,
    reportHospitalId,
    reportDepartmentId,
  ]);
  useEffect(() => {
    if (!membership || !membership.departments.includes(dep)) return;
    setLoadError('');
    void state.refresh(hospitalId, dep).catch((e) => setLoadError((e as Error).message));
  }, [hospitalId, dep, membership, state.refresh]);
  useEffect(() => {
    if (!reportingPage || !reportHospitalId || !reportDepartmentId) return;
    setReportError('');
    void state.refreshReporting(reportHospitals, reportDepartments).catch((error) => {
      if (!data.reporting?.[reportKey]) setReportError((error as Error).message);
    });
  }, [reportingPage, reportKey, state.refreshReporting]);
  useEffect(() => {
    if (page !== 'overview' || networkKey === reportKey || !networkDepartments.length) return;
    void state.refreshReporting(networkHospitals, networkDepartments).catch(() => {});
  }, [page, networkKey, reportKey, state.refreshReporting]);
  const act = async (op: Operation) => {
    await state.submit(hospitalId, op);
    if (op.type === 'session') setTheatreDay(op.data.date);
    if (['book', 'session'].includes(op.type)) {
      try {
        await state.refresh(hospitalId, dep);
      } catch {
        state.setMessage('Saved to the server. Refresh to update this device’s offline copy.');
      }
    }
  };
  const filtered = useMemo(
    () =>
      w?.cases
        .filter((c) => {
          const p = w.patients.find((p) => p.id === c.patientId);
          return (
            (status === 'All' ||
              (status === 'Current backlog' && isOutstanding(c)) ||
              (status === 'Requires action' && caseNeedsAttention(c, w.bookings)) ||
              status === c.status) &&
            (priority === 'All' || c.priority.startsWith(priority)) &&
            `${p?.name} ${p?.ref} ${c.procedure} ${c.diagnosis ?? ''} ${c.icd10?.code ?? ''} ${c.surgeon}`
              .toLowerCase()
              .includes(query.toLowerCase())
          );
        })
        .sort(backlogOrder) ?? [],
    [w, status, priority, query],
  );
  const backlogPages = Math.max(1, Math.ceil(filtered.length / BACKLOG_PAGE_SIZE)),
    activeBacklogPage = Math.min(backlogPage, backlogPages),
    backlogStart = (activeBacklogPage - 1) * BACKLOG_PAGE_SIZE,
    visibleBacklog = filtered.slice(backlogStart, backlogStart + BACKLOG_PAGE_SIZE);
  useEffect(() => {
    setBacklogPage(1);
  }, [hospitalId, dep, query, priority, status]);
  useEffect(() => {
    setBacklogPage((currentPage) => Math.min(currentPage, backlogPages));
  }, [backlogPages]);
  const openCase = (c: SurgicalCase) => setSelected(c.id);
  const pageTitle = {
    overview: 'A clearer view of your day.',
    backlog: 'Every patient, in focus.',
    theatres: 'Make time for better care.',
    reports: 'Progress you can measure.',
    register: 'Every operation, recorded.',
    sync: 'Your work, accounted for.',
    admin: 'Your hospitals. Your team.',
  }[page];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebar ? 'open' : ''}`}>
        <Brand />
        <div className="workspace-label">
          {hasOperationalAccess ? 'HOSPITAL WORKSPACE' : 'REPORTING WORKSPACE'}
        </div>
        <div className="hospital-card">
          <div className="hospital-icon">
            <HeartPulse size={20} />
          </div>
          <div>
            <strong>
              {reportingPage
                ? reportingHospital?.name
                : (hospital?.name ?? 'System administration')}
            </strong>
            <span>
              {reportingPage
                ? `${reportingDepartment?.name ?? 'Choose a department'} · ${reportingHospital?.city ?? ''}`
                : (hospital?.city ?? 'Hospitals and staff')}
            </span>
          </div>
        </div>
        <nav>
          {navigation
            .filter((item) => item.id !== 'admin' || adminAccess)
            .filter(
              (item) =>
                hasOperationalAccess || !['backlog', 'theatres', 'register'].includes(item.id),
            )
            .map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'active' : ''}
                onClick={() => navigate(n.id)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.id === 'sync' && pending.length > 0 ? (
                  <b>{pending.length}</b>
                ) : page === n.id ? (
                  <i />
                ) : null}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="pilot-note">
            <ShieldCheck size={18} />
            <div>
              <strong>{isLocalDemo ? 'Local pilot workspace' : 'Review workspace'}</strong>
              <p>Synthetic data · v0.1</p>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">
              {data.profile.name
                .replace(/^(Dr|Sr) /, '')
                .split(' ')
                .map((x) => x[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div>
              <strong>{data.profile.name}</strong>
              <span>{profileRoleLabel(data.profile, membership?.role)}</span>
            </div>
            <button
              className="button logout-button"
              onClick={() => onEnd('logout')}
              title="Log out and discard work that has not synced"
            >
              <LogOut size={17} /> Log out
            </button>
          </div>
        </div>
      </aside>
      {sidebar && (
        <button
          className="sidebar-backdrop"
          onClick={() => setSidebar(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setSidebar(true)}
            aria-label="Open navigation"
          >
            <Menu />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={13} />
            <strong>{navigation.find((n) => n.id === page)?.label}</strong>
          </div>
          <div className="topbar-right">
            <span className={`connection ${state.connection ? '' : 'offline'}`}>
              {state.connection ? <CloudCheck size={15} /> : <CloudOff size={15} />}
              <span>
                {state.busy
                  ? 'Syncing…'
                  : !state.connection
                    ? 'Offline'
                    : pending.length
                      ? `${pending.length} saved locally`
                      : 'Connected'}
              </span>
            </span>
            <span className="top-date">
              <CalendarDays size={15} />
              {date(new Date().toISOString())}
            </span>
          </div>
        </header>
        <main className="content">
          <div className="page-intro">
            <div>
              <div className="eyebrow">
                {page === 'overview'
                  ? 'YOUR AUTHORISED NETWORK AT A GLANCE'
                  : navigation.find((n) => n.id === page)?.label.toUpperCase()}
              </div>
              <h1>{pageTitle}</h1>
              <p>
                {page === 'overview'
                  ? 'The right information to keep your surgical team moving.'
                  : page === 'backlog'
                    ? 'Prioritise care, track readiness, and give every case a clear next step.'
                    : page === 'register'
                      ? 'Record actual operations and review your theatre activity.'
                      : page === 'theatres'
                        ? 'Plan capacity, organise your lists, and capture what actually happens.'
                        : page === 'reports'
                          ? 'Real activity. Clear definitions. A shared view of progress.'
                          : page === 'admin'
                            ? 'Configure your hospitals and give each team the right access.'
                            : 'Review pending entries and reconnect your team’s work.'}
              </p>
            </div>
            {page === 'backlog' && !scopeGate && canEditPatient(role) && (
              <button className="button primary" onClick={() => setForm('register')} disabled={!w}>
                <Plus size={17} />
                Add patient to backlog
              </button>
            )}
          </div>
          {page === 'overview' && (
            <HospitalOverview
              report={networkReport}
              hospitals={data.hospitals}
              access={reportingAccess}
              selectedHospitalId={reportHospitalId}
              onSelect={(selectedHospitalId) => selectReportingScope(selectedHospitalId)}
            />
          )}
          {reportingPage && reportingHospital && reportingGrant ? (
            <div className="context-bar reporting-context">
              <label>
                <span>Hospital</span>
                <select
                  aria-label="Hospital"
                  value={reportHospitalId}
                  onChange={(event) => selectReportingScope(event.target.value)}
                >
                  {data.hospitals
                    .filter((item) =>
                      reportingAccess.some(
                        (grant) => grant.hospitalId === item.id && grant.departments.length,
                      ),
                    )
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>Department</span>
                <select
                  aria-label="Department"
                  value={reportDepartmentId}
                  onChange={(event) => selectReportingScope(reportHospitalId, event.target.value)}
                >
                  {reportingHospital.departments
                    .filter((item) => reportingGrant.departments.includes(item.id))
                    .map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="context-status">
                <span className="dot" />{' '}
                {report ? `Updated ${time(report.asOf)}` : 'Loading reporting scope'}
                <button
                  className="icon-button"
                  aria-label="Refresh reporting scope"
                  onClick={() => void state.refreshReporting(reportHospitals, reportDepartments)}
                  disabled={state.busy}
                >
                  <RefreshCw size={16} className={state.busy ? 'spin' : ''} />
                </button>
              </div>
            </div>
          ) : page !== 'sync' && page !== 'admin' && hospital ? (
            <div className="context-bar">
              <label>
                <span>Hospital</span>
                <select
                  aria-label="Hospital"
                  value={hospitalId}
                  onChange={(e) => {
                    setHospital(e.target.value);
                    setDep(
                      data.profile.memberships.find((m) => m.hospitalId === e.target.value)!
                        .departments[0],
                    );
                    setSelected(null);
                  }}
                >
                  {data.profile.memberships.map((grant) => (
                    <option value={grant.hospitalId} key={grant.hospitalId}>
                      {data.hospitals.find((item) => item.id === grant.hospitalId)?.name ??
                        grant.hospitalId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Department</span>
                <select
                  aria-label="Department"
                  value={dep}
                  onChange={(e) => {
                    setDep(e.target.value);
                    setSelected(null);
                  }}
                >
                  {hospital.departments
                    .filter((d) => membership?.departments.includes(d.id))
                    .map((d) => (
                      <option value={d.id} key={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </label>
              <div className="context-status">
                <span className="dot" />{' '}
                {stored ? `Updated ${time(stored.asOf)}` : 'Loading workspace'}
                <button
                  className="icon-button"
                  aria-label="Refresh workspace"
                  onClick={() => void state.sync()}
                  disabled={state.busy}
                >
                  <RefreshCw size={16} className={state.busy ? 'spin' : ''} />
                </button>
              </div>
            </div>
          ) : null}
          {!state.connection && (
            <div className="offline-banner">
              <CloudOff size={19} />
              <span>
                <strong>You’re working offline.</strong> Prepared records are available. New entries
                are saved on this device until you reconnect.
              </span>
              <button className="text-button" onClick={() => navigate('sync')}>
                View saved work
                <ArrowRight size={15} />
              </button>
            </div>
          )}
          {loadError && !w && page !== 'admin' && (
            <div className="error" role="alert">
              {loadError}
              <button
                className="text-button"
                onClick={() =>
                  void state
                    .refresh(hospitalId, dep)
                    .then(() => setLoadError(''))
                    .catch((e) => setLoadError(e.message))
                }
              >
                Retry
              </button>
            </div>
          )}
          {reportError && reportingPage && !report && (
            <div className="error" role="alert">
              {reportError}
              <button
                className="text-button"
                onClick={() =>
                  void state
                    .refreshReporting(reportHospitals, reportDepartments)
                    .then(() => setReportError(''))
                    .catch((error) => setReportError(error.message))
                }
              >
                Retry
              </button>
            </div>
          )}
          {page === 'admin' && adminAccess && (
            <Admin
              onChanged={async () => {
                await state.refreshIdentity();
                if (hospitalId && dep) await state.refresh(hospitalId, dep);
              }}
            />
          )}
          {w?.truncated && !reportingPage && page !== 'admin' && (
            <div className="info">
              Showing 250 prioritised cases plus cases with bookings. Metrics cover the full pilot
              department; local search only covers downloaded cases.
            </div>
          )}
          {page === 'sync' ? (
            <SyncPage
              state={state}
              onCase={(hid, departmentId, id) => {
                setHospital(hid);
                setDep(departmentId);
                setSelected(id);
                setPage('backlog');
              }}
            />
          ) : page === 'admin' ? null : scopeGate && hospital ? (
            <OperationalScopeGate
              hospital={hospital}
              departmentName={hospital.departments.find((item) => item.id === dep)?.name ?? dep}
              onContinue={() => setScopeGate(false)}
            />
          ) : page === 'overview' && (!report || !dashboardMetrics) ? (
            <Empty
              title="Preparing this reporting scope"
              detail="Loading aggregate hospital and department metrics…"
            />
          ) : !w && !reportingPage ? (
            <Empty
              title="Preparing your workspace"
              detail="Loading your hospital’s cases and theatre lists…"
            />
          ) : (
            <>
              {page === 'reports' && (
                <TheatreReports
                  key={`${reportHospitalId}/${reportDepartmentId}`}
                  hospitalId={reportHospitalId}
                  departmentId={reportDepartmentId}
                />
              )}
              {page === 'register' && w && (
                <TheatreRegister
                  key={`${w.hospital.id}/${w.departmentId}`}
                  w={w}
                  role={role}
                  onSubmit={act}
                />
              )}
              {page === 'overview' && (
                <>
                  <div className={`metrics ${canViewSelectedDetails ? '' : 'four'}`}>
                    <Metric
                      label="Backlog"
                      value={dashboardMetrics!.outstanding}
                      detail={`${dashboardMetrics!.ready} ready and unbooked · all unresolved cases`}
                      icon={<Users size={19} />}
                    />
                    <Metric
                      label="Median waiting time"
                      value={
                        <>
                          {dashboardMetrics!.medianWait}
                          <em>days</em>
                        </>
                      }
                      detail={`90% waiting ${dashboardMetrics!.p90Wait} days or less`}
                      icon={<Clock size={19} />}
                    />
                    <Metric
                      label="Cases requiring action"
                      value={dashboardMetrics!.requiresAction}
                      detail={`${dashboardMetrics!.missingOutcomes} surgery ${dashboardMetrics!.missingOutcomes === 1 ? 'outcome' : 'outcomes'} not recorded · ${dashboardMetrics!.overdue} ${dashboardMetrics!.overdue === 1 ? 'case' : 'cases'} overdue for treatment`}
                      icon={<TriangleAlert size={19} />}
                      tone="gold"
                    />
                    <Metric
                      label="Surgeries completed"
                      value={dashboardMetrics!.completed}
                      detail="Recorded in the last 30 days"
                      icon={<CheckCircle2 size={19} />}
                      tone="green"
                    />
                    {canViewSelectedDetails && reportWorkspace && (
                      <Metric
                        label="Next OR slot"
                        value={
                          <span className="metric-date">
                            {nextOrSlot ? date(nextOrSlot.start) : '—'}
                          </span>
                        }
                        detail={
                          nextOrSlot
                            ? `${time(nextOrSlot.start)} · ${nextOrSlot.session.theatre} · ${nextOrSlot.freeMinutes} min unallocated`
                            : 'No upcoming staffed session with open time'
                        }
                        icon={<CalendarDays size={19} />}
                      />
                    )}
                  </div>
                  {page === 'overview' && <BacklogTrend metrics={dashboardMetrics!} />}
                  <div className="dashboard-grid">
                    <section className="panel">
                      <SectionTitle title="Treatment activity" eyebrow="LAST 7 DAYS">
                        <span className="chart-key">
                          <i />
                          Completed cases
                        </span>
                      </SectionTitle>
                      <div className="chart">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={dashboardMetrics!.weekly} barSize={28}>
                            <CartesianGrid
                              strokeDasharray="3 4"
                              vertical={false}
                              stroke="var(--divider)"
                            />
                            <XAxis
                              dataKey="name"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fill: 'var(--muted)', fontSize: 12 }}
                            />
                            <YAxis
                              allowDecimals={false}
                              axisLine={false}
                              tickLine={false}
                              width={25}
                              tick={{ fill: 'var(--muted)', fontSize: 11 }}
                            />
                            <Tooltip
                              cursor={{ fill: 'var(--wash)' }}
                              contentStyle={{ borderRadius: 10, border: '1px solid var(--border)' }}
                            />
                            <Bar
                              dataKey="completed"
                              name="Completed"
                              fill="var(--chart)"
                              radius={[5, 5, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="panel-foot">Based on actual recorded completion dates.</p>
                    </section>
                    <section className="panel priority-panel">
                      <SectionTitle title="Backlog by priority" eyebrow="CURRENT BACKLOG" />
                      {dashboardMetrics!.byPriority.map((p) => (
                        <div className="priority-row" key={p.name}>
                          <PriorityBadge value={p.name as any} />
                          <div className="progress-track">
                            <span
                              className={`fill-${p.name}`}
                              style={{
                                width: `${dashboardMetrics!.outstanding ? (p.count / dashboardMetrics!.outstanding) * 100 : 0}%`,
                              }}
                            />
                          </div>
                          <strong>{p.count}</strong>
                        </div>
                      ))}
                      <div className="priority-note">
                        <ShieldCheck size={17} />
                        <p>
                          Priorities are assigned by your clinical team. Waiting time never resets
                          on rescheduling.
                        </p>
                      </div>
                    </section>
                  </div>
                </>
              )}
              {page === 'overview' && (
                <div className="dashboard-grid bottom-grid">
                  <section className="panel no-pad">
                    <div className="panel-heading">
                      <SectionTitle title="Cases requiring action" eyebrow="ACTION REQUIRED">
                        {canViewSelectedDetails && (
                          <LinkButton onClick={() => navigate('backlog')}>View backlog</LinkButton>
                        )}
                      </SectionTitle>
                    </div>
                    {!canViewSelectedDetails || !reportWorkspace ? (
                      <Empty
                        title="Aggregate reporting access"
                        detail="Patient details are available only to authorised clinical and operational staff."
                      />
                    ) : (
                      <CaseTable
                        w={reportWorkspace}
                        cases={attentionCases.slice(0, 5)}
                        onSelect={openCase}
                        compact
                      />
                    )}
                  </section>
                  <UtilisationPanel
                    metrics={dashboardMetrics!}
                    onReports={() => navigate('reports')}
                  />
                </div>
              )}
              {page === 'backlog' && (
                <section className="panel no-pad">
                  <div className="list-toolbar">
                    <div className="search-field">
                      <Search size={17} />
                      <input
                        aria-label="Search backlog"
                        placeholder="Search patient, reference, procedure, diagnosis…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <div className="list-tools">
                      <select
                        aria-label="Priority filter"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                      >
                        {['All', 'P1', 'P2', 'P3'].map((x) => (
                          <option key={x} value={x}>
                            {x === 'All' ? 'All priorities' : x}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Status filter"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        {[
                          'Current backlog',
                          'Requires action',
                          'All',
                          'Waiting',
                          'Scheduled',
                          'In theatre',
                          'On hold',
                          'Completed',
                        ].map((x) => (
                          <option key={x} value={x}>
                            {x === 'On hold' ? 'Case on hold — temporarily paused' : x}
                          </option>
                        ))}
                      </select>
                      {canClinical(role) && (
                        <button className="button small" onClick={() => setImport(true)}>
                          <FileUp size={15} />
                          Import
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="list-count">
                    <span>
                      {filtered.length
                        ? `Showing ${backlogStart + 1}–${Math.min(backlogStart + BACKLOG_PAGE_SIZE, filtered.length)} of ${filtered.length} cases`
                        : '0 cases'}{' '}
                      <span>· P1 → P2 → P3, longest waiting first within each priority</span>
                    </span>
                    <span className="small muted">Use Manage to update a patient or case</span>
                  </div>
                  <div className="backlog-guide">
                    Open <strong>Manage</strong> to edit patient details, diagnosis or case notes,
                    update readiness, and temporarily place a case on hold. Held cases stay in the
                    backlog and their waiting clock continues.
                  </div>
                  <CaseTable w={w!} cases={visibleBacklog} onSelect={openCase} />
                  {filtered.length > BACKLOG_PAGE_SIZE && (
                    <nav className="pagination" aria-label="Backlog pages">
                      <button
                        className="button small"
                        disabled={activeBacklogPage === 1}
                        onClick={() => setBacklogPage(activeBacklogPage - 1)}
                      >
                        <ChevronLeft size={15} />
                        Previous
                      </button>
                      <span>
                        Page <strong>{activeBacklogPage}</strong> of {backlogPages}
                      </span>
                      <button
                        className="button small"
                        disabled={activeBacklogPage === backlogPages}
                        onClick={() => setBacklogPage(activeBacklogPage + 1)}
                      >
                        Next
                        <ChevronRight size={15} />
                      </button>
                    </nav>
                  )}
                </section>
              )}
              {page === 'theatres' && (
                <Theatres
                  w={w!}
                  role={role}
                  day={theatreDay}
                  onDayChange={setTheatreDay}
                  onCase={openCase}
                  onCreate={() => setForm('session')}
                />
              )}
            </>
          )}
          <footer className="footer">
            <span>
              <Activity size={14} /> SurgiLog
            </span>
            <span>
              {isLocalDemo ? 'Local pilot' : 'Review version'} · Fictional patients · South African
              Standard Time
            </span>
          </footer>
        </main>
      </div>
      {state.message && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          <span>{state.message}</span>
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => state.setMessage('')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {current && w && !form && (
        <CaseDetail
          key={`${w.hospital.id}/${current.id}`}
          w={w}
          c={current}
          role={role}
          pending={pending.some(
            (p) => 'caseId' in p.operation.data && p.operation.data.caseId === current.id,
          )}
          onClose={() => setSelected(null)}
          onAction={setForm}
        />
      )}
      {form && w && (
        <OperationForm
          kind={form}
          w={w}
          c={current}
          role={role}
          sessionDate={theatreDay}
          onClose={() => setForm(null)}
          onSubmit={act}
        />
      )}
      {importOpen && w && <ImportForm w={w} onClose={() => setImport(false)} onSubmit={act} />}
    </div>
  );
}

function OperationalScopeGate({
  hospital,
  departmentName,
  onContinue,
}: {
  hospital: Workspace['hospital'];
  departmentName: string;
  onContinue: () => void;
}) {
  return (
    <section className="panel scope-gate">
      <div className="scope-gate-icon">
        <ShieldCheck size={23} />
      </div>
      <div>
        <div className="eyebrow">PATIENT-LEVEL WORKSPACE</div>
        <h2>Confirm a hospital and department</h2>
        <p>
          Backlog and theatre work changes identifiable records. Confirm the operational workspace
          selected above before continuing.
        </p>
        <strong>
          {hospital.name} · {departmentName}
        </strong>
      </div>
      <button className="button primary" onClick={onContinue}>
        Open this department
        <ArrowRight size={16} />
      </button>
    </section>
  );
}

function HospitalOverview({
  report,
  hospitals,
  access,
  selectedHospitalId,
  onSelect,
}: {
  report: ReportingWorkspace | null;
  hospitals: Workspace['hospital'][];
  access: { hospitalId: string; departments: string[] }[];
  selectedHospitalId: string;
  onSelect: (hospitalId: string) => void;
}) {
  if (!report)
    return (
      <section className="panel network-overview">
        <Empty
          title="Preparing your hospital overview"
          detail="Loading aggregate metrics for the hospitals you are allowed to view…"
        />
      </section>
    );
  const rows = access.map((grant) => {
    const hospital = hospitals.find((item) => item.id === grant.hospitalId)!,
      summary = report.summaries.find(
        (item) => item.hospitalId === grant.hospitalId && item.departmentId === null,
      );
    return {
      hospital,
      departments: grant.departments.length,
      metrics: access.length === 1 ? report.metrics : (summary?.metrics ?? report.metrics),
    };
  });
  return (
    <section className="panel no-pad network-overview">
      <div className="panel-heading">
        <SectionTitle title="Hospitals you can view" eyebrow="AUTHORISED HOSPITALS">
          <span className="network-total">
            {report.metrics.outstanding} cases across {access.length}{' '}
            {access.length === 1 ? 'hospital' : 'hospitals'}
          </span>
        </SectionTitle>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Hospital</th>
              <th>Departments</th>
              <th>Backlog</th>
              <th>Median wait</th>
              <th>Requires action</th>
              <th>Completed · 30d</th>
              <th>
                <span className="sr-only">Select hospital</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ hospital, departments, metrics }) => (
              <tr
                key={hospital.id}
                className={hospital.id === selectedHospitalId ? 'selected-scope-row' : ''}
              >
                <td>
                  <strong>{hospital.name}</strong>
                  <small>{hospital.city}</small>
                </td>
                <td>{departments}</td>
                <td>{metrics.outstanding}</td>
                <td>{metrics.medianWait} days</td>
                <td>{metrics.requiresAction}</td>
                <td>{metrics.completed}</td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`Select ${hospital.name}`}
                    onClick={() => onSelect(hospital.id)}
                  >
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function UtilisationPanel({ metrics, onReports }: { metrics: Metrics; onReports: () => void }) {
  return (
    <section className="panel utilisation">
      <div className="eyebrow">THEATRE UTILISATION · 30 DAYS</div>
      <div className="utilisation-number">
        {metrics.utilisation === null ? '—' : metrics.utilisation}
        <span>{metrics.utilisation !== null ? '%' : ''}</span>
      </div>
      <h3>Time that becomes care.</h3>
      <p>Recorded occupancy within planned staffed sessions.</p>
      <div className="utilisation-track">
        <span style={{ width: `${metrics.utilisation ?? 0}%` }} />
      </div>
      <div className="utilisation-bottom">
        <span>Timing completeness</span>
        <strong>{metrics.timingCoverage}%</strong>
      </div>
      <LinkButton onClick={onReports}>Explore performance</LinkButton>
    </section>
  );
}

function BacklogTrend({ metrics }: { metrics: Metrics }) {
  return (
    <section className="panel backlog-trend-panel">
      <SectionTitle title="Backlog trend" eyebrow="LAST 6 MONTHS">
        <div className="trend-legend" aria-label="Priority legend">
          {(['P1', 'P2', 'P3'] as const).map((item) => (
            <span key={item}>
              <i className={`trend-${item}`} />
              {item}
            </span>
          ))}
        </div>
      </SectionTitle>
      <div className="backlog-trend-chart" aria-label="Backlog by priority over time">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={metrics.backlogTrend} margin={{ left: -18, right: 10 }}>
            <CartesianGrid stroke="var(--divider)" vertical={false} />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
            <YAxis
              allowDecimals={false}
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10 }}
            />
            <Tooltip
              cursor={{ stroke: '#dfe8ed' }}
              labelFormatter={(label) => `${label} backlog`}
            />
            <Line type="monotone" dataKey="P1" stroke="#D4867A" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="P2" stroke="#CBB076" strokeWidth={2.5} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="P3" stroke="#77A9C5" strokeWidth={2.5} dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="trend-note">
        Outstanding cases at each month end, grouped by the priority recorded at that time.
        Priority-history coverage: <strong>{metrics.trendCoverage}%</strong>. Cases are excluded
        from periods without a recorded priority; earlier priorities are not assumed.
      </p>
    </section>
  );
}

function CaseTable({
  w,
  cases,
  onSelect,
  compact = false,
}: {
  w: Workspace;
  cases: SurgicalCase[];
  onSelect: (c: SurgicalCase) => void;
  compact?: boolean;
}) {
  if (!cases.length)
    return (
      <Empty
        title="No cases to show"
        detail="Try another filter, or add a patient to this department’s backlog."
      />
    );
  return (
    <div className="table-scroll">
      <table className={compact ? 'compact-table' : ''}>
        <thead>
          <tr>
            <th>Patient</th>
            {!compact && <th>DOB (age)</th>}
            {!compact && <th>Gender</th>}
            {!compact && <th>Contact</th>}
            <th>Procedure</th>
            {!compact && <th>Surgeon</th>}
            <th>Priority</th>
            {!compact && <th>Readiness</th>}
            <th>Wait</th>
            {!compact && <th>Status</th>}
            <th>{compact ? <span className="sr-only">Open case</span> : 'Manage'}</th>
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const p = w.patients.find((p) => p.id === c.patientId),
              overdue = isOutstanding(c) && +new Date(c.dueAt) < Date.now(),
              outcomeNeeded = w.bookings.some(
                (booking) => booking.caseId === c.id && bookingNeedsOutcome(booking),
              );
            return (
              <tr key={c.id}>
                <td>
                  <button className="patient-link" onClick={() => onSelect(c)}>
                    <span className="patient-avatar">
                      {p?.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </span>
                    <span>
                      <strong>{p?.name ?? 'Patient'}</strong>
                      <small>{p?.ref}</small>
                    </span>
                  </button>
                </td>
                {!compact && (
                  <td className="demographic-cell">
                    <span>{p?.dob ? date(p.dob) : 'Not recorded'}</span>
                    {p?.dob && <small>{ageYears(p.dob)} years</small>}
                  </td>
                )}
                {!compact && <td className="demographic-cell">{p?.gender ?? 'Not recorded'}</td>}
                {!compact && <td className="demographic-cell">{p?.phone || 'Not recorded'}</td>}
                <td>
                  <span className="procedure-name">{c.procedure}</span>
                  {diagnosisLabel(c) && <small>{diagnosisLabel(c)}</small>}
                  {outcomeNeeded && (
                    <small className="attention-label">Surgery outcome not recorded</small>
                  )}
                </td>
                {!compact && <td className="surgeon-cell">{c.surgeon || 'Unassigned surgeon'}</td>}
                <td>
                  <PriorityBadge value={c.priority} />
                </td>
                {!compact && (
                  <td>
                    <span className={`readiness ${c.readiness === 'Ready' ? 'ready' : ''}`}>
                      {c.readiness === 'Ready' ? <Check size={13} /> : <Clock size={13} />}{' '}
                      {c.readiness}
                    </span>
                  </td>
                )}
                <td>
                  <strong className={overdue ? 'overdue' : 'wait'}>
                    {waitDays(c.listedAt, new Date().toISOString())}d
                  </strong>
                  {overdue && <small className="overdue">Overdue for treatment</small>}
                </td>
                {!compact && (
                  <td>
                    <Status value={c.status} />
                    {outcomeNeeded && <small className="attention-label">Action required</small>}
                  </td>
                )}
                <td>
                  <button
                    className={compact ? 'icon-button' : 'button small case-manage'}
                    aria-label={`Manage ${p?.name}`}
                    onClick={() => onSelect(c)}
                  >
                    {!compact && <span>Manage</span>}
                    <ChevronRight size={17} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function Theatres({
  w,
  role,
  day,
  onDayChange,
  onCase,
  onCreate,
}: {
  w: Workspace;
  role: Role;
  day: string;
  onDayChange: (day: string) => void;
  onCase: (c: SurgicalCase) => void;
  onCreate: () => void;
}) {
  const sessions = w.sessions
    .filter((s) => s.date === day)
    .sort((a, b) => compareInstants(a.start, b.start));
  return (
    <>
      <div className="theatre-tools">
        <div>
          <CalendarDays size={19} />
          <input
            aria-label="Theatre date"
            type="date"
            value={day}
            onChange={(e) => onDayChange(e.target.value)}
          />
        </div>
        {canSchedule(role) && (
          <button className="button" onClick={onCreate}>
            <Plus size={16} />
            Create session
          </button>
        )}
      </div>
      <p className="muted">
        Showing sessions for {w.hospital.departments.find((d) => d.id === w.departmentId)?.name}.
        Theatre and surgeon reservations in other departments can also affect availability.
      </p>
      {!sessions.length ? (
        <section className="panel">
          <Empty
            title="No sessions on this day"
            detail="Choose another date or create a staffed theatre session."
          />
        </section>
      ) : (
        <div className="sessions">
          {sessions.map((s) => {
            const bookings = w.bookings
              .filter((b) => b.sessionId === s.id && b.status !== 'Cancelled')
              .sort((a, b) => compareInstants(a.start, b.start));
            const available = (+new Date(s.end) - +new Date(s.start)) / 60000,
              used = bookings.reduce(
                (v, b) => v + (+new Date(b.end) - +new Date(b.start)) / 60000,
                0,
              );
            return (
              <section className="panel session" key={s.id}>
                <div className="session-head">
                  <div className="session-symbol">
                    <HeartPulse size={23} />
                  </div>
                  <div>
                    <h2>{s.theatre}</h2>
                    <p>
                      {time(s.start)}–{time(s.end)} · {s.surgeon}
                    </p>
                  </div>
                  <span className="badge session-capacity">
                    {Math.max(0, available - used)} min free
                  </span>
                </div>
                <div className="session-timeline">
                  <span style={{ width: `${Math.min(100, (used / available) * 100)}%` }} />
                </div>
                <div className="session-subhead">
                  <span>{bookings.length} booked cases</span>
                  <span>
                    {used} / {available} minutes allocated
                  </span>
                </div>
                {bookings.length ? (
                  bookings.map((b) => {
                    const c = w.cases.find((c) => c.id === b.caseId);
                    if (!c) return null;
                    const p = w.patients.find((p) => p.id === c.patientId),
                      operatingMinutes = b.estimatedMinutes ?? c.duration,
                      turnoverMinutes = b.turnoverMinutes ?? TURNOVER_MINUTES;
                    return (
                      <button className="session-case" key={b.id} onClick={() => onCase(c)}>
                        <span className="session-time">
                          {time(b.start)}
                          <small>room until {time(b.end)}</small>
                        </span>
                        <span className="session-patient">
                          <strong>{p?.name}</strong>
                          <span>{c.procedure}</span>
                          {diagnosisLabel(c) && <small>{diagnosisLabel(c)}</small>}
                          <small>
                            {p?.ref} ·{' '}
                            {operatingMinutes
                              ? `${operatingMinutes} min surgery · ${turnoverMinutes} min turnover`
                              : 'Operating estimate not recorded'}
                          </small>
                        </span>
                        <PriorityBadge value={c.priority} />
                        <Status value={b.status} />
                        <ChevronRight size={17} />
                      </button>
                    );
                  })
                ) : (
                  <Empty
                    title="Your session is ready"
                    detail="Open a ready case in the backlog to book it into this list."
                  />
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
function CaseDetail({
  w,
  c,
  role,
  pending,
  onClose,
  onAction,
}: {
  w: Workspace;
  c: SurgicalCase;
  role: Role;
  pending: boolean;
  onClose: () => void;
  onAction: (k: FormKind) => void;
}) {
  const p = w.patients.find((p) => p.id === c.patientId)!,
    [history, setHistory] = useState<Audit[]>([]),
    [error, setError] = useState(''),
    outcomeNeeded = w.bookings.some(
      (booking) => booking.caseId === c.id && bookingNeedsOutcome(booking),
    );
  useEffect(() => {
    let active = true;
    setHistory([]);
    setError('');
    api<Audit[]>(`/api/hospitals/${w.hospital.id}/cases/${c.id}/history`)
      .then((entries) => {
        if (active) setHistory(entries);
      })
      .catch(() => {
        if (active) setError('History is available after connecting and synchronising this case.');
      });
    return () => {
      active = false;
    };
  }, [w.hospital.id, c.id, c.version, p.version]);
  return (
    <Modal
      title={p.name}
      subtitle={`${p.ref} · ${c.procedure}${diagnosisLabel(c) ? ` · ${diagnosisLabel(c)}` : ''}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        <div className="case-badges">
          <PriorityBadge value={c.priority} />
          <Status value={c.status} />
          {pending && <span className="badge pending-badge">Saved on device · pending sync</span>}
        </div>
        {outcomeNeeded && (
          <div className="attention-notice">
            <TriangleAlert size={18} />
            <div>
              <strong>Surgery outcome not recorded</strong>
              <p>
                {c.status === 'Scheduled'
                  ? 'The booked surgery time has passed, but no theatre entry or cancellation was recorded. Record what happened using the actual time, or cancel the booking with a reason. The case stays Scheduled in the backlog until this is resolved.'
                  : 'Theatre entry was recorded, but completion is still missing. Record the actual completion time so the case and utilisation figures can be updated.'}
              </p>
            </div>
          </div>
        )}
        {(canEditPatient(role) ||
          (canSchedule(role) && c.status === 'Waiting' && c.readiness === 'Ready') ||
          (canRecord(role) && ['Scheduled', 'In theatre'].includes(c.status))) && (
          <section className="case-management">
            <div className="case-management-copy">
              <strong>Manage patient and case</strong>
              <p>
                Update the information your team uses to assess, prepare, and schedule this case.
              </p>
            </div>
            <div className="case-actions">
              {canEditPatient(role) && (
                <button className="button" onClick={() => onAction('patient')}>
                  Edit patient details
                </button>
              )}
              {canEditPatient(role) && isOutstanding(c) && (
                <button className="button" onClick={() => onAction('case-notes')}>
                  Update case notes
                </button>
              )}
              {canEditPatient(role) && isOutstanding(c) && (
                <button className="button" onClick={() => onAction('diagnosis')}>
                  Update diagnosis
                </button>
              )}
              {canClinical(role) && isOutstanding(c) && (
                <>
                  <button className="button" onClick={() => onAction('priority')}>
                    <SlidersHorizontal size={15} />
                    Review priority
                  </button>
                  {['Waiting', 'On hold'].includes(c.status) && (
                    <>
                      <button className="button" onClick={() => onAction('readiness')}>
                        Update readiness
                      </button>
                      <button className="button" onClick={() => onAction('hold')}>
                        {c.status === 'On hold' ? 'Return to waiting' : 'Place case on hold'}
                      </button>
                    </>
                  )}
                </>
              )}
              {canSchedule(role) && c.status === 'Waiting' && c.readiness === 'Ready' && (
                <button className="button primary" onClick={() => onAction('book')}>
                  <CalendarDays size={16} />
                  Schedule surgery
                </button>
              )}
              {canRecord(role) && c.status === 'Scheduled' && (
                <>
                  <button className="button primary" onClick={() => onAction('start')}>
                    Record theatre entry
                  </button>
                  {canSchedule(role) && (
                    <button className="button danger-outline" onClick={() => onAction('cancel')}>
                      Cancel booking
                    </button>
                  )}
                </>
              )}
              {canRecord(role) && c.status === 'In theatre' && (
                <button className="button primary" onClick={() => onAction('complete')}>
                  <CheckCircle2 size={16} />
                  Record completion
                </button>
              )}
            </div>
            {c.status === 'On hold' && (
              <p className="hold-explanation">
                This case is temporarily paused from booking. It remains in the backlog and its
                waiting clock continues.
              </p>
            )}
          </section>
        )}
        <div className="case-facts">
          <div>
            <span>Diagnosis</span>
            <strong>{c.diagnosis?.trim() || 'Not recorded'}</strong>
          </div>
          <div>
            <span>ICD-10</span>
            <strong>{c.icd10?.code || 'Not recorded'}</strong>
          </div>
          {c.priorityAssignedBy && (
            <div>
              <span>Initial priority assigned by</span>
              <strong>{c.priorityAssignedBy}</strong>
            </div>
          )}
          <div>
            <span>Waiting since</span>
            <strong>{date(c.listedAt)}</strong>
          </div>
          <div>
            <span>Treatment due by</span>
            <strong
              className={+new Date(c.dueAt) < Date.now() && isOutstanding(c) ? 'overdue' : ''}
            >
              {date(c.dueAt)}, {time(c.dueAt)}
            </strong>
          </div>
          <div>
            <span>Readiness</span>
            <strong>{c.readiness}</strong>
          </div>
          <div>
            <span>Surgeon</span>
            <strong>{c.surgeon || 'Unassigned'}</strong>
          </div>
          <div>
            <span>Date of birth</span>
            <strong>{p.dob ? `${date(p.dob)} (${ageYears(p.dob)} years)` : 'Not recorded'}</strong>
          </div>
          <div>
            <span>Gender</span>
            <strong>{p.gender ?? 'Not recorded'}</strong>
          </div>
          <div>
            <span>Contact</span>
            <strong>{p.phone || 'Not recorded'}</strong>
          </div>
        </div>
        <div className="case-note">
          <strong>Case notes</strong>
          <p>{c.notes || 'No case notes recorded.'}</p>
        </div>
        <div className="history-title">
          <Clock size={17} />
          <h3>Case history</h3>
        </div>
        {error ? (
          <p className="muted small">{error}</p>
        ) : (
          <div className="history">
            {history.map((h) => (
              <div key={h.id}>
                <span className="history-dot" />
                <div>
                  <strong>
                    {h.action.replace('activity.', '').replaceAll('.', ' ').replaceAll('-', ' ')}{' '}
                    <span>· {h.actor}</span>
                  </strong>
                  {h.reason && <p>{h.reason}</p>}
                  <small>
                    {date(h.at)} · {time(h.at)} SAST
                  </small>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
function SyncPage({
  state,
  onCase,
}: {
  state: ReturnType<typeof useWorkspace>;
  onCase: (hid: string, dep: string, id: string) => void;
}) {
  const pending = state.data.pending.filter((p) => p.status !== 'resolved');
  const canReview = (p: Pending) => {
    const m = state.data.profile.memberships.find((m) => m.hospitalId === p.hospitalId);
    return !!m && m.role !== 'viewer' && !!p.departmentId && m.departments.includes(p.departmentId);
  };
  return (
    <section className="panel">
      <SectionTitle title="Saved activity" eyebrow="THIS DEVICE">
        <button className="button primary" onClick={() => void state.sync()} disabled={state.busy}>
          <RefreshCw size={16} />
          {state.busy ? 'Synchronising…' : 'Sync now'}
        </button>
      </SectionTitle>
      {!pending.length ? (
        <Empty
          title="No pending entries"
          detail="There are no pending entries in this workspace. New offline entries will appear here."
        />
      ) : (
        pending.map((p) => (
          <div className="sync-item" key={p.operation.id}>
            <div className={`sync-icon ${p.status}`}>
              <ClipboardList size={20} />
            </div>
            <div className="sync-content">
              <strong>
                {p.operation.type === 'activity'
                  ? `Theatre ${p.operation.data.kind}`
                  : p.operation.type.charAt(0).toUpperCase() + p.operation.type.slice(1)}
              </strong>
              <small>
                {date(p.operation.occurredAt)} · {time(p.operation.occurredAt)} · {p.hospitalId}
              </small>
              <p>{p.error ?? 'Saved on this device. Waiting for server acknowledgement.'}</p>
              {canReview(p) ? (
                <details>
                  <summary>Review your saved values</summary>
                  <dl>
                    {Object.entries(p.operation.data)
                      .filter(
                        ([key]) => !['caseId', 'bookingId', 'patientId', 'version'].includes(key),
                      )
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt>{key.replace(/([A-Z])/g, ' $1')}</dt>
                          <dd>{String(value)}</dd>
                        </div>
                      ))}
                  </dl>
                </details>
              ) : (
                <p>
                  Saved work is retained. Current access does not allow viewing these details;
                  contact your hospital administrator for recovery.
                </p>
              )}
              <div className="inline-actions">
                {canReview(p) && 'caseId' in p.operation.data && (
                  <button
                    className="text-button"
                    onClick={() =>
                      onCase(p.hospitalId, p.departmentId!, (p.operation.data as any).caseId)
                    }
                  >
                    View current case
                    <ArrowRight size={14} />
                  </button>
                )}
                {p.status !== 'pending' && (
                  <button
                    className="text-button"
                    onClick={() => {
                      if (
                        confirm(
                          'Keep the current server record? This saved entry will be retained locally as reviewed, without applying it.',
                        )
                      )
                        void state.resolve(p.operation.id);
                    }}
                  >
                    Keep server version
                  </button>
                )}
              </div>
            </div>
            <span className={`badge ${p.status === 'pending' ? 'pending-badge' : 'priority-P1'}`}>
              {p.status === 'pending' ? 'Saved locally' : 'Needs review'}
            </span>
          </div>
        ))
      )}
      <div className="info">
        <LockKeyhole size={17} />
        <span>
          Saved entries are encrypted on this device and sync when connected. Logging out deletes
          entries that have not synced. Your session expires after three days of inactivity.
        </span>
      </div>
    </section>
  );
}
function ImportForm({
  w,
  onClose,
  onSubmit,
}: {
  w: Workspace;
  onClose: () => void;
  onSubmit: (o: Operation) => Promise<void>;
}) {
  const [csv, setCsv] = useState(''),
    [rows, setRows] = useState<Operation[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  function preview() {
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true, skipEmptyLines: true });
    const valid: Operation[] = [],
      bad: string[] = parsed.errors.map((e) => e.message);
    if (parsed.data.length > 100) bad.push('Import at most 100 rows at a time.');
    parsed.data.slice(0, 100).forEach((r, i) => {
      const result = caseFromCsv(r, w.departmentId, crypto.randomUUID(), new Date().toISOString());
      if (result.success)
        valid.push({
          id: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          recordedAt: new Date().toISOString(),
          type: 'register',
          data: result.data,
        });
      else
        bad.push(
          `Row ${i + 2}: ${result.error.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ')}`,
        );
    });
    setRows(valid);
    setErrors(bad);
  }
  async function commit() {
    setBusy(true);
    try {
      for (const row of rows) {
        await onSubmit(row);
        setRows((current) => current.filter((r) => r.id !== row.id));
      }
      setDone(true);
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Import a waiting list"
      subtitle={`New cases for ${w.hospital.departments.find((d) => d.id === w.departmentId)?.name}`}
      onClose={onClose}
      wide
    >
      <div className="modal-body">
        {done ? (
          <>
            <Empty
              title="Entries saved for synchronisation"
              detail="Check Saved activity for accepted entries or duplicate-record conflicts."
            />
            <button className="button primary" onClick={onClose}>
              Done
            </button>
          </>
        ) : (
          <>
            <p className="muted small">
              Paste CSV using the header below. All imported cases enter the waiting list for
              clinical readiness review. Listing dates use 08:00 SAST. For every priority,
              urgency_at must include the assessment time and timezone that starts the treatment
              clock (for example 2026-10-01T10:30:00+02:00). Optional diagnosis and icd10 columns
              record the pre-procedure diagnosis; icd10 is a WHO ICD-10 code such as K35.8. Leave
              both blank when they are not known.
            </p>
            <code className="csv-header">
              patient_ref,patient_name,dob,gender,phone,procedure,surgeon,priority,listed_at,urgency_at,diagnosis,icd10
            </code>
            <textarea
              className="csv-input"
              aria-label="CSV data"
              rows={8}
              value={csv}
              onChange={(e) => {
                setCsv(e.target.value);
                setRows([]);
                setErrors([]);
              }}
              placeholder="GS-NEW01,Fictional Patient,1980-01-15,Not recorded,,Hernia repair,,P3,2026-10-01,2026-10-01T10:30:00+02:00"
            />
            {errors.map((e, i) => (
              <div className="error" key={i}>
                {e}
              </div>
            ))}
            {rows.length > 0 && (
              <div className="info">
                <CheckCircle2 size={17} />
                {rows.length} valid rows ready. Existing patient references are checked by the
                server.
              </div>
            )}
            <div className="form-actions">
              <button className="button" onClick={preview} disabled={!csv}>
                Validate preview
              </button>
              <button
                className="button primary"
                onClick={() => void commit()}
                disabled={!rows.length || errors.length > 0 || busy}
              >
                {busy ? 'Saving…' : `Save ${rows.length || ''} cases`}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
const root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!);
if (import.meta.hot) import.meta.hot.data.root = root;
root.render(
  <>
    <App />
    <UpdateNotice />
  </>,
);
