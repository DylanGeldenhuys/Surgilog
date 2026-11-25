import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { registerClientErrorRoute, resetClientErrorBudget } from '../apps/api/client-errors.ts';
import { describeFailure } from '../apps/api/http-error.ts';
import { ApiError } from '../apps/api/service.ts';
import {
  allowLogFields,
  beginFatalShutdown,
  clientRequestIdFrom,
  createLoggerOptions,
  createRequestId,
  httpRequestFields,
  logRequestFailure,
  pinoSeverity,
  registerRequestLogging,
  RequestLogController,
} from '../apps/api/logging.ts';
import { redactText } from '../shared/redact.ts';
import { clientErrorPayload, messageFingerprint } from '../shared/client-error.ts';

const reference = '11111111-1111-1111-1111-111111111111';

describe('request logging', () => {
  it('maps pino levels to Cloud Logging severities', () => {
    expect(pinoSeverity('info')).toBe('INFO');
    expect(pinoSeverity('warn')).toBe('WARNING');
    expect(pinoSeverity('error')).toBe('ERROR');
    expect(pinoSeverity('fatal')).toBe('CRITICAL');
  });

  it('generates the response id and keeps a client id separate', () => {
    expect(createRequestId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(clientRequestIdFrom('req-abc-123')).toBe('req-abc-123');
    expect(clientRequestIdFrom('bad id\nCRITICAL')).toBeUndefined();
    expect(clientRequestIdFrom('short')).toBeUndefined();
  });

  it('builds an httpRequest object without a query string', () => {
    expect(
      httpRequestFields({
        method: 'GET',
        route: '/api/hospitals/:hospitalId/workspace?departmentId=general',
        status: 200,
        userAgent: 'Test',
        remoteIp: '203.0.113.8',
        latencyMs: 12,
        protocol: 'HTTP/1.1',
      }).requestUrl,
    ).toBe('/api/hospitals/:hospitalId/workspace');
  });

  it('drops patient fields and strips names, ids and diagnosis codes from text', () => {
    expect(redactText('Ada Nkosi 8001015009087 K35.8')).toBe('[redacted] [redacted] [redacted]');
    expect(
      allowLogFields({
        requestId: reference,
        patientName: 'Ada Nkosi',
        patientRef: 'GS-10001',
        patientId: 'p1',
        surgeon: 'Dr Jacobs',
        procedure: 'Appendicectomy',
        icd10: 'K35.8',
        age: 40,
        sex: 'Female',
        gender: 'Female',
        name: 'Ada Nkosi',
        stack: 'Error: Ada Nkosi 8001015009087\n    at save (/app/apps/api/service.ts:10:4)',
      }),
    ).toEqual({
      requestId: reference,
      stack: 'at save (/app/apps/api/service.ts:10:4)',
    });
  });

  it('logs a fatal process error without the message and drains before exit', async () => {
    const lines: string[] = [];
    const exit = vi.fn();
    let closed = false;
    await beginFatalShutdown({
      kind: 'unhandledRejection',
      error: new Error('Bearer leaked-token Ada Nkosi 8001015009087'),
      close: async () => {
        closed = true;
      },
      exit,
      write: (line) => lines.push(line),
      timeoutMs: 1000,
    });
    expect(closed).toBe(true);
    expect(exit).toHaveBeenCalledWith(1);
    expect(lines[0]).toContain('"severity":"CRITICAL"');
    expect(lines[0]).not.toContain('leaked-token');
    expect(lines[0]).not.toContain('Ada');
    expect(lines[0]).not.toContain('8001015009087');
  });

  it('returns a server request id and omits auth headers and error text', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: createLoggerOptions({
        write(message) {
          lines.push(message);
        },
      }),
      logController: new RequestLogController(),
      genReqId: () => createRequestId(),
    });
    registerRequestLogging(app);
    app.get('/boom', async () => {
      const error = new Error('Missing theatre for Ada Nkosi 8001015009087');
      error.stack = `${error.stack}`;
      throw error;
    });
    app.setErrorHandler((err, req, reply) => {
      const failure = describeFailure(err);
      logRequestFailure(req, reply, failure);
      return reply.status(failure.status).send({ error: failure.clientError, requestId: req.id });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/no-such-patient/Ada-Nkosi',
      headers: { 'x-request-id': 'req-abc-123' },
    });
    expect(response.statusCode).toBe(404);
    const missing = lines.map((line) => JSON.parse(line) as { route?: string });
    expect(missing.some((entry) => entry.route === '<unmatched>')).toBe(true);
    expect(lines.join('\n')).not.toContain('Ada-Nkosi');

    const failed = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { authorization: 'Bearer header-token', 'x-request-id': 'req-abc-123' },
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.headers['x-request-id']).not.toBe('req-abc-123');
    expect(failed.json().requestId).toBe(failed.headers['x-request-id']);
    const text = lines.join('\n');
    expect(text).not.toContain('header-token');
    expect(text).not.toContain('Ada');
    expect(text).not.toContain('8001015009087');
    expect(text).toContain('req-abc-123');
    expect(text).toContain('"fingerprint"');
    await app.close();
  });
});

