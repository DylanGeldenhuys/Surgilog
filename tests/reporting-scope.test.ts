import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canRequestScopedReport,
  isScopedReportSelection,
  overviewReportPath,
  reportScopeEmptyCopy,
  theatreReportPath,
} from '../apps/web/reporting-scope.ts';

describe('scoped report requests', () => {
  it('does not call a scoped report without a valid hospital and department', () => {
    for (const [hospitalId, departmentId] of [
      ['', ''],
      ['', 'general'],
      ['city-hospital', ''],
      ['city hospital', 'general'],
      ['city/hospital', 'general'],
      ['city-hospital', 'general/surgery'],
    ] as const) {
      expect(isScopedReportSelection(hospitalId, departmentId)).toBe(false);
      expect(theatreReportPath(hospitalId, departmentId, '2026-11-01', '2026-11-30')).toBeNull();
    }
    expect(overviewReportPath([''], [{ hospitalId: '', departmentId: '' }])).toBeNull();
    expect(overviewReportPath([], [])).toBeNull();
    expect(
      canRequestScopedReport(['city-hospital'], [{ hospitalId: '', departmentId: 'general' }]),
    ).toBe(false);
  });

  it('builds scoped report paths only for ids the server accepts', () => {
    expect(theatreReportPath('city-hospital', 'general', '2026-11-01', '2026-11-30')).toBe(
      '/api/reporting/theatre?hospitalId=city-hospital&departmentId=general&from=2026-11-01&to=2026-11-30',
    );
    expect(
      overviewReportPath(
        ['city-hospital', 'district-hospital'],
        [
          { hospitalId: 'city-hospital', departmentId: 'general' },
          { hospitalId: 'district-hospital', departmentId: 'ortho' },
        ],
      ),
    ).toBe(
      '/api/reporting/overview?hospitalIds=city-hospital%2Cdistrict-hospital&departmentKeys=city-hospital%2Fgeneral%2Cdistrict-hospital%2Fortho',
    );
  });

  it('tells a super user to add a hospital in Admin', () => {
    const copy = reportScopeEmptyCopy(true);
    expect(`${copy.title}. ${copy.detail}`).toBe('No hospital set up yet. Add one in Admin.');
    expect(reportScopeEmptyCopy(false).detail).toBe(
      'No hospital or department is available for this report.',
    );
  });

  it('keeps the server theatre-report id check', () => {
    const source = readFileSync(new URL('../apps/api/server.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/hospitalId: z\.string\(\)\.regex\(\/\^\[\\w-\]\{1,100\}\$\/\)/);
    expect(source).toMatch(/departmentId: z\.string\(\)\.regex\(\/\^\[\\w-\]\{1,100\}\$\/\)/);
  });
});
