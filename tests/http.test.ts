import { describe, expect, it } from 'vitest';
import { RequestError, readApiResponse } from '../apps/web/http.ts';
import { shouldHoldForRetry } from '../apps/web/sync-policy.ts';

describe('API response failures', () => {
  it.each([401, 403, 409, 429, 502])(
    'preserves HTTP %i when a gateway returns HTML',
    async (status) => {
      const error = (await readApiResponse(
        new Response('<html>upstream error</html>', { status }),
      ).catch((e: unknown) => e)) as RequestError;
      expect(error.status).toBe(status);
      expect(shouldHoldForRetry(error.status)).toBe(status === 429 || status >= 500);
      expect(error.message).not.toContain('<html>');
    },
  );
  it('does not treat a malformed success as an acknowledged write', async () => {
    for (const body of ['{', 'null', '"okay"'])
      await expect(readApiResponse(new Response(body))).rejects.toMatchObject({ status: 0 });
  });
  it('preserves safe API errors and valid JSON results', async () => {
    await expect(
      readApiResponse(Response.json({ error: 'Access denied' }, { status: 403 })),
    ).rejects.toMatchObject({ status: 403, message: 'Access denied' });
    await expect(readApiResponse(Response.json({ id: 'accepted' }))).resolves.toEqual({
      id: 'accepted',
    });
  });
});
