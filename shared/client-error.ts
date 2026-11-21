import { redactText } from './redact.ts';

export type ClientErrorReport = {
  reference: string;
  message: string;
  stack?: string;
  path?: string;
};

/** Pathname only. Query strings can carry search text. */
export function safeClientPath(path: string) {
  const pathname = path.split('?')[0]?.split('#')[0] ?? '';
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return '/';
  if (!/^\/[\w./-]*$/.test(pathname)) return '/';
  return pathname.slice(0, 200);
}

export function clientErrorPayload(report: ClientErrorReport) {
  const message = redactText(report.message).trim().slice(0, 300);
  return {
    reference: report.reference,
    message: message || 'Unknown error',
    ...(report.stack ? { stack: redactText(report.stack).slice(0, 2000) } : {}),
    path: safeClientPath(report.path ?? '/'),
  };
}
