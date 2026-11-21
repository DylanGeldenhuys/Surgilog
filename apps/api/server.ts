import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { theatreReport } from './theatre.ts';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { auth, runtime } from './firebase.ts';
import { ApiError, me, workspace, reportingWorkspace, execute, caseHistory } from './service.ts';
import { adminWorkspace, administer } from './admin.ts';
import { authFailureStatus } from './auth-errors.ts';
import { registerClientErrorRoute } from './client-errors.ts';
import { describeFailure } from './http-error.ts';
import {
  createLoggerOptions,
  installFatalHandlers,
  logRequestFailure,
  registerRequestLogging,
  RequestLogController,
  requestIdFrom,
} from './logging.ts';

export async function buildApp() {
  const app = Fastify({
    logger: createLoggerOptions(),
    logController: new RequestLogController(),
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    bodyLimit: 128 * 1024,
  });
  await app.register(cors, { origin: runtime.origins });
  await app.register(helmet);
  await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
  registerRequestLogging(app);
  app.addHook('onSend', async (_req, res, payload) => {
    res.header('Cache-Control', 'no-store');
    return payload;
  });
  async function uid(req: { headers: Record<string, any> }) {
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) throw new ApiError(401, 'Sign in to continue.');
    try {
      return (await auth.verifyIdToken(token, true)).uid;
    } catch (error) {
      const status = authFailureStatus(error);
      throw new ApiError(
        status,
        status === 401
          ? 'Sign in again to synchronise your work.'
          : 'Account verification is temporarily unavailable. Please retry shortly.',
      );
    }
  }
  app.get('/health', async () => ({
    ok: true,
    mode: runtime.local ? 'local-emulators' : runtime.mode,
    projectId: runtime.projectId,
    capabilities: ['admin-v1', 'theatre-register-v1'],
  }));
  registerClientErrorRoute(app, {
    identify: async (authorization) => {
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';
      if (!token) return undefined;
      try {
        return (await auth.verifyIdToken(token, true)).uid;
      } catch {
        return undefined;
      }
    },
  });
  app.get<{ Querystring: { hospitalId: string; departmentId: string; from: string; to: string } }>(
    '/api/reporting/theatre',
    async (req) => {
      const query = z
        .object({
          hospitalId: z.string().regex(/^[\w-]{1,100}$/),
          departmentId: z.string().regex(/^[\w-]{1,100}$/),
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        })
        .strict()
        .parse(req.query);
      return theatreReport(
        await uid(req),
        query.hospitalId,
        query.departmentId,
        query.from,
        query.to,
      );
    },
  );
  app.get('/api/me', async (req) => me(await uid(req)));
  app.get('/api/admin', async (req) => adminWorkspace(await uid(req)));
  app.post('/api/admin/operations', async (req) => administer(await uid(req), req.body));
  app.get<{
    Querystring: {
      hospitalIds?: string;
      departmentKeys?: string;
      hospitalId?: string;
      departmentId?: string;
    };
  }>('/api/reporting/overview', async (req) => {
    const userId = await uid(req);
    const query = z
      .object({
        hospitalIds: z.string().max(10100).optional(),
        departmentKeys: z.string().max(101000).optional(),
        hospitalId: z.string().max(100).optional(),
        departmentId: z.string().max(100).optional(),
      })
      .strict()
      .parse(req.query);
    const hospitalIds = query.hospitalIds
        ? query.hospitalIds.split(',').filter(Boolean)
        : query.hospitalId && query.hospitalId !== 'all'
          ? [query.hospitalId]
          : null,
      departmentKeys = query.departmentKeys
        ? query.departmentKeys.split(',').filter(Boolean)
        : query.departmentId && query.departmentId !== 'all' && hospitalIds?.length === 1
          ? [`${hospitalIds[0]}/${query.departmentId}`]
          : null,
      departments = departmentKeys?.map((key) => {
        const [hospitalId, departmentId, ...extra] = key.split('/');
        if (!hospitalId || !departmentId || extra.length)
          throw new ApiError(400, 'Invalid department selection.');
        return { hospitalId, departmentId };
      });
    return reportingWorkspace(userId, hospitalIds, departments ?? null);
  });
  app.get<{ Params: { hospitalId: string }; Querystring: { departmentId: string } }>(
    '/api/hospitals/:hospitalId/workspace',
    async (req) => workspace(await uid(req), req.params.hospitalId, req.query.departmentId),
  );
  app.get<{ Params: { hospitalId: string; caseId: string } }>(
    '/api/hospitals/:hospitalId/cases/:caseId/history',
    async (req) => caseHistory(await uid(req), req.params.hospitalId, req.params.caseId),
  );
  app.post<{ Params: { hospitalId: string } }>(
    '/api/hospitals/:hospitalId/operations',
    async (req) => execute(await uid(req), req.params.hospitalId, req.body),
  );
  app.setErrorHandler((err, req, reply) => {
    const failure = describeFailure(err);
    logRequestFailure(req, reply, failure);
    return reply.status(failure.status).send({ error: failure.clientError, requestId: req.id });
  });
  return app;
}

function runningAsServer() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (runningAsServer()) {
  installFatalHandlers();
  const app = await buildApp();
  await app.listen({ port: runtime.port, host: runtime.host });
  process.on('SIGTERM', () => {
    void app.close();
  });
}
