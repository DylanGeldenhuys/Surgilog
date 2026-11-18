import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEV_API_ORIGIN,
  DEV_PROJECT_ID,
  assertCloudRunOrigin,
  assertDeployTarget,
  assertFictionalDataScriptAllowed,
} from '../shared/deploy-target.ts';
import { loadProdTarget, parseFlatYaml } from '../scripts/prod-target.ts';
import {
  assertTargetHints,
  assertWorkflowRef,
  devDeployValues,
  prodDeployValues,
} from '../scripts/guard-deploy.ts';
import { assertHealthy, revisionUrl } from '../scripts/smoke-check-revision.ts';

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

  it('stops a dev run from targeting prod and a prod run from targeting dev', () => {
    const dir = mkdtempSync(join(tmpdir(), 'guard-'));
    const output = join(dir, 'github-output');
    const dev = runGuard(['--target', 'dev', '--github-output'], {
      GITHUB_OUTPUT: output,
      CONFIRM_PROD: 'yes',
    });
    expect(dev.status).toBe(0);
    const body = readFileSync(output, 'utf8');
    expect(body).toContain(`project_id=${DEV_PROJECT_ID}`);
    expect(body).toContain('service=theatre-tracker-api');
    expect(body).toContain('region=africa-south1');
    expect(body).toContain(`api_origin=${DEV_API_ORIGIN}`);
    expect(body).toContain('health_mode=review');
    expect(body).toContain('env_file=config/review-api.yaml');
    expect(body).not.toContain(prodProject);
    expect(body).not.toContain('health_mode=prod');
    expect(dev.stdout).toContain('Nothing has been deployed');

    const devAtProd = runGuard(['--target', 'dev', '--project', prodProject]);
    expect(devAtProd.status).not.toBe(0);
    expect(`${devAtProd.stdout}\n${devAtProd.stderr}`).toContain(
      'Refusing a dev deploy aimed at the production project.',
    );
    const reviewAtProd = runGuard(['--target', 'review', '--project', prodProject]);
    expect(reviewAtProd.status).not.toBe(0);
    expect(`${reviewAtProd.stdout}\n${reviewAtProd.stderr}`).toContain(
      'Refusing a dev deploy aimed at the production project.',
    );
    const prodAtDev = runGuard(['--target', 'prod', '--confirm-prod', '--project', DEV_PROJECT_ID]);
    expect(prodAtDev.status).not.toBe(0);
    expect(`${prodAtDev.stdout}\n${prodAtDev.stderr}`).toContain(
      'Refusing a production deploy aimed at the dev/review project.',
    );
    expect(`${prodAtDev.stdout}\n${prodAtDev.stderr}`).not.toContain('ready to deploy');

    const devOnMain = runGuard(['--target', 'dev'], { GITHUB_REF: 'refs/heads/main' });
    expect(devOnMain.status).not.toBe(0);
    expect(`${devOnMain.stdout}\n${devOnMain.stderr}`).toContain(
      'Refusing a dev deploy from refs/heads/main.',
    );
    const prodOnDev = runGuard(['--target', 'prod', '--confirm-prod'], {
      GITHUB_REF: 'refs/heads/dev',
    });
    expect(prodOnDev.status).not.toBe(0);
    expect(`${prodOnDev.stdout}\n${prodOnDev.stderr}`).toContain(
      'Refusing a production deploy from refs/heads/dev.',
    );
    const devOnDev = runGuard(['--target', 'dev'], { GITHUB_REF: 'refs/heads/dev' });
    expect(devOnDev.status).toBe(0);
  });

  it('keeps the dev API address and the production health mode apart', () => {
    const target = loadProdTarget();
    const prod = prodDeployValues(target);
    const dev = devDeployValues();
    expect(prod.health_mode).toBe('prod');
    expect(prod.env_file).toBe('config/prod-api.yaml');
    expect(prod.project_id).toBe(prodProject);
    expect(prod.service).toBe('surgilog-api');
    expect(JSON.stringify(prod)).not.toContain(DEV_PROJECT_ID);
    expect(dev).toMatchObject({
      project_id: DEV_PROJECT_ID,
      region: 'africa-south1',
      service: 'theatre-tracker-api',
      env_file: 'config/review-api.yaml',
      health_mode: 'review',
      api_origin: DEV_API_ORIGIN,
      runtime_service_account: `theatre-tracker-api@${DEV_PROJECT_ID}.iam.gserviceaccount.com`,
    });
    expect(() => assertTargetHints('dev', [prodProject], DEV_PROJECT_ID, prodProject)).toThrow(
      'aimed at the production project',
    );
    expect(() => assertTargetHints('prod', [DEV_PROJECT_ID], prodProject, DEV_PROJECT_ID)).toThrow(
      'aimed at the dev/review project',
    );
    expect(() => assertWorkflowRef('prod', 'refs/heads/dev')).toThrow('refs/heads/main');
    expect(() => assertWorkflowRef('dev', 'refs/heads/main')).toThrow('refs/heads/dev');
    expect(() => assertWorkflowRef('prod', '')).not.toThrow();

    const caps = ['admin-v1', 'theatre-register-v1'];
    const candidate = {
      status: {
        url: DEV_API_ORIGIN,
        traffic: [{ tag: 'candidate', url: 'https://candidate---theatre-tracker-api.run.app' }],
      },
    };
    expect(revisionUrl(candidate, false).origin).toBe(
      'https://candidate---theatre-tracker-api.run.app',
    );
    expect(
      revisionUrl({ status: { url: 'https://surgilog-api-1.africa-south1.run.app' } }, true).origin,
    ).toBe('https://surgilog-api-1.africa-south1.run.app');
    expect(() =>
      revisionUrl({ status: { url: 'https://candidate---theatre-tracker-api.run.app' } }, true),
    ).toThrow('no Cloud Run URL');
    expect(() => revisionUrl({ status: { url: DEV_API_ORIGIN } }, false)).toThrow(
      'no Cloud Run URL',
    );
    expect(() =>
      assertHealthy(
        { mode: 'review', projectId: DEV_PROJECT_ID, capabilities: caps },
        { mode: 'review', projectId: DEV_PROJECT_ID },
      ),
    ).not.toThrow();
    expect(() =>
      assertHealthy(
        { mode: 'prod', projectId: prodProject, capabilities: caps },
        { mode: 'prod', projectId: prodProject },
      ),
    ).not.toThrow();
    expect(() =>
      assertHealthy(
        { mode: 'prod', projectId: prodProject, capabilities: caps },
        { mode: 'review', projectId: DEV_PROJECT_ID },
      ),
    ).toThrow('not the dev API');
    expect(() =>
      assertHealthy(
        { mode: 'review', projectId: DEV_PROJECT_ID, capabilities: caps },
        { mode: 'prod', projectId: prodProject },
      ),
    ).toThrow('not the production API');
    expect(() =>
      assertHealthy(
        { mode: 'review', projectId: DEV_PROJECT_ID, capabilities: caps },
        { mode: 'review', projectId: prodProject },
      ),
    ).toThrow('aimed at another project');
    expect(() =>
      assertHealthy(
        { mode: 'prod', projectId: DEV_PROJECT_ID, capabilities: caps },
        { mode: 'prod', projectId: DEV_PROJECT_ID },
      ),
    ).toThrow('aimed at the dev project');
  });

  it('keeps production and dev deploys on separate workflows and identities', () => {
    const prod = readFileSync('.github/workflows/deploy-prod.yml', 'utf8');
    const dev = readFileSync('.github/workflows/deploy-dev.yml', 'utf8');
    for (const workflow of [prod, dev]) {
      expect(workflow).not.toContain('credentials_json');
      expect(workflow).not.toContain('PROD_GCP_SA_KEY');
      expect(workflow).not.toContain('FIREBASE_SERVICE_ACCOUNT');
      expect(workflow).not.toContain('github-hosting-preview');
      expect(workflow).not.toContain('githubHostingPreviewDomains');
      expect(workflow).not.toContain('firebaseauth.configs.update');
      expect(workflow).toContain('google-github-actions/auth@');
      expect(workflow).toContain('workload_identity_provider:');
      expect(workflow).toContain('--no-traffic --tag=candidate');
      expect(workflow).toContain('update-traffic');
      expect(workflow).toContain('id-token: write');
    }
    expect(prod).toContain('branches: [main]');
    expect(prod).toContain('environment: production');
    expect(prod).toContain('--target prod');
    expect(prod).toContain('refs/heads/main');
    expect(prod).toContain('Refusing to point production Hosting at the dev API');
    expect(prod).not.toContain('npm run build:review');
    expect(prod).not.toContain('--target dev');
    expect(dev).toContain('branches: [dev]');
    expect(dev).toContain('environment: development');
    expect(dev).toContain('--target dev');
    expect(dev).toContain('refs/heads/dev');
    expect(dev).toContain(DEV_API_ORIGIN);
    expect(dev).toContain(DEV_PROJECT_ID);
    expect(dev).not.toContain(prodProject);
    expect(dev).not.toContain('config/prod-api.yaml');
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
  for (const key of [
    'GCLOUD_PROJECT',
    'PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
    'CONFIRM_PROD',
    'GITHUB_REF',
    'GITHUB_OUTPUT',
    'FIREBASE_PROJECT_ID',
  ])
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
