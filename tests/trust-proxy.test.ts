import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trustProxySetting } from '../apps/api/trust-proxy.ts';

describe('Cloud Run client address', () => {
  it('ignores forwarded addresses unless the process is on Cloud Run', () => {
    expect(trustProxySetting({})).toBe(false);
    expect(trustProxySetting({ K_SERVICE: '' })).toBe(false);
    expect(typeof trustProxySetting({ K_SERVICE: 'theatre-tracker-api' })).toBe('function');
  });

  it('uses the address added by one proxy, not a spoofed prefix or the proxy itself', async () => {
    const app = Fastify({ trustProxy: trustProxySetting({ K_SERVICE: 'theatre-tracker-api' }) });
    app.get('/who', (req) => ({ ip: req.ip }));
    const response = await app.inject({
      method: 'GET',
      url: '/who',
      remoteAddress: '10.0.0.8',
      headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.4' },
    });
    expect(response.json()).toEqual({ ip: '203.0.113.4' });

    const local = Fastify({ trustProxy: trustProxySetting({}) });
    local.get('/who', (req) => ({ ip: req.ip }));
    const direct = await local.inject({
      method: 'GET',
      url: '/who',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.9' },
    });
    expect(direct.json()).toEqual({ ip: '127.0.0.1' });
    await app.close();
    await local.close();
  });
});

describe('runtime alignment', () => {
  it('builds and tests the API on the same Node 22 release', () => {
    expect(readFileSync('Dockerfile', 'utf8')).toContain('FROM node:22.23-bookworm-slim');
    expect(readFileSync('Dockerfile', 'utf8')).not.toContain('node:24');
    for (const file of [
      '.github/workflows/ci.yml',
      '.github/workflows/deploy-dev.yml',
      '.github/workflows/deploy-prod.yml',
      '.github/workflows/preview.yml',
    ]) {
      const workflow = readFileSync(file, 'utf8');
      expect(workflow).toContain('node-version: 22');
      expect(workflow).not.toContain('node-version: 24');
    }
  });
});
