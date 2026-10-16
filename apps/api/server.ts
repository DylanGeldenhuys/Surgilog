import { theatreReport } from './theatre.ts';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { auth, runtime } from './firebase.ts';
import { ApiError, me, workspace, reportingWorkspace, execute, caseHistory } from './service.ts';
import { adminWorkspace, administer } from './admin.ts';
import { authFailureStatus } from './auth-errors.ts';
const app = Fastify({ logger: false, bodyLimit: 128 * 1024 });
await app.register(cors, { origin: runtime.origins });
await app.register(helmet);
await app.register(rateLimit, { max: 180, timeWindow: '1 minute' });
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
  mode: runtime.local ? 'local-emulators' : 'review',
  projectId: runtime.projectId,
  capabilities: ['admin-v1', 'theatre-register-v1'],
}));
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
app.post<{ Params: { hospitalId: string } }>('/api/hospitals/:hospitalId/operations', async (req) =>
  execute(await uid(req), req.params.hospitalId, req.body),
);
app.setErrorHandler((err, req, res) => {
  if (err instanceof ZodError)
    return res
      .status(400)
      .send({ error: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
  if (err instanceof ApiError) return res.status(err.status).send({ error: err.message });
  const code = (err as { statusCode?: number }).statusCode;
  if (code && code < 500)
    return res.status(code).send({
      error: code === 429 ? 'Too many requests. Please retry shortly.' : 'Invalid request.',
    });
  console.error('API request failed', { requestId: req.id, code: (err as any).code ?? 'unknown' });
  return res.status(500).send({
    error: 'The request could not be confirmed. Retry the same request shortly.',
  });
});
await app.listen({ port: runtime.port, host: runtime.host });
console.log(`Theatre Tracker API listening on port ${runtime.port} (${runtime.mode})`);
process.on('SIGTERM', () => {
  void app.close();
});
