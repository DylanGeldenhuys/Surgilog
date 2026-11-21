import { randomUUID } from 'node:crypto';
import {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { redactValue } from '../../shared/redact.ts';

const REQUEST_ID = /^[A-Za-z0-9-]{8,80}$/;
const PINO_SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

export type Severity = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

type LogMethod = (fields: object, message?: string) => void;
export type AppLogger = Partial<Record<'debug' | 'info' | 'warn' | 'error' | 'fatal', LogMethod>>;

const LEVEL: Record<Severity, keyof AppLogger> = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warn',
  ERROR: 'error',
  CRITICAL: 'fatal',
};

export function pinoSeverity(label: string) {
  return PINO_SEVERITY[label] ?? 'DEFAULT';
}

export function requestIdFrom(header: unknown) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value === 'string' && REQUEST_ID.test(value)) return value;
  return randomUUID();
}

export function httpRequestFields(input: {
  method: string;
  route: string;
  status: number;
  userAgent: string;
  remoteIp: string;
  latencyMs: number;
  protocol: string;
}) {
  const latencyMs = Number.isFinite(input.latencyMs) ? Math.max(0, input.latencyMs) : 0;
  return {
    requestMethod: input.method,
    requestUrl: input.route.split('?')[0] || '/',
    status: input.status,
    userAgent: input.userAgent.slice(0, 180),
    remoteIp: input.remoteIp,
    latency: `${(latencyMs / 1000).toFixed(3)}s`,
    protocol: input.protocol.startsWith('HTTP/') ? input.protocol : 'HTTP/1.1',
  };
}

export function createLoggerOptions(stream?: { write(message: string): void }) {
  return {
    level: 'info' as const,
    messageKey: 'message' as const,
    formatters: {
      level(label: string) {
        return { severity: pinoSeverity(label) };
      },
    },
    // Defence in depth. Request logs below never attach headers or bodies.
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'request.headers.authorization',
        'request.headers.cookie',
        'headers.authorization',
        'headers.cookie',
        'authorization',
        'cookie',
        'body',
        'password',
        'token',
      ],
      censor: '[redacted]',
    },
    serializers: {
      req(req: { method?: string; url?: string; id?: string }) {
        return {
          method: req.method,
          url: String(req.url ?? '').split('?')[0],
          id: req.id,
        };
      },
    },
    ...(stream ? { stream } : {}),
  };
}

/** Fastify's own access log would include the request. Ours is written in onResponse. */
export class RequestLogController extends LogController {
  constructor() {
    super({ disableRequestLogging: true });
  }
}

export function logEvent(
  logger: AppLogger,
  severity: Severity,
  message: string,
  fields: Record<string, unknown>,
) {
  const fn = logger[LEVEL[severity]] ?? logger.error;
  fn?.call(logger, redactValue(fields) as object, message);
}

export function criticalLine(kind: string, error: unknown) {
  const errorMessage = error instanceof Error ? error.message : 'non-error rejection';
  const stack = error instanceof Error ? error.stack : undefined;
  return JSON.stringify(
    redactValue({
      severity: 'CRITICAL',
      message: kind,
      errorMessage,
      ...(stack ? { stack } : {}),
    }),
  );
}

export function handleFatal(
  kind: 'unhandledRejection' | 'uncaughtException',
  error: unknown,
  exit: (code: number) => void,
  write: (line: string) => void = (line) => process.stdout.write(line),
) {
  write(`${criticalLine(kind, error)}\n`);
  exit(1);
}

export function installFatalHandlers(exit: (code: number) => void = (code) => process.exit(code)) {
  process.on('unhandledRejection', (reason) => handleFatal('unhandledRejection', reason, exit));
  process.on('uncaughtException', (error) => handleFatal('uncaughtException', error, exit));
}

function routeOf(req: FastifyRequest) {
  return req.routeOptions.url ?? req.url.split('?')[0] ?? '/';
}

export function registerRequestLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
  });
  app.addHook('onResponse', async (req, reply) => {
    const status = reply.statusCode;
    logEvent(req.log, status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO', 'request', {
      requestId: req.id,
      httpRequest: httpRequestFields({
        method: req.method,
        route: routeOf(req),
        status,
        userAgent: String(req.headers['user-agent'] ?? ''),
        remoteIp: req.ip,
        latencyMs: reply.elapsedTime,
        protocol: `HTTP/${req.raw.httpVersion || '1.1'}`,
      }),
    });
  });
}

export function logRequestFailure(
  req: FastifyRequest,
  reply: FastifyReply,
  failure: { severity: Severity; status: number; errorMessage: string; stack?: string },
) {
  reply.header('x-request-id', String(req.id));
  logEvent(
    req.log,
    failure.severity,
    failure.severity === 'ERROR' ? 'request failed' : 'request rejected',
    {
      requestId: req.id,
      method: req.method,
      route: routeOf(req),
      status: failure.status,
      errorMessage: failure.errorMessage,
      ...(failure.stack ? { stack: failure.stack } : {}),
    },
  );
}
