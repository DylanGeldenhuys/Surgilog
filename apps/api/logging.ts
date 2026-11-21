import { randomUUID } from 'node:crypto';
import {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { serverStackFrames } from '../../shared/client-error.ts';
import { redactText } from '../../shared/redact.ts';

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

const HTTP_KEYS = [
  'requestMethod',
  'requestUrl',
  'status',
  'userAgent',
  'remoteIp',
  'latency',
  'protocol',
] as const;

const clientIds = new WeakMap<FastifyRequest, string>();

export function pinoSeverity(label: string) {
  return PINO_SEVERITY[label] ?? 'DEFAULT';
}

export function createRequestId() {
  return randomUUID();
}

export function clientRequestIdFrom(header: unknown) {
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === 'string' && REQUEST_ID.test(value) ? value : undefined;
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
    userAgent: redactText(input.userAgent).slice(0, 180),
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
          url: '<unmatched>',
          id: req.id,
        };
      },
    },
    ...(stream ? { stream } : {}),
  };
}

export class RequestLogController extends LogController {
  constructor() {
    super({ disableRequestLogging: true });
  }
}

function allowString(value: unknown, pattern: RegExp) {
  return typeof value === 'string' && pattern.test(value) ? value : undefined;
}

function allowHttpRequest(value: unknown) {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of HTTP_KEYS) {
    const item = source[key];
    if (typeof item === 'number' && Number.isFinite(item)) out[key] = item;
    else if (typeof item === 'string') out[key] = redactText(item).slice(0, 200);
  }
  return out;
}

/** Only these names can be logged. Anything else, including patient fields, is dropped. */
export function allowLogFields(fields: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const requestId = allowString(fields.requestId, REQUEST_ID);
  if (requestId) out.requestId = requestId;
  const clientRequestId = allowString(fields.clientRequestId, REQUEST_ID);
  if (clientRequestId) out.clientRequestId = clientRequestId;
  const clientReference = allowString(fields.clientReference, REQUEST_ID);
  if (clientReference) out.clientReference = clientReference;
  const method = allowString(fields.method, /^[A-Z]{3,10}$/);
  if (method) out.method = method;
  const route = allowString(fields.route, /^(\/[A-Za-z0-9_.:/-]{0,180}|<unmatched>)$/);
  if (route) out.route = route.split('?')[0];
  if (typeof fields.status === 'number' && fields.status >= 100 && fields.status <= 599)
    out.status = fields.status;
  const errorName = allowString(fields.errorName, /^[A-Za-z][A-Za-z0-9_]{0,40}$/);
  if (errorName) out.errorName = errorName;
  const errorCode = allowString(fields.errorCode, /^[a-z0-9-]{1,40}$/);
  if (errorCode) out.errorCode = errorCode;
  const fingerprint = allowString(fields.fingerprint, /^[a-f0-9]{16}$/);
  if (fingerprint) out.fingerprint = fingerprint;
  const uid = allowString(fields.uid, /^[\w-]{1,128}$/);
  if (uid) out.uid = uid;
  if (fields.source === 'client' || fields.source === 'server') out.source = fields.source;
  if (typeof fields.stack === 'string') {
    const stack = serverStackFrames(fields.stack);
    if (stack) out.stack = stack;
  }
  const httpRequest = allowHttpRequest(fields.httpRequest);
  if (httpRequest) out.httpRequest = httpRequest;
  return out;
}

export function logEvent(
  logger: AppLogger,
  severity: Severity,
  message: string,
  fields: Record<string, unknown>,
) {
  const fn = logger[LEVEL[severity]] ?? logger.error;
  fn?.call(logger, allowLogFields(fields), message);
}

export function criticalLine(kind: string, error: unknown) {
  const name = error instanceof Error ? error.name : 'Error';
  const code =
    error instanceof Error &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'string'
      ? (error as { code: string }).code
      : undefined;
  const stack = error instanceof Error ? serverStackFrames(error.stack) : undefined;
  return JSON.stringify(
    allowLogFields({
      source: 'server',
      errorName: /^[A-Za-z]/.test(name) ? name : 'Error',
      ...(code && /^[a-z0-9-]{1,40}$/i.test(code) ? { errorCode: code.toLowerCase() } : {}),
      ...(stack ? { stack } : {}),
    }),
  );
}

export function beginFatalShutdown(options: {
  kind: 'unhandledRejection' | 'uncaughtException';
  error: unknown;
  close?: () => Promise<unknown>;
  exit?: (code: number) => void;
  write?: (line: string) => void;
  timeoutMs?: number;
}) {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const timeoutMs = options.timeoutMs ?? 2500;
  write(
    `${JSON.stringify({ severity: 'CRITICAL', message: options.kind, ...JSON.parse(criticalLine(options.kind, options.error)) })}\n`,
  );
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    exit(1);
  };
  const timer = setTimeout(finish, timeoutMs);
  timer.unref?.();
  if (!options.close) {
    finish();
    return Promise.resolve();
  }
  return Promise.resolve()
    .then(() => options.close!())
    .then(finish, finish);
}

export function installFatalHandlers(options?: {
  close?: () => Promise<unknown>;
  exit?: (code: number) => void;
}) {
  let stopping = false;
  const onFatal = (kind: 'unhandledRejection' | 'uncaughtException', error: unknown) => {
    if (stopping) return;
    stopping = true;
    void beginFatalShutdown({ kind, error, close: options?.close, exit: options?.exit });
  };
  process.on('unhandledRejection', (reason) => onFatal('unhandledRejection', reason));
  process.on('uncaughtException', (error) => onFatal('uncaughtException', error));
}

function routeOf(req: FastifyRequest) {
  return req.routeOptions.url ?? '<unmatched>';
}

export function rememberedClientRequestId(req: FastifyRequest) {
  return clientIds.get(req);
}

export function registerRequestLogging(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', String(req.id));
    const supplied = clientRequestIdFrom(req.headers['x-request-id']);
    if (supplied) clientIds.set(req, supplied);
  });
  app.addHook('onResponse', async (req, reply) => {
    const status = reply.statusCode;
    const clientRequestId = clientIds.get(req);
    logEvent(req.log, status >= 500 ? 'ERROR' : status >= 400 ? 'WARNING' : 'INFO', 'request', {
      requestId: String(req.id),
      ...(clientRequestId ? { clientRequestId } : {}),
      method: req.method,
      route: routeOf(req),
      status,
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
  failure: {
    severity: Severity;
    status: number;
    errorName: string;
    errorCode: string;
    fingerprint?: string;
    stack?: string;
  },
) {
  reply.header('x-request-id', String(req.id));
  const clientRequestId = clientIds.get(req);
  logEvent(
    req.log,
    failure.severity,
    failure.severity === 'ERROR' ? 'request failed' : 'request rejected',
    {
      requestId: String(req.id),
      ...(clientRequestId ? { clientRequestId } : {}),
      method: req.method,
      route: routeOf(req),
      status: failure.status,
      source: 'server',
      errorName: failure.errorName,
      errorCode: failure.errorCode,
      ...(failure.fingerprint ? { fingerprint: failure.fingerprint } : {}),
      ...(failure.stack ? { stack: failure.stack } : {}),
    },
  );
}
