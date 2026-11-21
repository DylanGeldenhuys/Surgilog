import { describe, expect, it, vi } from 'vitest';
import { clientErrorPayload } from '../shared/client-error.ts';
import { postClientError } from '../apps/web/client-error.ts';

describe('browser error reports', () => {
  it('drops query text, emails and tokens before the report leaves the browser', () => {
    expect(
      clientErrorPayload({
        reference: '11111111-1111-1111-1111-111111111111',
        message: 'Could not save ada@hospital.test Bearer session-token',
        stack: 'Error: +27 82 555 0199',
        path: '/backlog?patient=Ada#notes',
      }),
    ).toEqual({
      reference: '11111111-1111-1111-1111-111111111111',
      message: 'Could not save [redacted] Bearer [redacted]',
      stack: 'Error: [redacted]',
      path: '/backlog',
    });
  });

  it('returns the server request id and still resolves when the report cannot be sent', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, requestId: 'server-req-9' }), {
        status: 200,
        headers: { 'x-request-id': 'server-req-9', 'content-type': 'application/json' },
      });
    });
    await expect(
      postClientError(
        { reference: '11111111-1111-1111-1111-111111111111', message: 'Broken', path: '/' },
        { origin: 'http://api.test', fetchImpl, token: 'session-token' },
      ),
    ).resolves.toBe('server-req-9');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer session-token' });
    expect(String(init.body)).not.toContain('session-token');

    await expect(
      postClientError(
        { reference: '11111111-1111-1111-1111-111111111111', message: 'Broken', path: '/' },
        {
          origin: 'http://api.test',
          fetchImpl: vi.fn(async () => {
            throw new Error('offline');
          }),
        },
      ),
    ).resolves.toBeUndefined();
  });
});
