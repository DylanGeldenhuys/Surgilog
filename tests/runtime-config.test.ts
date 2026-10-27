import { describe, expect, it } from 'vitest';
import {
  httpsOrigin,
  isReviewPreviewChannelOrigin,
  serverConfig,
} from '../shared/runtime-config.ts';

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
    expect(config.origins.filter((origin) => typeof origin === 'string')).toEqual([
      'https://theatre-tracker-2f2e5.web.app',
    ]);
    expect(
      config.origins.some(
        (origin) =>
          origin instanceof RegExp &&
          origin.test('https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app'),
      ),
    ).toBe(true);
    expect(() => serverConfig({ ...review, PORT: 'invalid' })).toThrow('PORT');
  });
  it('allows preview channels only for the theatre-tracker-2f2e5 review site', () => {
    // Preview workflow channel id is pr plus the pull-request number. Firebase appends the hash.
    const preview = 'https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app';
    const firebaseApp = 'https://theatre-tracker-2f2e5--pr12-a1b2c3d4.firebaseapp.com';
    expect(isReviewPreviewChannelOrigin(preview)).toBe(true);
    expect(isReviewPreviewChannelOrigin(firebaseApp)).toBe(true);
    expect(
      isReviewPreviewChannelOrigin('https://theatre-tracker-2f2e5--pr2-a1b2c3d4.web.app'),
    ).toBe(true);
    expect(
      isReviewPreviewChannelOrigin(
        `https://theatre-tracker-2f2e5--${'a'}${'b'.repeat(38)}c.web.app`,
      ),
    ).toBe(true);
    for (const origin of [
      'https://theatre-tracker-2f2e5.web.app',
      'https://theatre-tracker-2f2e5.firebaseapp.com',
      'http://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app',
      'https://other-project--pr12-a1b2c3d4.web.app',
      'https://not-theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app',
      'https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app.evil.example',
      'https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app/login',
      'https://user:pass@theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app',
      'https://theatre-tracker-2f2e5--.web.app',
      'https://theatre-tracker-2f2e5--PR12-abc.web.app',
      'https://theatre-tracker-2f2e5--pr12-a1b2c3d4.web.app:443',
      `https://theatre-tracker-2f2e5--${'a'}${'b'.repeat(39)}c.web.app`,
      // A branch-derived channel can keep a dot. The preview workflow does not use that id.
      'https://theatre-tracker-2f2e5--pr12-feature.name-a1b2c3d4.web.app',
    ])
      expect(isReviewPreviewChannelOrigin(origin), origin).toBe(false);
    const other = serverConfig({
      ...review,
      FIREBASE_PROJECT_ID: 'another-review-app',
      ALLOWED_ORIGINS: 'https://another-review-app.web.app',
    });
    expect(other.origins).toEqual(['https://another-review-app.web.app']);
    expect(other.origins.some((origin) => origin instanceof RegExp && origin.test(preview))).toBe(
      false,
    );
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
  it('locks production to its two Hosting origins and disables fictional seeding', () => {
    const prod = {
      APP_ENV: 'prod',
      NODE_ENV: 'production',
      K_SERVICE: 'surgilog-api',
      FIREBASE_PROJECT_ID: 'surgilog-prod',
      ALLOWED_ORIGINS: 'https://surgilog-prod.firebaseapp.com, https://surgilog-prod.web.app',
      FICTIONAL_SEEDING: 'false',
    };
    const config = serverConfig(prod);
    expect(config.mode).toBe('prod');
    expect(config.local).toBe(false);
    expect(config.origins).toEqual([
      'https://surgilog-prod.web.app',
      'https://surgilog-prod.firebaseapp.com',
    ]);
    expect(config.origins.every((origin) => typeof origin === 'string')).toBe(true);
    expect(() =>
      serverConfig({
        ...prod,
        FIREBASE_PROJECT_ID: 'theatre-tracker-2f2e5',
        ALLOWED_ORIGINS:
          'https://theatre-tracker-2f2e5.web.app,https://theatre-tracker-2f2e5.firebaseapp.com',
      }),
    ).toThrow('dev/review project');
    expect(() => serverConfig({ ...prod, FICTIONAL_SEEDING: 'true' })).toThrow('FICTIONAL_SEEDING');
    expect(() => serverConfig({ ...prod, FICTIONAL_SEEDING: undefined })).toThrow(
      'FICTIONAL_SEEDING',
    );
    expect(() =>
      serverConfig({
        ...prod,
        ALLOWED_ORIGINS: 'https://surgilog-prod.web.app,https://theatre-tracker-2f2e5.web.app',
      }),
    ).toThrow('two production Hosting origins');
    expect(() =>
      serverConfig({
        ...prod,
        ALLOWED_ORIGINS:
          'https://surgilog-prod.web.app,https://surgilog-prod.firebaseapp.com,https://surgilog-prod--pr1-abcd.web.app',
      }),
    ).toThrow('two production Hosting origins');
    expect(() => serverConfig({ ...prod, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toThrow(
      'emulator',
    );
  });
});
