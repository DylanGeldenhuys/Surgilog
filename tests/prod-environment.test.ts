import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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
import {
  assertHealthy,
  cloudRunServiceOrigins,
  fetchHealthyResponse,
  healthBackoffMs,
  requirePinnedServiceOrigin,
  revisionUrl,
  servingRevisionName,
} from '../scripts/smoke-check-revision.ts';

const prodProject = 'surgilog-production';
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
  it('keeps the production web config and the placeholder API URL, with copies locked', () => {
    const target = loadProdTarget();
    const review = JSON.parse(readFileSync('config/review.json', 'utf8'));
    expect(target.placeholder).toBe(false);
    expect(target.projectId).toBe(prodProject);
    expect(target.projectId).not.toBe(DEV_PROJECT_ID);
    expect(target.region).toBe('africa-south1');
    expect(target.service).toBe('surgilog-api');
    expect(target.fictionalSeeding).toBe(false);
    expect(target.env.FICTIONAL_SEEDING).toBe('false');
    expect(target.env.APP_ENV).toBe('prod');
    expect(target.apiUrlPlaceholder).toBe('https://surgilog-api-placeholder.africa-south1.run.app');
    expect(target.firebase).toMatchObject({
      apiKey: 'AIzaSyCwy0VyUbQ_dJ-hXC0mSaCoY1VaQ8Po_rw',
      authDomain: 'surgilog-production.firebaseapp.com',
      projectId: prodProject,
      storageBucket: 'surgilog-production.firebasestorage.app',
      messagingSenderId: '396531693188',
      appId: '1:396531693188:web:833d913acd71e93aeaf4d1',
    });
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

  it('accepts a confirmed production target once the web config is real', () => {
    const result = runGuard(['--target', 'prod', '--confirm-prod']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Production target ${prodProject}`);
    expect(result.stdout).toContain('Nothing has been deployed');
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
    const actionsWithoutRef = runGuard(['--target', 'prod', '--confirm-prod'], {
      GITHUB_ACTIONS: 'true',
      GITHUB_REF: '',
    });
    expect(actionsWithoutRef.status).not.toBe(0);
    expect(`${actionsWithoutRef.stdout}\n${actionsWithoutRef.stderr}`).toContain('no ref');
    const localWithoutRef = runGuard(['--target', 'dev'], { GITHUB_ACTIONS: '', GITHUB_REF: '' });
    expect(localWithoutRef.status).toBe(0);
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
    vi.stubEnv('GITHUB_ACTIONS', '');
    vi.stubEnv('GITHUB_REF', 'refs/pull/7/merge');
    try {
      expect(() => assertWorkflowRef('prod', '')).not.toThrow();
      expect(() => assertWorkflowRef('prod')).toThrow('refs/pull/7/merge');
    } finally {
      vi.unstubAllEnvs();
    }
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    vi.stubEnv('GITHUB_REF', '');
    try {
      expect(() => assertWorkflowRef('prod')).toThrow('no ref');
      expect(() => assertWorkflowRef('dev')).toThrow('no ref');
    } finally {
      vi.unstubAllEnvs();
    }

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
    expect(healthBackoffMs(1)).toBe(1000);
    expect(healthBackoffMs(3)).toBe(4000);
    expect(
      servingRevisionName({
        status: {
          traffic: [
            { tag: 'candidate', percent: 0, revisionName: 'surgilog-api-00002-new' },
            { percent: 100, revisionName: 'surgilog-api-00001-old' },
          ],
        },
      }),
    ).toBe('surgilog-api-00001-old');
    expect(() => servingRevisionName({ status: { traffic: [] } })).toThrow(
      'Split traffic stops the deploy',
    );
    expect(() =>
      servingRevisionName({
        status: {
          traffic: [
            { percent: 50, revisionName: 'surgilog-api-00001-old' },
            { percent: 50, revisionName: 'surgilog-api-00002-new' },
          ],
        },
      }),
    ).toThrow('Split traffic stops the deploy');
  });

  it('retries a cold health check before failing the release', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const response = await fetchHealthyResponse('https://example.run.app/health', {
      attempts: 3,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchImpl: async () => {
        calls += 1;
        if (calls < 3) return new Response('starting', { status: 503 });
        return new Response('{}', { status: 200 });
      },
    });
    expect(response.ok).toBe(true);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
    await expect(
      fetchHealthyResponse('https://example.run.app/health', {
        attempts: 2,
        sleep: async () => undefined,
        fetchImpl: async () => new Response('no', { status: 503 }),
      }),
    ).rejects.toThrow('returned 503');
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
      expect(workflow).toContain('needs: check');
      expect(workflow).toContain('## API rollback');
      expect(workflow).toContain('npx firebase-tools deploy');
      expect(workflow).toContain('--only firestore:rules');
      expect(workflow).toContain('firebase/firestore.rules');
      expect(workflow).toContain('PROJECT: ${{ steps.target.outputs.project_id }}');
      expect(workflow).not.toContain('firestore:indexes');
      expect(workflow).not.toContain('firebase-tools@');
      const checkJob = workflow.slice(0, workflow.indexOf('\n  deploy:\n'));
      expect(checkJob).not.toContain('id-token:');
      expect(checkJob).toContain('npm ci');
      expect(checkJob).not.toContain('--ignore-scripts');
      expect(workflow).toContain('npm ci --ignore-scripts');
    }
    expect(prod).toContain('branches: [main]');
    expect(prod).toContain('environment: production');
    expect(prod).toContain('"$PROJECT" != "surgilog-production"');
    expect(prod).toContain('--target prod');
    expect(prod).toContain('refs/heads/main');
    expect(prod).toContain('Refusing to point production Hosting at the dev API');
    expect(prod).not.toContain('npm run build:review');
    expect(prod).not.toContain('--target dev');
    expect(dev).toContain('branches: [dev]');
    expect(dev).toContain('environment: development');
    expect(dev).toContain('"$PROJECT" != "theatre-tracker-2f2e5"');
    expect(dev).toContain('--target dev');
    expect(dev).toContain('refs/heads/dev');
    expect(dev).toContain(DEV_API_ORIGIN);
    expect(dev).toContain(DEV_PROJECT_ID);
    expect(dev.match(/--require-origin/g)).toHaveLength(2);
    expect(dev).toContain('REFUSAL_TAIL="Nothing was deployed."');
    expect(dev).toContain('REFUSAL_TAIL="Hosting was not deployed."');
    expect(dev).not.toContain('value(status.url)');
    expect(prod).toContain("--format='value(status.url)'");
    expect(prod).not.toContain('--require-origin');
    expect(dev).not.toContain(prodProject);
    expect(dev).not.toContain('config/prod-api.yaml');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(pkg.devDependencies['firebase-tools']).toBe('15.32.1');
    expect(readFileSync('package-lock.json', 'utf8')).toContain('"node_modules/firebase-tools"');
    const guide = readFileSync('docs/ci.md', 'utf8');
    expect(guide).toContain('environment:${ENV_NAME}');
    expect(guide).not.toContain('ref:refs/heads/${BRANCH}');
    expect(guide).toContain('1403413866');
    expect(guide).toContain('46447404');
    expect(guide).toContain('run-sources-${PROJECT_ID}-africa-south1');
    expect(guide).toContain('The github provider does not match this script.');
    expect(guide).toContain('attributeMapping');
    expect(guide).toContain('Split traffic stops');
    expect(guide).not.toContain('*_cloudbuild');
    expect(guide).toContain('Remove the temporary Cloud Run admin grant');
    expect(guide).toContain('roles/firebaserules.admin');
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

const LEGACY_DEV_API = 'https://theatre-tracker-api-m2cpjwqipa-bq.a.run.app';

describe('pinned Cloud Run address', () => {
  const listed = {
    status: {
      url: LEGACY_DEV_API,
      urls: [LEGACY_DEV_API, DEV_API_ORIGIN],
    },
    metadata: {
      annotations: {
        'run.googleapis.com/urls': `${LEGACY_DEV_API},${DEV_API_ORIGIN}`,
      },
    },
  };

  it('accepts the stable origin when status.url is only the legacy hash', () => {
    expect(requirePinnedServiceOrigin(listed, DEV_API_ORIGIN)).toBe(DEV_API_ORIGIN);
    expect(requirePinnedServiceOrigin({ status: { urls: [DEV_API_ORIGIN] } }, DEV_API_ORIGIN)).toBe(
      DEV_API_ORIGIN,
    );
    expect(
      requirePinnedServiceOrigin(
        {
          metadata: {
            annotations: { 'run.googleapis.com/urls': ` ${LEGACY_DEV_API}, ${DEV_API_ORIGIN} ` },
          },
        },
        DEV_API_ORIGIN,
      ),
    ).toBe(DEV_API_ORIGIN);
    expect(requirePinnedServiceOrigin({ status: { url: DEV_API_ORIGIN } }, DEV_API_ORIGIN)).toBe(
      DEV_API_ORIGIN,
    );
    expect(
      requirePinnedServiceOrigin({ status: { urls: [`${DEV_API_ORIGIN}/`] } }, DEV_API_ORIGIN),
    ).toBe(DEV_API_ORIGIN);
  });

  it('reads the stable origin from the dev service describe output', () => {
    const urlsAnnotation =
      '["https://theatre-tracker-api-54783611706.africa-south1.run.app","https://theatre-tracker-api-m2cpjwqipa-bq.a.run.app"]';
    const service = {
      apiVersion: 'serving.knative.dev/v1',
      kind: 'Service',
      metadata: {
        name: 'theatre-tracker-api',
        namespace: '54783611706',
        annotations: {
          'run.googleapis.com/urls': urlsAnnotation,
        },
      },
      status: {
        url: 'https://theatre-tracker-api-m2cpjwqipa-bq.a.run.app',
      },
    };
    expect(urlsAnnotation).toBe(JSON.stringify([DEV_API_ORIGIN, LEGACY_DEV_API]));
    expect(service.status.url).toBe(LEGACY_DEV_API);
    expect(service.status).not.toHaveProperty('urls');
    expect(cloudRunServiceOrigins(service)).toEqual([DEV_API_ORIGIN, LEGACY_DEV_API]);
    expect(requirePinnedServiceOrigin(service, DEV_API_ORIGIN)).toBe(DEV_API_ORIGIN);
    expect(
      requirePinnedServiceOrigin(
        {
          metadata: {
            annotations: {
              'run.googleapis.com/urls': JSON.stringify([`${DEV_API_ORIGIN}/`, LEGACY_DEV_API]),
            },
          },
        },
        ` ${DEV_API_ORIGIN}/ `,
      ),
    ).toBe(DEV_API_ORIGIN);

    const hashOnly = {
      ...service,
      metadata: {
        annotations: {
          'run.googleapis.com/urls': JSON.stringify([LEGACY_DEV_API]),
        },
      },
    };
    expect(() => requirePinnedServiceOrigin(hashOnly, DEV_API_ORIGIN)).toThrow(
      `The dev API is ${LEGACY_DEV_API}. It must stay ${DEV_API_ORIGIN}.`,
    );
    try {
      requirePinnedServiceOrigin(hashOnly, DEV_API_ORIGIN);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toContain('[');
      expect(message).not.toContain('"');
    }

    expect(() =>
      requirePinnedServiceOrigin(
        {
          status: { url: LEGACY_DEV_API },
          metadata: { annotations: { 'run.googleapis.com/urls': '[not-json' } },
        },
        DEV_API_ORIGIN,
      ),
    ).toThrow(`The dev API is [not-json, ${LEGACY_DEV_API}. It must stay ${DEV_API_ORIGIN}.`);

    const accepted = runRequireOrigin(service, DEV_API_ORIGIN);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout.trim()).toBe(DEV_API_ORIGIN);
    expect(accepted.stderr).not.toContain('::error::');
  });

  it('still fails when the stable origin is absent', () => {
    expect(() =>
      requirePinnedServiceOrigin(
        { status: { url: LEGACY_DEV_API, urls: [LEGACY_DEV_API] } },
        DEV_API_ORIGIN,
      ),
    ).toThrow(`The dev API is ${LEGACY_DEV_API}. It must stay ${DEV_API_ORIGIN}.`);
    expect(() =>
      requirePinnedServiceOrigin(
        {
          status: { url: LEGACY_DEV_API },
          metadata: { annotations: { 'run.googleapis.com/urls': LEGACY_DEV_API } },
        },
        DEV_API_ORIGIN,
      ),
    ).toThrow(LEGACY_DEV_API);
    expect(() => requirePinnedServiceOrigin({}, DEV_API_ORIGIN)).toThrow(
      `The dev API is missing. It must stay ${DEV_API_ORIGIN}.`,
    );
    expect(() => requirePinnedServiceOrigin(listed, '  ')).toThrow(
      'The pinned API address is missing.',
    );
    expect(() =>
      requirePinnedServiceOrigin(
        {
          status: {
            urls: [`${DEV_API_ORIGIN}.evil.example`, `https://not-${DEV_API_ORIGIN.slice(8)}`],
          },
        },
        DEV_API_ORIGIN,
      ),
    ).toThrow('must stay');
    expect(cloudRunServiceOrigins(listed)).toEqual([LEGACY_DEV_API, DEV_API_ORIGIN]);
  });

  it('prints the pinned origin and refuses a hash-only service', () => {
    const accepted = runRequireOrigin(listed, DEV_API_ORIGIN);
    expect(accepted.status).toBe(0);
    expect(accepted.stdout.trim()).toBe(DEV_API_ORIGIN);
    expect(accepted.stderr).not.toContain('::error::');

    const refused = runRequireOrigin({ status: { url: LEGACY_DEV_API } }, DEV_API_ORIGIN);
    expect(refused.status).not.toBe(0);
    expect(refused.stdout.trim()).not.toBe(DEV_API_ORIGIN);
    expect(refused.stderr).toContain(
      `::error::The dev API is ${LEGACY_DEV_API}. It must stay ${DEV_API_ORIGIN}. Nothing was deployed.`,
    );
  });
});

function runRequireOrigin(service: unknown, expected: string) {
  const dir = mkdtempSync(join(tmpdir(), 'api-urls-'));
  const file = join(dir, 'service.json');
  writeFileSync(file, JSON.stringify(service));
  return spawnSync('npx', ['tsx', 'scripts/smoke-check-revision.ts', '--require-origin'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SERVICE_JSON: file,
      EXPECTED_ORIGIN: expected,
      REFUSAL_TAIL: 'Nothing was deployed.',
    },
  });
}

function runGuard(args: string[], env: Record<string, string | undefined> = {}) {
  const childEnv = { ...process.env };
  for (const key of [
    'GCLOUD_PROJECT',
    'PROJECT_ID',
    'GOOGLE_CLOUD_PROJECT',
    'CONFIRM_PROD',
    'GITHUB_REF',
    'GITHUB_OUTPUT',
    'GITHUB_ACTIONS',
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
