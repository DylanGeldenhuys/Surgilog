import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEV_API_ORIGIN, DEV_PROJECT_ID, assertDeployTarget } from '../shared/deploy-target.ts';
import { loadProdTarget, parseFlatYaml, type ProdTarget } from './prod-target.ts';

const SAFE_OUTPUT = /^[A-Za-z0-9@./_:-]+$/;

export function hintedProjects(
  projectArg: string | undefined,
  env: Record<string, string | undefined>,
) {
  return [projectArg, env.GCLOUD_PROJECT, env.PROJECT_ID].filter((value): value is string =>
    Boolean(value),
  );
}

/** A dev run must not name production, and a production run must not name dev. */
export function assertTargetHints(
  kind: 'prod' | 'dev',
  hints: readonly string[],
  expected: string,
  other: string,
) {
  for (const hint of hints) {
    if (hint === other)
      throw new Error(
        kind === 'dev'
          ? 'Refusing a dev deploy aimed at the production project.'
          : 'Refusing a production deploy aimed at the dev/review project.',
      );
    if (hint !== expected)
      throw new Error(
        kind === 'dev'
          ? 'Refusing a dev deploy aimed at a different project.'
          : 'Refusing a production deploy aimed at a different project.',
      );
  }
}

export function assertWorkflowRef(kind: 'prod' | 'dev', ref = process.env.GITHUB_REF) {
  if (!ref) {
    if (process.env.GITHUB_ACTIONS === 'true')
      throw new Error('Refusing a deploy in GitHub Actions with no ref. Nothing was deployed.');
    return;
  }
  const expected = kind === 'prod' ? 'refs/heads/main' : 'refs/heads/dev';
  if (ref !== expected)
    throw new Error(
      kind === 'prod'
        ? `Refusing a production deploy from ${ref}. Production runs only from refs/heads/main. Nothing was deployed.`
        : `Refusing a dev deploy from ${ref}. Dev runs only from refs/heads/dev. Nothing was deployed.`,
    );
}

export function prodDeployValues(target: ProdTarget) {
  return {
    project_id: target.projectId,
    region: target.region,
    service: target.service,
    runtime_service_account: target.runtimeServiceAccount,
    build_service_account: target.buildServiceAccount,
    env_file: 'config/prod-api.yaml',
    health_mode: 'prod',
  };
}

export function devDeployValues() {
  return {
    project_id: DEV_PROJECT_ID,
    region: 'africa-south1',
    service: 'theatre-tracker-api',
    runtime_service_account: `theatre-tracker-api@${DEV_PROJECT_ID}.iam.gserviceaccount.com`,
    build_service_account: `projects/${DEV_PROJECT_ID}/serviceAccounts/theatre-tracker-build@${DEV_PROJECT_ID}.iam.gserviceaccount.com`,
    env_file: 'config/review-api.yaml',
    health_mode: 'review',
    api_origin: DEV_API_ORIGIN,
  };
}

function emit(values: Record<string, string>) {
  for (const value of Object.values(values))
    if (!SAFE_OUTPUT.test(value)) throw new Error('Refusing to emit an unsafe deploy target.');
  const body = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
  else console.log(body);
}

function assertDevEnv(prodProjectId: string) {
  const env = parseFlatYaml(readFileSync('config/review-api.yaml', 'utf8'));
  const origins = env.ALLOWED_ORIGINS ?? '';
  if (env.APP_ENV !== 'review' || env.FIREBASE_PROJECT_ID !== DEV_PROJECT_ID)
    throw new Error('Dev API env is not the dev/review project.');
  if (
    env.FIREBASE_PROJECT_ID === prodProjectId ||
    origins.includes(prodProjectId) ||
    !origins.includes(`https://${DEV_PROJECT_ID}.web.app`)
  )
    throw new Error(
      'Refusing a dev API config that names the production project or drops the live dev site.',
    );
}

function main() {
  const { values } = parseArgs({
    options: {
      target: { type: 'string' },
      project: { type: 'string' },
      'confirm-prod': { type: 'boolean' },
      'github-output': { type: 'boolean' },
    },
  });
  const targetFlag = values.target;
  const confirmProd = values['confirm-prod'] === true || process.env.CONFIRM_PROD === 'yes';
  const githubOutput = values['github-output'] === true;
  const projectArg = values.project;

  if (targetFlag !== 'prod' && targetFlag !== 'review' && targetFlag !== 'dev')
    throw new Error(
      'Usage: tsx scripts/guard-deploy.ts --target prod --confirm-prod [--github-output] | --target dev [--github-output] | --target review --project PROJECT',
    );

  if (targetFlag === 'prod') {
    assertWorkflowRef('prod');
    const target = loadProdTarget();
    assertTargetHints(
      'prod',
      hintedProjects(projectArg, process.env),
      target.projectId,
      DEV_PROJECT_ID,
    );
    assertDeployTarget({
      buildMode: 'prod',
      buildProjectId: target.projectId,
      targetProjectId: target.projectId,
      prodProjectId: target.projectId,
      devProjectId: DEV_PROJECT_ID,
      confirmProd,
      placeholder: target.placeholder,
      deploying: true,
    });
    const output = prodDeployValues(target);
    if (output.project_id === DEV_PROJECT_ID)
      throw new Error('Refusing a production deploy aimed at the dev/review project.');
    if (githubOutput) emit(output);
    console.log(
      `Production target ${target.projectId} is ready to deploy. Confirmation accepted. Nothing has been deployed by this check.`,
    );
    return;
  }

  assertWorkflowRef('dev');
  const prod = loadProdTarget();
  const hints = hintedProjects(projectArg, process.env);
  if (targetFlag === 'review' && hints.length === 0)
    throw new Error('Review deploy guard requires the target project.');
  assertTargetHints('dev', hints, DEV_PROJECT_ID, prod.projectId);
  assertDevEnv(prod.projectId);
  assertDeployTarget({
    buildMode: 'review',
    buildProjectId: DEV_PROJECT_ID,
    targetProjectId: DEV_PROJECT_ID,
    prodProjectId: prod.projectId,
    devProjectId: DEV_PROJECT_ID,
    confirmProd: false,
    placeholder: false,
    deploying: true,
  });
  const output = devDeployValues();
  if (output.project_id === prod.projectId || output.health_mode === 'prod')
    throw new Error('Refusing a dev deploy aimed at the production project.');
  if (targetFlag === 'dev') {
    if (githubOutput) emit(output);
    console.log(
      `Dev target ${output.project_id} is ready to deploy. It is not the production project. Nothing has been deployed by this check.`,
    );
    return;
  }
  console.log(`Review target ${DEV_PROJECT_ID} is not the production project.`);
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) main();
