import type { FastifyServerOptions } from 'fastify';

type TrustProxy = NonNullable<FastifyServerOptions['trustProxy']>;

/**
 * Cloud Run sits behind one Google frontend. That hop appends the real client
 * address to X-Forwarded-For. Trusting every hop would let a caller pick the
 * address used for rate limits. Local runs have no proxy.
 */
export function trustProxySetting(env: NodeJS.ProcessEnv): TrustProxy {
  if (!env.K_SERVICE) return false;
  return (_address, hop) => hop < 1;
}
