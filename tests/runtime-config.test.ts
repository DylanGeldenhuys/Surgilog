import { describe, expect, it } from 'vitest';
import { httpsOrigin, serverConfig } from '../shared/runtime-config.ts';

const review = {
  APP_ENV: 'review',
  NODE_ENV: 'production',
  FIREBASE_PROJECT_ID: 'theatre-tracker-2f2e5',
  ALLOWED_ORIGINS: 'https://theatre-tracker-2f2e5.web.app',
};
describe('environment isolation', () => {
  it('keeps local development on the explicit demo project', () => {
    const config = serverConfig({ GOOGLE_CLOUD_PROJECT: 'unrelated-project' });
    expect(config.projectId).toBe('demo-theatre-tracker');
    expect(config.local).toBe(true);
    expect(config.host).toBe('127.0.0.1');
  });
  it('refuses an emulator default when started in a hosted runtime', () => {
    expect(() => serverConfig({ NODE_ENV: 'production' })).toThrow('explicit APP_ENV');
    expect(() => serverConfig({ K_SERVICE: 'review' })).toThrow('explicit APP_ENV');
    expect(() => serverConfig({ APP_ENV: 'typo' })).toThrow('APP_ENV');
  });
  it('rejects emulator endpoints and demo project ids in cloud mode', () => {
    for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'])
      expect(() => serverConfig({ ...review, [key]: '127.0.0.1:9099' })).toThrow('emulator');
    expect(() => serverConfig({ ...review, FIREBASE_PROJECT_ID: 'demo-theatre-tracker' })).toThrow(
      'real FIREBASE_PROJECT_ID',
    );
    expect(() => serverConfig({ ...review, FIREBASE_PROJECT_ID: undefined })).toThrow(
      'real FIREBASE_PROJECT_ID',
    );
  });
  it('binds the review backend to the injected port and approved origins', () => {
    const config = serverConfig({ ...review, PORT: '8081' });
    expect(config.host).toBe('0.0.0.0');
    expect(config.port).toBe(8081);
    expect(config.origins).toEqual(['https://theatre-tracker-2f2e5.web.app']);
    expect(() => serverConfig({ ...review, PORT: 'invalid' })).toThrow('PORT');
  });
  it('rejects missing, plaintext, localhost and credential-bearing cloud origins', () => {
    for (const origin of [
      undefined,
      '*',
      'http://example.com',
      'https://localhost',
      'https://127.0.0.1',
      'https://user:secret@example.com',
      'https://example.com/api',
      'https://example.com?token=value',
    ])
      expect(() => httpsOrigin(origin, 'origin')).toThrow();
    expect(() => serverConfig({ ...review, ALLOWED_ORIGINS: undefined })).toThrow();
  });
});
