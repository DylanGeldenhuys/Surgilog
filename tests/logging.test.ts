import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { registerClientErrorRoute } from '../apps/api/client-errors.ts';
import { describeFailure } from '../apps/api/http-error.ts';
import {
  createLoggerOptions,
  criticalLine,
  handleFatal,
  httpRequestFields,
  logEvent,
  logRequestFailure,
  pinoSeverity,
  registerRequestLogging,
  RequestLogController,
  requestIdFrom,
} from '../apps/api/logging.ts';
import { redactText, redactValue } from '../shared/redact.ts';

describe('request logging', () => {
  it('maps pino levels to Cloud Logging severities', () => {
    expect(pinoSeverity('info')).toBe('INFO');
    expect(pinoSeverity('warn')).toBe('WARNING');
    expect(pinoSeverity('error')).toBe('ERROR');
    expect(pinoSeverity('fatal')).toBe('CRITICAL');
  });

  it('accepts a safe request id and ignores injected values', () => {
    expect(requestIdFrom('abc-1234')).toBe('abc-1234');
    expect(requestIdFrom(['req-123456'])).toBe('req-123456');
    expect(requestIdFrom('bad id\nCRITICAL')).not.toBe('bad id\nCRITICAL');
    expect(requestIdFrom('short')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
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
      }),
    ).toEqual({
      requestMethod: 'GET',
      requestUrl: '/api/hospitals/:hospitalId/workspace',
      status: 200,
      userAgent: 'Test',
      remoteIp: '203.0.113.8',
      latency: '0.012s',
      protocol: 'HTTP/1.1',
    });
  });

  it('redacts tokens, auth headers, bodies and patient fields', () => {
    expect(redactText('Bearer super-secret and ada@hospital.test +27 82 555 0199')).toBe(
      'Bearer [redacted] and [redacted] [redacted]',
    );
    expect(
      redactValue({
        authorization: 'Bearer secret',
        body: { patientName: 'Ada', phone: '1' },
        requestId: 'req-123456',
        nested: { token: 'abc', note: 'fine' },
      }),
    ).toEqual({
      authorization: '[redacted]',
      body: '[redacted]',
      requestId: 'req-123456',
      nested: { token: '[redacted]', note: 'fine' },
    });
  });

  it('logs a fatal process error at CRITICAL and then exits', () => {
    const lines: string[] = [];
    const exit = vi.fn();
    handleFatal(
      'unhandledRejection',
      new Error('Bearer leaked-token ada@hospital.test'),
      exit,
      (line) => lines.push(line),
    );
    expect(exit).toHaveBeenCalledWith(1);
    const entry = JSON.parse(lines[0]) as {
      severity: string;
      message: string;
      errorMessage: string;
    };
    expect(entry.severity).toBe('CRITICAL');
    expect(entry.message).toBe('unhandledRejection');
    expect(entry.errorMessage).not.toContain('leaked-token');
    expect(entry.errorMessage).not.toContain('ada@');
    expect(lines[0]).not.toContain('leaked-token');
  });

  it('does not stringify a rejected request object', () => {
    const line = criticalLine('uncaughtException', {
      body: { name: 'Ada' },
      authorization: 'secret',
    });
    expect(line).toContain('non-error rejection');
    expect(line).not.toContain('Ada');
    expect(line).not.toContain('secret');
  });

  it('returns the request id and omits the auth header from request logs', async () => {
    const lines: string[] = [];
    const app = Fastify({
      logger: createLoggerOptions({
        write(message) {
          lines.push(message);
        },
      }),
      logController: new RequestLogController(),
      genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    });
    registerRequestLogging(app);
    app.get('/boom', async () => {
      throw new Error('Bearer header-token');
    });
    app.setErrorHandler((err, req, reply) => {
      const failure = describeFailure(err);
      logEvent(req.log, failure.severity, 'request failed', {
        requestId: req.id,
        method: req.method,
        route: req.routeOptions.url,
        status: failure.status,
        errorMessage: failure.errorMessage,
        stack: failure.stack,
      });
      return reply.status(failure.status).send({ error: failure.clientError, requestId: req.id });
    });
    const response = await app.inject({
      method: 'GET',
      url: '/boom',
      headers: { authorization: 'Bearer header-token', 'x-request-id': 'req-abc-123' },
    });
    expect(response.statusCode).toBe(500);
    expect(response.headers['x-request-id']).toBe('req-abc-123');
    expect(response.json()).toMatchObject({
      error: 'The request could not be confirmed. Retry the same request shortly.',
      requestId: 'req-abc-123',
    });
    const text = lines.join('\n');
    expect(text).not.toContain('header-token');
    expect(text).not.toContain('authorization');
    const failed = lines.map((line) => JSON.parse(line) as { message: string; severity: string });
    expect(
      failed.some((entry) => entry.severity === 'ERROR' && entry.message === 'request failed'),
    ).toBe(true);
    expect(failed.some((entry) => entry.message === 'request' && 'httpRequest' in entry)).toBe(
      true,
    );
    await app.close();
  });
});

