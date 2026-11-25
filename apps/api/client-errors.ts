import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { clientStackFrames, safeErrorName } from '../../shared/client-error.ts';
import { logEvent, rememberedClientRequestId } from './logging.ts';

export const CLIENT_ERROR_BODY_LIMIT = 4 * 1024;
export const CLIENT_ERROR_RATE_MAX = 20;
export const CLIENT_ERROR_GLOBAL_MAX = 200;

const clientErrorSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{8,80}$/),
    name: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_]{0,40}$/),
    fingerprint: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{16}$/),
    stack: z.string().max(2000).optional(),
  })
  .strict();

export type ClientIdentity = (authorization: string) => Promise<string | undefined>;

const actors = new WeakMap<FastifyRequest, Promise<string | undefined>>();
let globalWindow = 0;
let globalCount = 0;

export function resetClientErrorBudget() {
  globalWindow = 0;
  globalCount = 0;
}

function takeGlobalSlot(max: number) {
  const now = Date.now();
  if (now - globalWindow >= 60_000) {
    globalWindow = now;
    globalCount = 0;
  }
  globalCount += 1;
  return globalCount <= max;
}

function actorFor(req: FastifyRequest, identify?: ClientIdentity) {
  let pending = actors.get(req);
  if (!pending) {
    pending = (async () => {
      const authorization = req.headers.authorization;
      if (!identify || typeof authorization !== 'string') return undefined;
      try {
        const uid = await identify(authorization);
        return uid && /^[\w-]{1,128}$/.test(uid) ? uid : undefined;
      } catch {
        return undefined;
      }
    })();
    actors.set(req, pending);
  }
  return pending;
}

export function registerClientErrorRoute(
  app: FastifyInstance,
  options?: {
    max?: number;
    globalMax?: number;
    identify?: ClientIdentity;
    allowOrigin?: (origin: string) => boolean;
  },
) {
  const max = options?.max ?? CLIENT_ERROR_RATE_MAX;
  const globalMax = options?.globalMax ?? CLIENT_ERROR_GLOBAL_MAX;
  app.post(
    '/api/client-errors',
    {
      bodyLimit: CLIENT_ERROR_BODY_LIMIT,
      config: {
        rateLimit: {
          max,
          timeWindow: '1 minute',
          keyGenerator: async (req) => {
            const uid = await actorFor(req, options?.identify);
            return uid ? `uid:${uid}` : `ip:${req.ip}`;
          },
        },
      },
    },
    async (req, reply) => {
      if (!takeGlobalSlot(globalMax))
        return reply
          .status(429)
          .send({ error: 'Too many requests. Please retry shortly.', requestId: req.id });
      const parsed = clientErrorSchema.safeParse(req.body);
      if (!parsed.success)
        return reply
          .status(400)
          .send({ error: 'The error report was not accepted.', requestId: req.id });
      const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;
      const stack =
        origin && options?.allowOrigin?.(origin)
          ? clientStackFrames(parsed.data.stack, origin)
          : undefined;
      const uid = await actorFor(req, options?.identify);
      const clientRequestId = rememberedClientRequestId(req);
      logEvent(req.log, 'WARNING', 'client error', {
        requestId: String(req.id),
        ...(clientRequestId ? { clientRequestId } : {}),
        source: 'client',
        method: 'POST',
        route: '/api/client-errors',
        status: 200,
        errorName: safeErrorName(parsed.data.name),
        fingerprint: parsed.data.fingerprint,
        clientReference: parsed.data.reference,
        ...(stack ? { stack } : {}),
        ...(uid ? { uid } : {}),
      });
      return { ok: true, requestId: req.id };
    },
  );
}
