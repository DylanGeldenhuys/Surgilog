import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clientErrorPayload } from '../../shared/client-error.ts';
import { logEvent } from './logging.ts';

export const CLIENT_ERROR_BODY_LIMIT = 4 * 1024;
export const CLIENT_ERROR_RATE_MAX = 20;

const clientErrorSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{8,80}$/),
    message: z.string().trim().min(1).max(300),
    stack: z.string().max(2000).optional(),
    path: z.string().max(200).optional(),
  })
  .strict();

export type ClientIdentity = (authorization: string) => Promise<string | undefined>;

export function registerClientErrorRoute(
  app: FastifyInstance,
  options?: { max?: number; identify?: ClientIdentity },
) {
  const max = options?.max ?? CLIENT_ERROR_RATE_MAX;
  app.post(
    '/api/client-errors',
    {
      bodyLimit: CLIENT_ERROR_BODY_LIMIT,
      config: { rateLimit: { max, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const parsed = clientErrorSchema.safeParse(req.body);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'The error report was not accepted.', requestId: req.id });
      const report = clientErrorPayload(parsed.data);
      let uid: string | undefined;
      const authorization = req.headers.authorization;
      if (options?.identify && typeof authorization === 'string') {
        try {
          uid = await options.identify(authorization);
        } catch {
          uid = undefined;
        }
      }
      logEvent(req.log, 'ERROR', 'client error', {
        requestId: req.id,
        method: 'POST',
        route: '/api/client-errors',
        status: 200,
        clientReference: report.reference,
        clientMessage: report.message,
        ...(report.stack ? { stack: report.stack } : {}),
        clientPath: report.path,
        ...(uid ? { uid } : {}),
      });
      return { ok: true, requestId: req.id };
    },
  );
}