describe('API error descriptions', () => {
  it('keeps validation text for the client and logs only a code', () => {
    const parsed = z.object({ phone: z.string().email() }).safeParse({ phone: 'not-an-email' });
    const failure = describeFailure(parsed.error as ZodError);
    expect(failure.status).toBe(400);
    expect(failure.errorCode).toBe('invalid-request');
    expect(failure.clientError).toContain('phone');
    expect(JSON.stringify(failure)).not.toContain('not-an-email');
  });

  it('logs a stable code for a 4xx and no surgeon name', () => {
    const failure = describeFailure(
      new ApiError(409, 'Dr Ada Jacobs is already reserved in Theatre 1.', 'session-clash'),
    );
    expect(failure.errorCode).toBe('session-clash');
    expect(failure.severity).toBe('WARNING');
    expect(failure.clientError).toContain('Jacobs');
    expect(
      JSON.stringify({
        errorCode: failure.errorCode,
        errorName: failure.errorName,
        status: failure.status,
      }),
    ).not.toContain('Jacobs');
    expect(failure.fingerprint).toBeUndefined();
  });

  it('logs a fingerprint and frames for a 500, never the message', () => {
    const error = new Error('Missing theatre for Ada Nkosi 8001015009087 K35.8');
    error.stack = `Error: Missing theatre for Ada Nkosi 8001015009087 K35.8\n    at save (/app/apps/api/service.ts:10:4)`;
    const failure = describeFailure(error);
    expect(failure.status).toBe(500);
    expect(failure.errorName).toBe('Error');
    expect(failure.fingerprint).toMatch(/^[a-f0-9]{16}$/);
    expect(failure.stack).toContain('at save');
    expect(failure.stack).not.toContain('Error:');
    const logged = JSON.stringify(failure);
    expect(logged).not.toContain('Ada');
    expect(logged).not.toContain('8001015009087');
    expect(logged).not.toContain('K35');
    expect(failure.clientError).not.toContain('Ada');
  });
});

describe('client error reports', () => {
  async function appWith(max = 20, globalMax = 200) {
    resetClientErrorBudget();
    const lines: string[] = [];
    const seen: string[] = [];
    const app = Fastify({
      logger: createLoggerOptions({
        write(message) {
          lines.push(message);
        },
      }),
      logController: new RequestLogController(),
      genReqId: () => createRequestId(),
    });
    await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
    registerRequestLogging(app);
    registerClientErrorRoute(app, {
      max,
      globalMax,
      allowOrigin: (origin) => origin === 'http://127.0.0.1:5173',
      identify: async (authorization) => {
        seen.push(authorization);
        if (authorization.endsWith('good-a')) return 'user-a';
        if (authorization.endsWith('good-b')) return 'user-b';
        return authorization.endsWith('good') ? 'user-1' : undefined;
      },
    });
    app.setErrorHandler((err, req, reply) => {
      const failure = describeFailure(err);
      logRequestFailure(req, reply, failure);
      return reply.status(failure.status).send({ error: failure.clientError, requestId: req.id });
    });
    return { app, lines, seen };
  }

  it('logs only the name, fingerprint and same-origin frames at warning', async () => {
    const { app, lines } = await appWith();
    const fingerprint = await messageFingerprint('Missing theatre for Ada Nkosi 8001015009087');
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers: { 'x-request-id': 'client-req-1' },
      payload: {
        reference,
        message: 'Missing theatre for Ada Nkosi 8001015009087',
        patientName: 'Ada Nkosi',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(JSON.stringify(rejected.json())).not.toContain('Ada');
    expect(lines.join('\n')).not.toContain('Ada');

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers: {
        authorization: 'Bearer header-token-good',
        origin: 'http://127.0.0.1:5173',
        'x-request-id': 'client-req-2',
      },
      payload: {
        reference,
        name: 'TypeError',
        fingerprint,
        stack: [
          'Error: Missing theatre for Ada Nkosi 8001015009087 K35.8',
          '    at DevCrash (http://127.0.0.1:5173/assets/index-Ab12.js?patient=Ada:10:5)',
          '    at other (https://evil.example/assets/index.js:1:1)',
          '    at named (http://127.0.0.1:5173/assets/Jane%20Doe.js:1:1)',
        ].join('\n'),
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers['x-request-id']).not.toBe('client-req-2');
    const logged = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.message === 'client error');
    expect(logged?.severity).toBe('WARNING');
    expect(logged?.source).toBe('client');
    expect(logged?.errorName).toBe('TypeError');
    expect(logged?.fingerprint).toBe(fingerprint);
    expect(logged?.uid).toBe('user-1');
    expect(String(logged?.stack)).toContain('http://127.0.0.1:5173/assets/index-Ab12.js:10:5');
    expect(String(logged?.stack)).not.toContain('evil.example');
    expect(String(logged?.stack)).not.toContain('Jane');
    const text = lines.join('\n');
    expect(text).not.toContain('Ada');
    expect(text).not.toContain('8001015009087');
    expect(text).not.toContain('K35');
    expect(text).not.toContain('header-token');
    expect(text).toContain('client-req-2');
    await app.close();
  });

  it('rate limits each account separately and caps reports on the instance', async () => {
    const keyed = await appWith(1, 100);
    const payload = { reference, name: 'Error', fingerprint: '0123456789abcdef' };
    const headers = (token: string) => ({ authorization: `Bearer ${token}` });
    expect(
      (
        await keyed.app.inject({
          method: 'POST',
          url: '/api/client-errors',
          headers: headers('good-a'),
          payload,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await keyed.app.inject({
          method: 'POST',
          url: '/api/client-errors',
          headers: headers('good-a'),
          payload,
        })
      ).statusCode,
    ).toBe(429);
    expect(
      (
        await keyed.app.inject({
          method: 'POST',
          url: '/api/client-errors',
          headers: headers('good-b'),
          payload,
        })
      ).statusCode,
    ).toBe(200);
    await keyed.app.close();

    const global = await appWith(100, 1);
    expect(
      (await global.app.inject({ method: 'POST', url: '/api/client-errors', payload })).statusCode,
    ).toBe(200);
    const limited = await global.app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: { ...payload, patientName: 'Ada Nkosi' },
    });
    expect(limited.statusCode).toBe(429);
    expect(JSON.stringify(limited.json())).not.toContain('Ada');
    await global.app.close();
  });
});
