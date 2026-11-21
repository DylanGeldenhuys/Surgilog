import { ZodError } from 'zod';
import { redactText } from '../../shared/redact.ts';

export type FailureLog = {
  status: number;
  clientError: string;
  severity: 'WARNING' | 'ERROR';
  errorMessage: string;
  stack?: string;
};

function apiStatus(err: unknown) {
  if (!(err instanceof Error) || !('status' in err)) return undefined;
  const status = (err as { status?: unknown }).status;
  if (typeof status !== 'number' || !Number.isInteger(status) || status < 400 || status > 599)
    return undefined;
  if ('statusCode' in err) return undefined;
  return status;
}

/** Client message plus the fields that are safe to log. Issue values are not logged. */
export function describeFailure(err: unknown): FailureLog {
  if (err instanceof ZodError)
    return {
      status: 400,
      clientError: err.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
      severity: 'WARNING',
      errorMessage: 'invalid request',
    };
  const status = apiStatus(err);
  if (err instanceof Error && status)
    return {
      status,
      clientError: err.message,
      severity: status >= 500 ? 'ERROR' : 'WARNING',
      errorMessage: redactText(err.message).slice(0, 500),
      ...(status >= 500 && err.stack ? { stack: redactText(err.stack).slice(0, 4000) } : {}),
    };
  const code = (err as { statusCode?: unknown }).statusCode;
  if (typeof code === 'number' && code >= 400 && code < 500)
    return {
      status: code,
      clientError: code === 429 ? 'Too many requests. Please retry shortly.' : 'Invalid request.',
      severity: 'WARNING',
      errorMessage: code === 429 ? 'rate limit' : 'invalid request',
    };
  const error = err instanceof Error ? err : new Error('request failed');
  return {
    status: 500,
    clientError: 'The request could not be confirmed. Retry the same request shortly.',
    severity: 'ERROR',
    errorMessage: redactText(error.message).slice(0, 500),
    ...(error.stack ? { stack: redactText(error.stack).slice(0, 4000) } : {}),
  };
}