describe('API error descriptions', () => {
  it('keeps validation text for the client and logs a generic reason', () => {
    const parsed = z.object({ phone: z.string().email() }).safeParse({ phone: 'not-an-email' });
    const failure = describeFailure(parsed.error as ZodError);
    expect(failure.status).toBe(400);
    expect(failure.severity).toBe('WARNING');
    expect(failure.errorMessage).toBe('invalid request');
    expect(failure.clientError).toContain('phone');
  });

  it('redacts a server failure before it is logged', () => {
    const failure = describeFailure(new Error('Bearer secret-token for ada@hospital.test'));
    expect(failure.status).toBe(500);
    expect(failure.clientError).not.toContain('secret-token');
    expect(failure.errorMessage).not.toContain('secret-token');
    expect(failure.errorMessage).not.toContain('ada@');
    expect(failure.stack).not.toContain('secret-token');
  });
});

describe('client error reports', () => {
  async function appWith(max = 20) {
    const lines: string[] = [];
    const seen: string[] = [];
    const app = Fastify({
      logger: createLoggerOptions({
        write(message) {
          lines.push(message);
        },
      }),
      logController: new RequestLogController(),
      genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    });
    await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
    registerRequestLogging(app);
    registerClientErrorRoute(app, {
      max,
      identify: async (authorization) => {
        seen.push(authorization);
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

  it('logs a redacted report and echoes the request id', async () => {
    const { app, lines, seen } = await appWith();
    const response = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers: {
        authorization: 'Bearer header-token-good',
        'x-request-id': 'client-req-1',
      },
      payload: {
        reference: '11111111-1111-1111-1111-111111111111',
        message: 'Failed for ada@hospital.test Bearer body-token',
        stack: 'Error: ada@hospital.test\n at App',
        path: '/backlog?q=patient',
        patientName: 'Ada',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().requestId).toBe('client-req-1');
    expect(lines.join('\n')).not.toContain('Ada');
    expect(lines.join('\n')).not.toContain('header-token');
    expect(seen).toEqual([]);

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      headers: { authorization: 'Bearer header-token-good', 'x-request-id': 'client-req-2' },
      payload: {
        reference: '11111111-1111-1111-1111-111111111111',
        message: 'Failed for ada@hospital.test Bearer body-token',
        stack: 'Error: ada@hospital.test\n at App',
        path: '/backlog?q=patient',
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers['x-request-id']).toBe('client-req-2');
    expect(accepted.json()).toEqual({ ok: true, requestId: 'client-req-2' });
    const logged = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((entry) => entry.message === 'client error');
    expect(logged?.severity).toBe('ERROR');
    expect(logged?.uid).toBe('user-1');
    expect(logged?.clientPath).toBe('/backlog');
    expect(String(logged?.clientMessage)).not.toContain('ada@');
    expect(String(logged?.clientMessage)).not.toContain('body-token');
    expect(lines.join('\n')).not.toContain('header-token');
    expect(lines.join('\n')).not.toContain('patient');
    expect(seen).toEqual(['Bearer header-token-good']);
    await app.close();
  });

  it('rate limits and rejects an oversized body', async () => {
    const { app } = await appWith(2);
    const payload = {
      reference: '22222222-2222-2222-2222-222222222222',
      message: 'Synthetic failure',
      path: '/',
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/client-errors', payload })).statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/client-errors', payload })).statusCode,
    ).toBe(200);
    const limited = await app.inject({ method: 'POST', url: '/api/client-errors', payload });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatch(/Too many requests/);
    expect(limited.json().requestId).toBeTruthy();
    await app.close();

    const oversizedApp = await appWith();
    const oversized = await oversizedApp.app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: { ...payload, message: 'x'.repeat(5000) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().requestId).toBeTruthy();
    expect(JSON.stringify(oversized.json())).not.toContain('xxxxx');
    await oversizedApp.app.close();
  });
});
