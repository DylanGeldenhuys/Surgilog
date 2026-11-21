import { describe, expect, it, vi } from 'vitest';
import { clientErrorPayload, messageFingerprint } from '../shared/client-error.ts';
import { postClientError } from '../apps/web/client-error.ts';

describe('browser error reports', () => {
  it('sends a name, fingerprint and same-origin frames, not the message', async () => {
    const payload = await clientErrorPayload(
      {
        reference: '11111111-1111-1111-1111-111111111111',
        name: 'TypeError',
        message: 'Could not save Ada Nkosi 8001015009087 Bearer session-token',
        stack: [
          'Error: Ada Nkosi',
          '    at save (http://127.0.0.1:5173/apps/web/state.ts:10:4)',
          '    at other (https://evil.example/a.js:1:1)',
        ].join('\n'),
      },
      'http://127.0.0.1:5173',
    );
    expect(payload).toEqual({
      reference: '11111111-1111-1111-1111-111111111111',
      name: 'TypeError',
      fingerprint: await messageFingerprint(
        'Could not save Ada Nkosi 8001015009087 Bearer session-token',
      ),
      stack: 'at save (http://127.0.0.1:5173/apps/web/state.ts:10:4)',
    });
    expect(JSON.stringify(payload)).not.toContain('Ada');
    expect(JSON.stringify(payload)).not.toContain('8001015009087');
    expect(JSON.stringify(payload)).not.toContain('session-token');
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
        {
          reference: '11111111-1111-1111-1111-111111111111',
          name: 'Error',
          message: 'Broken',
        },
        { origin: 'http://api.test', fetchImpl, token: 'session-token' },
      ),
    ).resolves.toBe('server-req-9');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({ Authorization: 'Bearer session-token' });
    expect(String(init.body)).not.toContain('session-token');
    expect(String(init.body)).not.toContain('Broken');

    await expect(
      postClientError(
        {
          reference: '11111111-1111-1111-1111-111111111111',
          name: 'Error',
          message: 'Broken',
        },
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
