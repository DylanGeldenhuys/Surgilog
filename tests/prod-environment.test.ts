import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEV_API_ORIGIN,
  DEV_PROJECT_ID,
  assertCloudRunOrigin,
  assertDeployTarget,
  assertFictionalDataScriptAllowed,
} from '../shared/deploy-target.ts';
import { loadProdTarget, parseFlatYaml } from '../scripts/prod-target.ts';

const prodProject = 'surgilog-prod';
const ready = {
  buildMode: 'prod',
  buildProjectId: prodProject,
  targetProjectId: prodProject,
  prodProjectId: prodProject,
  devProjectId: DEV_PROJECT_ID,
  confirmProd: true,
  placeholder: false,
  deploying: true,
};

describe('production target', () => {
  it('keeps the placeholder project id in the alias and config, with copies locked', () => {
    const target = loadProdTarget();
    const review = JSON.parse(readFileSync('config/review.json', 'utf8'));
    expect(target.placeholder).toBe(true);
    expect(target.projectId).toBe(prodProject);
    expect(target.projectId).not.toBe(DEV_PROJECT_ID);
    expect(target.region).toBe('africa-south1');
    expect(target.service).toBe('surgilog-api');
    expect(target.fictionalSeeding).toBe(false);
    expect(target.env.FICTIONAL_SEEDING).toBe('false');
    expect(target.env.APP_ENV).toBe('prod');
    expect(target.apiUrlPlaceholder).toBe('https://surgilog-api-placeholder.africa-south1.run.app');
    expect(target.firebase.apiKey.startsWith('placeholder')).toBe(true);
    expect(JSON.stringify(target)).not.toContain(review.firebase.apiKey);
    expect(JSON.stringify(target.env)).not.toMatch(/SECRET|PASSWORD|TOKEN|PRIVATE_KEY/);
    expect(readFileSync('config/prod-api.yaml', 'utf8')).not.toContain('AIza');
  });

  it('refuses to cross-deploy dev and production builds', () => {
    expect(() => assertDeployTarget(ready)).not.toThrow();
    expect(() => assertDeployTarget({ ...ready, targetProjectId: DEV_PROJECT_ID })).toThrow(
      'production build to the dev/review project',
    );
    expect(() =>
      assertDeployTarget({
        ...ready,
        buildMode: 'review',
        buildProjectId: DEV_PROJECT_ID,
        targetProjectId: prodProject,
        confirmProd: false,
      }),
    ).toThrow('dev/review build to the production project');
    expect(() => assertDeployTarget({ ...ready, confirmProd: false })).toThrow(
      'requires confirmation',
    );
    expect(() => assertDeployTarget({ ...ready, placeholder: true })).toThrow(
      'placeholder project',
    );
    expect(() =>
      assertDeployTarget({
        ...ready,
        buildMode: 'local',
        buildProjectId: 'demo-theatre-tracker',
        targetProjectId: prodProject,
      }),
    ).toThrow('local or demo');
    expect(() =>
      assertDeployTarget({ ...ready, deploying: false, confirmProd: false, placeholder: true }),
    ).not.toThrow();
    expect(() => assertDeployTarget({ ...ready, targetProjectId: undefined })).toThrow(
      'without an explicit project id',
    );
    expect(() =>
      assertDeployTarget({
        ...ready,
        deploying: false,
        targetProjectId: undefined,
        confirmProd: false,
        placeholder: true,
      }),
    ).not.toThrow();
  });

  it('blocks fictional scripts in any prod context and allows confirmed migrations', () => {
    const fictional = 'Fictional seeding and review setup are disabled for production';
    const migration = 'Production data migrations require CONFIRM_PROD';
    const seed = ['node', '/repo/scripts/seed.ts'];
    const migrate = ['node', 'scripts/migrate-priority-policy.ts'];
    expect(() => assertFictionalDataScriptAllowed(seed, { APP_ENV: 'prod' }, prodProject)).toThrow(
      fictional,
    );
    expect(() =>
      assertFictionalDataScriptAllowed(seed, { FIREBASE_PROJECT_ID: prodProject }, prodProject),
    ).toThrow(fictional);
    expect(() =>
      assertFictionalDataScriptAllowed(seed, { GCLOUD_PROJECT: prodProject }, prodProject),
    ).toThrow(fictional);
    expect(() =>
      assertFictionalDataScriptAllowed(seed, { GOOGLE_CLOUD_PROJECT: prodProject }, prodProject),
    ).toThrow(fictional);
    expect(() =>
      assertFictionalDataScriptAllowed([...seed, '--project', prodProject], {}, prodProject),
    ).toThrow(fictional);
    expect(() =>
      assertFictionalDataScriptAllowed([...seed, `--project=${prodProject}`], {}, prodProject),
    ).toThrow(fictional);
    expect(() =>
      assertFictionalDataScriptAllowed(seed, { FICTIONAL_SEEDING: 'false' }, prodProject),
    ).toThrow('FICTIONAL_SEEDING=false is a hard stop');
    expect(() => assertFictionalDataScriptAllowed(seed, {}, prodProject)).not.toThrow();
    expect(() =>
      assertFictionalDataScriptAllowed(seed, { FIREBASE_PROJECT_ID: DEV_PROJECT_ID }, prodProject),
    ).not.toThrow();
    expect(() => assertFictionalDataScriptAllowed(seed, {}, '')).toThrow(
      'production project id was not available',
    );
    for (const script of [
      'scripts/setup-review.ts',
      'scripts/review-admin.ts',
      'scripts/backfill-seed-history.ts',
      'scripts/synthetic-fixtures.ts',
    ]) {
      expect(() =>
        assertFictionalDataScriptAllowed(['node', script], { APP_ENV: 'prod' }, prodProject),
      ).toThrow(fictional);
    }
    expect(() =>
      assertFictionalDataScriptAllowed(
        ['node', '/repo/apps/api/server.ts'],
        { APP_ENV: 'prod' },
        '',
      ),
    ).not.toThrow();
    expect(() =>
      assertFictionalDataScriptAllowed(migrate, { APP_ENV: 'prod' }, prodProject),
    ).toThrow(migration);
    expect(() =>
      assertFictionalDataScriptAllowed(
        migrate,
        { APP_ENV: 'prod', FICTIONAL_SEEDING: 'false' },
        prodProject,
      ),
    ).toThrow(migration);
    expect(() =>
      assertFictionalDataScriptAllowed(migrate, { FIREBASE_PROJECT_ID: prodProject }, prodProject),
    ).toThrow(migration);
    expect(() =>
      assertFictionalDataScriptAllowed(
        migrate,
        { APP_ENV: 'prod', CONFIRM_PROD: 'yes' },
        prodProject,
      ),
    ).not.toThrow();
    expect(() =>
      assertFictionalDataScriptAllowed(
        [...migrate, '--confirm-prod'],
        { APP_ENV: 'prod' },
        prodProject,
      ),
    ).not.toThrow();
    expect(() =>
      assertFictionalDataScriptAllowed(migrate, { FICTIONAL_SEEDING: 'false' }, prodProject),
    ).not.toThrow();
    expect(() => assertFictionalDataScriptAllowed(migrate, {}, prodProject)).not.toThrow();
    expect(() => assertCloudRunOrigin(DEV_API_ORIGIN)).toThrow('dev API');
    expect(assertCloudRunOrigin('https://surgilog-api-placeholder.africa-south1.run.app')).toBe(
      'https://surgilog-api-placeholder.africa-south1.run.app',
    );
    expect(parseFlatYaml('APP_ENV: prod\n# comment\nFICTIONAL_SEEDING: "false"\n')).toEqual({
      APP_ENV: 'prod',
      FICTIONAL_SEEDING: 'false',
    });
    expect(() => parseFlatYaml('API_TOKEN: secret\n')).toThrow('secrets');
  });

  it('refuses a production deploy while the project id is still the placeholder', () => {
    const result = runGuard(['--target', 'prod', '--confirm-prod']);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toContain('placeholder');
    const review = runGuard(['--target', 'review', '--project', DEV_PROJECT_ID]);
    expect(review.status).toBe(0);
  });

  it('reads a missing --project from the environment instead of the next flag', () => {
    const fromEnv = runGuard(['--target', 'review'], { GCLOUD_PROJECT: DEV_PROJECT_ID });
    expect(fromEnv.status).toBe(0);
    expect(fromEnv.stdout).toContain(`Review target ${DEV_PROJECT_ID}`);
    const fromProjectId = runGuard(['--target', 'review'], { PROJECT_ID: DEV_PROJECT_ID });
    expect(fromProjectId.status).toBe(0);
    expect(fromProjectId.stdout).toContain(`Review target ${DEV_PROJECT_ID}`);
    const missing = runGuard(['--target', 'review']);
    const output = `${missing.stdout}\n${missing.stderr}`;
    expect(missing.status).not.toBe(0);
    expect(output).toContain('requires the target project');
    expect(output).not.toContain('does not match the build');
  });
});

function runGuard(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv = { ...process.env };
  for (const key of ['GCLOUD_PROJECT', 'PROJECT_ID', 'GOOGLE_CLOUD_PROJECT', 'CONFIRM_PROD'])
    delete childEnv[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return spawnSync('npx', ['tsx', 'scripts/guard-deploy.ts', ...args], {
    encoding: 'utf8',
    env: childEnv,
  });
}
