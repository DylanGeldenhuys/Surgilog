import { useEffect, useState } from 'react';
import { Printer, RefreshCw } from 'lucide-react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { saDay } from '../../shared/domain.ts';
import { theatrePeriod, type ReportPeriod, type TheatreReport } from '../../shared/theatre.ts';
import { api } from './firebase.ts';
import { Field, date, time } from './ui.tsx';

const number = (v: number | null, suffix = '') =>
  v === null ? 'Not available' : `${Math.round(v * 10) / 10}${suffix}`;
const clock = (v: number | null) =>
  v === null
    ? 'Not available'
    : `${String(Math.floor(Math.round(v) / 60) % 24).padStart(2, '0')}:${String(Math.round(v) % 60).padStart(2, '0')}`;
export function TheatreReports({
  hospitalId,
  departmentId,
}: {
  hospitalId: string;
  departmentId: string;
}) {
  const [period, setPeriod] = useState<ReportPeriod>('Month'),
    [anchor, setAnchor] = useState(saDay(new Date())),
    [report, setReport] = useState<TheatreReport | null>(null),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0),
    [loading, setLoading] = useState(false);
  const range = theatrePeriod(period, anchor);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setReport(null);
    setError('');
    const params = new URLSearchParams({
      hospitalId,
      departmentId,
      from: range.from,
      to: range.to,
    });
    api<TheatreReport>(`/api/reporting/theatre?${params}`)
      .then((r) => {
        if (active) setReport(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [hospitalId, departmentId, range.from, range.to, revision]);
  return (
    <section className="theatre-reports">
      <div className="register-toolbar no-print">
        <div>
          <h2>Theatre efficiency</h2>
          <p>Actual activity and recorded staffed capacity. Financial year: April–March.</p>
        </div>
        <button className="button" onClick={() => setRevision((v) => v + 1)} disabled={loading}>
          <RefreshCw size={16} />
          Refresh report
        </button>
        <button className="button" disabled={!report} onClick={() => window.print()}>
          <Printer size={16} />
          Print executive summary
        </button>
      </div>
      <div className="register-filters no-print">
        <Field label="Report period">
          <select value={period} onChange={(e) => setPeriod(e.target.value as ReportPeriod)}>
            {(['Week', 'Month', 'Quarter', 'Financial year'] as const).map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Date within period">
          <input
            type="date"
            required
            value={anchor}
            onChange={(e) => {
              if (e.target.value) setAnchor(e.target.value);
            }}
          />
        </Field>
        <p>
          {date(range.from)}–{date(range.to)} · FY {range.financialYear}
        </p>
      </div>
      {loading && <p role="status">Preparing theatre report…</p>}
      {error && (
        <div className="error" role="alert">
          {error} Reconnect and refresh to load this report.
        </div>
      )}
      {report && (
        <>
          <div className="report-print-heading">
            <h2>SurgiLog · Theatre executive summary</h2>
            <p>
              {report.hospitalName} · {report.departmentName} · {date(report.from)}–
              {date(report.to)} · FY {range.financialYear}
            </p>
            <small>
              Generated {date(report.asOf)} at {time(report.asOf)} SAST
            </small>
          </div>
          <div className="register-metrics">
            {[
              [
                'Operations / procedures',
                `${report.summary.cases} / ${report.summary.procedures}`,
                'Verified records only',
              ],
              [
                'Theatre utilisation',
                number(report.summary.utilisation, '%'),
                `${number(report.summary.usedMinutes)} used / ${number(report.summary.availableMinutes)} available min`,
              ],
              [
                'Average turnaround',
                number(report.summary.averageTurnaroundMinutes, ' min'),
                `${report.summary.turnaroundObservations} consecutive-case gaps`,
              ],
              [
                'Average first entry',
                clock(report.summary.averageStartMinutes),
                `${report.summary.startObservations} session/day starts · SAST`,
              ],
            ].map(([label, value, detail]) => (
              <div className="panel register-metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{detail}</small>
              </div>
            ))}
          </div>
          <p className="info">
            {report.summary.drafts} draft entries excluded. {report.missingTimings} completed
            bookings have incomplete timings/references. {report.summary.overlappingEntries}{' '}
            overlapping actual intervals need review. Average first-entry difference from planned
            start: {number(report.summary.averageDelayMinutes, ' min')} (
            {report.summary.delayObservations} staffed sessions; negative means early).
          </p>
          <div className="register-charts">
            {[
              ['Completed operations', 'cases', '#176b9a'],
              ['Utilisation (%)', 'utilisation', '#50927d'],
              ['Turnaround (minutes)', 'turnaround', '#b69048'],
              ['First theatre entry (SAST)', 'starting', '#6a9ab5'],
            ].map(([title, key, color]) => (
              <section className="panel" key={key}>
                <h3>{title}</h3>
                <ResponsiveContainer width="100%" height={230}>
                  <LineChart data={report.series}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} minTickGap={28} />
                    <YAxis
                      width={55}
                      tickFormatter={(v) => (key === 'starting' ? clock(v) : String(v))}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(v) => (key === 'starting' ? clock(Number(v)) : number(Number(v)))}
                    />
                    <Line
                      type="linear"
                      dataKey={key}
                      stroke={color}
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      isAnimationActive={false}
                      connectNulls={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </section>
            ))}
          </div>
          <div className="register-breakdowns">
            {[
              ['By operating location', report.summary.theatres],
              ['Procedure counts', report.summary.operationTypes],
              ['Surgeon activity', report.summary.surgeons],
              ['Anaesthetist activity', report.summary.anaesthetists],
            ].map(([label, items]) => (
              <section className="panel" key={label as string}>
                <h3>{label as string}</h3>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Count</th>
                        {label !== 'Procedure counts' && (
                          <>
                            <th>Total occupancy</th>
                            <th>Minutes / operation</th>
                          </>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(items as TheatreReport['summary']['surgeons']).map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td>{r.cases}</td>
                          {label !== 'Procedure counts' && (
                            <>
                              <td>{number(r.minutes, ' min')}</td>
                              <td>{number(r.minutes / r.cases)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!(items as unknown[]).length && <p>No verified activity in this period.</p>}
              </section>
            ))}
          </div>
          <p className="report-method">
            Available time comes from elapsed recorded staffed sessions, including unused sessions.
            Future session hours are excluded. Occupancy is actual patient entry-to-exit time within
            those windows; activity without recorded capacity contributes to counts but does not
            invent available hours. Turnaround is actual exit-to-next-entry in the same session, or
            location/day for unplanned activity. First entry is compared with the session’s planned
            start. Staff tables describe activity, not clinical quality. Reports use
            server-confirmed records; sync offline entries first. Unknown measures remain blank in
            graphs.
          </p>
        </>
      )}
    </section>
  );
}
