import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_PROJECT_ID } from '../shared/deploy-target.ts';

export type DeployedService = {
  status?: {
    url?: string;
    traffic?: { tag?: string; url?: string; percent?: number; revisionName?: string }[];
  };
};

export type HealthBody = {
  mode?: string;
  projectId?: string;
  capabilities?: unknown;
};

/** The URL the workflow fetches. The first revision has no candidate tag yet. */
export function revisionUrl(service: DeployedService, firstRun: boolean) {
  const traffic = service.status?.traffic ?? [];
  const tagged = traffic.find((item) => item.tag === 'candidate');
  const raw = firstRun ? service.status?.url : tagged?.url;
  let parsed: URL | null;
  try {
    parsed = new URL(raw ?? '');
  } catch {
    parsed = null;
  }
  const hostOk = Boolean(
    parsed &&
    (firstRun
      ? !parsed.hostname.startsWith('candidate---')
      : parsed.hostname.startsWith('candidate---')) &&
    parsed.hostname.endsWith('.run.app'),
  );
  if (
    !parsed ||
    !hostOk ||
    parsed.protocol !== 'https:' ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  )
    throw new Error('The deployed revision has no Cloud Run URL to check.');
  return parsed;
}

const REVISION_NAME = /^[a-z][a-z0-9-]{0,62}$/;

/** The revision that currently has all traffic, recorded before a new deploy. */
export function servingRevisionName(service: DeployedService) {
  const traffic = service.status?.traffic ?? [];
  const serving = traffic.find((item) => item.percent === 100);
  if (!serving?.revisionName || !REVISION_NAME.test(serving.revisionName))
    throw new Error(
      'The serving revision must be one revision at 100% traffic. Split traffic stops the deploy before it starts.',
    );
  return serving.revisionName;
}

export function healthBackoffMs(attempt: number) {
  return 1000 * 2 ** (attempt - 1);
}

/** A cold Cloud Run instance can miss the first /health call. Retry before failing the release. */
export async function fetchHealthyResponse(
  url: string,
  options: {
    attempts?: number;
    sleep?: (ms: number) => Promise<void>;
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  const attempts = options.attempts ?? 5;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const fetchImpl = options.fetchImpl ?? fetch;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(12000) });
      if (response.ok) return response;
      lastStatus = response.status;
    } catch {
      lastStatus = 0;
    }
    if (attempt < attempts) await sleep(healthBackoffMs(attempt));
  }
  throw new Error(
    lastStatus ? `Deployed /health returned ${lastStatus}.` : 'Deployed /health did not respond.',
  );
}

/** Prod health must be prod, and dev health must be review on the dev project. */
export function assertHealthy(health: HealthBody, expected: { mode: string; projectId: string }) {
  if (expected.mode !== 'prod' && expected.mode !== 'review')
    throw new Error('Refusing a health check for an unknown mode.');
  if (expected.mode === 'review' && expected.projectId !== DEV_PROJECT_ID)
    throw new Error('Refusing a dev health check aimed at another project.');
  if (expected.mode === 'prod' && expected.projectId === DEV_PROJECT_ID)
    throw new Error('Refusing a production health check aimed at the dev project.');
  const caps = Array.isArray(health.capabilities) ? health.capabilities : [];
  if (
    health.mode !== expected.mode ||
    health.projectId !== expected.projectId ||
    !caps.includes('admin-v1') ||
    !caps.includes('theatre-register-v1')
  )
    throw new Error(
      expected.mode === 'prod'
        ? 'Deployed /health is not the production API.'
        : 'Deployed /health is not the dev API.',
    );
}

async function main() {
  const jsonPath = process.env.SERVICE_JSON;
  if (!jsonPath) throw new Error('SERVICE_JSON is required.');
  const service = JSON.parse(readFileSync(jsonPath, 'utf8')) as DeployedService;
  if (process.argv.includes('--serving-revision')) {
    process.stdout.write(servingRevisionName(service));
    return;
  }
  const firstRun = process.env.EXISTS !== 'true';
  const project = process.env.PROJECT ?? '';
  const mode = process.env.EXPECTED_MODE ?? '';
  const unchanged = firstRun
    ? 'The first revision is already serving.'
    : 'Traffic was not changed.';
  let parsed: URL;
  try {
    parsed = revisionUrl(service, firstRun);
  } catch {
    console.error(`::error::The deployed revision has no Cloud Run URL to check. ${unchanged}`);
    process.exit(1);
  }
  let response: Response;
  try {
    response = await fetchHealthyResponse(`${parsed.origin}/health`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deployed /health did not respond.';
    console.error(`::error::${message} ${unchanged}`);
    process.exit(1);
  }
  try {
    assertHealthy((await response.json()) as HealthBody, { mode, projectId: project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deployed /health did not match.';
    console.error(`::error::${message} ${unchanged}`);
    process.exit(1);
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : '';
if (entry && entry === fileURLToPath(import.meta.url)) await main();
