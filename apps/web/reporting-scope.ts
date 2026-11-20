// Same id pattern the theatre report query requires. The server still rejects anything else.
const scopedId = /^[\w-]{1,100}$/;

export function isScopedId(value: string) {
  return scopedId.test(value);
}

export function isScopedReportSelection(hospitalId: string, departmentId: string) {
  return isScopedId(hospitalId) && isScopedId(departmentId);
}

export function canRequestScopedReport(
  hospitalIds: readonly string[],
  departments: readonly { hospitalId: string; departmentId: string }[],
) {
  return (
    hospitalIds.length > 0 &&
    hospitalIds.every(isScopedId) &&
    departments.every((item) => isScopedReportSelection(item.hospitalId, item.departmentId))
  );
}

export function theatreReportPath(
  hospitalId: string,
  departmentId: string,
  from: string,
  to: string,
) {
  if (!isScopedReportSelection(hospitalId, departmentId)) return null;
  const params = new URLSearchParams({ hospitalId, departmentId, from, to });
  return `/api/reporting/theatre?${params}`;
}

export function overviewReportPath(
  hospitalIds: readonly string[],
  departments: readonly { hospitalId: string; departmentId: string }[],
) {
  if (!canRequestScopedReport(hospitalIds, departments)) return null;
  const params = new URLSearchParams({
    hospitalIds: hospitalIds.join(','),
    departmentKeys: departments.map((item) => `${item.hospitalId}/${item.departmentId}`).join(','),
  });
  return `/api/reporting/overview?${params}`;
}

export function reportScopeEmptyCopy(superUser: boolean) {
  if (superUser) return { title: 'No hospital set up yet', detail: 'Add one in Admin.' };
  return {
    title: 'No report available',
    detail: 'No hospital or department is available for this report.',
  };
}
