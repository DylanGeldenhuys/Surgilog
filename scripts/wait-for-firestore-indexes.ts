import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

export type IndexField = { fieldPath: string; order?: string };
export type CompositeIndex = {
  collectionGroup?: string;
  name?: string;
  queryScope?: string;
  fields: IndexField[];
  state?: string;
};

/** Identity ignores the automatic document-id field gcloud may add or omit. */
export function indexIdentity(index: CompositeIndex) {
  const group = index.collectionGroup ?? collectionGroupFromName(index.name ?? '') ?? 'unknown';
  const fields = index.fields
    .filter((field) => field.fieldPath !== '__name__')
    .map((field) => `${field.fieldPath}:${field.order ?? 'ASCENDING'}`)
    .join(',');
  return `${group}|${index.queryScope ?? 'COLLECTION'}|${fields}`;
}

export function collectionGroupFromName(name: string) {
  return name.match(/collectionGroups\/([^/]+)\/indexes\//)?.[1];
}

export function indexesNotReady(declared: CompositeIndex[], live: CompositeIndex[]) {
  const ready = new Set(
    live.filter((index) => index.state === 'READY').map((index) => indexIdentity(index)),
  );
  return declared.filter((index) => !ready.has(indexIdentity(index)));
}

export async function waitUntilIndexesReady(options: {
  declared: CompositeIndex[];
  list: () => Promise<CompositeIndex[]>;
  timeoutMs: number;
  intervalMs: number;
  sleep: (ms: number) => Promise<void>;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  const started = now();
  let pending = options.declared;
  while (pending.length) {
    pending = indexesNotReady(options.declared, await options.list());
    if (!pending.length) return;
    if (now() - started >= options.timeoutMs) {
      throw new Error(
        `Firestore indexes are not READY: ${pending.map(indexIdentity).join('; ')}. The API was not deployed and traffic was not changed.`,
      );
    }
    await options.sleep(options.intervalMs);
  }
}

function readDeclared(path: string) {
  const file = JSON.parse(readFileSync(path, 'utf8')) as { indexes?: CompositeIndex[] };
  if (!Array.isArray(file.indexes) || !file.indexes.length)
    throw new Error('firebase/firestore.indexes.json has no composite indexes.');
  return file.indexes;
}

function listLive(project: string) {
  return new Promise<CompositeIndex[]>((resolve, reject) => {
    const child = spawn(
      'gcloud',
      [
        'firestore',
        'indexes',
        'composite',
        'list',
        '--project',
        project,
        '--database=(default)',
        '--format=json',
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.stderr.on('data', (chunk) => {
      err += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(err.trim() || `gcloud exited ${code}.`));
        return;
      }
      const parsed = out.trim() ? (JSON.parse(out) as CompositeIndex[]) : [];
      resolve(parsed);
    });
  });
}

async function main() {
  const project = process.env.PROJECT ?? '';
  if (!/^[\w-]{4,40}$/.test(project))
    throw new Error('Refusing to check indexes without a project id.');
  await waitUntilIndexesReady({
    declared: readDeclared('firebase/firestore.indexes.json'),
    list: () => listLive(project),
    timeoutMs: 15 * 60 * 1000,
    intervalMs: 15 * 1000,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
}

if (process.argv[1]?.endsWith('wait-for-firestore-indexes.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Index check failed.');
    process.exit(1);
  });
}
