import { createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { serverStackFrames } from '../../shared/client-error.ts';

export type FailureLog = {
  status: number;
  clientError: string;
  severity: 'WARNING' | 'ERROR';
  errorName: string;
  errorCode: string;
  fingerprint?: string;
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

function safeCode(value: unknown, fallback: string) {
  return typeof value === 'string' && /^[a-z0-9-]{1,40}$/i.test(value) && !/\d{5,}/.test(value)
    ? value.toLowerCase()
    : fallback;
}

function fingerprint(message: string) {
  return createHash('sha256').update(message).digest('hex').slice(0, 16);
}

/** Client message plus the fields that are safe to log. The message itself is not logged. */
export function describeFailure(err: unknown): FailureLog {
  if (err instanceof ZodError)
    return {
      status: 400,
      clientError: err.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
      severity: 'WARNING',
      errorName: 'ZodError',
      errorCode: 'invalid-request',
    };
  const status = apiStatus(err);
  if (err instanceof Error && status && status < 500)
    return {
      status,
      clientError: err.message,
      severity: 'WARNING',
      errorName: err.name || 'ApiError',
      errorCode: safeCode((err as { code?: unknown }).code, `http-${status}`),
    };
  const httpCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof httpCode === 'number' && httpCode >= 400 && httpCode < 500)
    return {
      status: httpCode,
      clientError:
        httpCode === 429 ? 'Too many requests. Please retry shortly.' : 'Invalid request.',
      severity: 'WARNING',
      errorName: 'FastifyError',
      errorCode: httpCode === 429 ? 'rate-limit' : 'invalid-request',
    };
  const error = err instanceof Error ? err : new Error('request failed');
  const failureStatus = status && status >= 500 ? status : 500;
  return {
    status: failureStatus,
    clientError: 'The request could not be confirmed. Retry the same request shortly.',
    severity: 'ERROR',
    errorName: error.name || 'Error',
    errorCode: safeCode((error as { code?: unknown }).code, `http-${failureStatus}`),
    fingerprint: fingerprint(error.message),
    stack: serverStackFrames(error.stack),
  };
}
