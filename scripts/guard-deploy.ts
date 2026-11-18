import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { DEV_PROJECT_ID, assertDeployTarget } from '../shared/deploy-target.ts';
import { loadProdTarget } from './prod-target.ts';

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

if (targetFlag !== 'prod' && targetFlag !== 'review')
  throw new Error(
    'Usage: tsx scripts/guard-deploy.ts --target prod --confirm-prod [--github-output]',
  );

const target = loadProdTarget();
if (targetFlag === 'prod') {
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
  const values = {
    project_id: target.projectId,
    region: target.region,
    service: target.service,
    runtime_service_account: target.runtimeServiceAccount,
    build_service_account: target.buildServiceAccount,
  };
  for (const value of Object.values(values))
    if (!/^[A-Za-z0-9@./_-]+$/.test(value))
      throw new Error('Refusing to emit an unsafe deploy target.');
  if (githubOutput) {
    const body = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
    else console.log(body);
  }
  console.log(
    `Production target ${target.projectId} is ready to deploy. Confirmation accepted. Nothing has been deployed by this check.`,
  );
} else {
  const project = projectArg || process.env.GCLOUD_PROJECT || process.env.PROJECT_ID;
  if (!project) throw new Error('Review deploy guard requires the target project.');
  assertDeployTarget({
    buildMode: 'review',
    buildProjectId: DEV_PROJECT_ID,
    targetProjectId: project,
    prodProjectId: target.projectId,
    devProjectId: DEV_PROJECT_ID,
    confirmProd: false,
    placeholder: false,
    deploying: true,
  });
  console.log(`Review target ${project} is not the production project.`);
}
