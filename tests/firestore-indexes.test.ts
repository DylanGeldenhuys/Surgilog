import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  collectionGroupFromName,
  indexIdentity,
  indexesNotReady,
  waitUntilIndexesReady,
  type CompositeIndex,
} from '../scripts/wait-for-firestore-indexes.ts';

const declared: CompositeIndex = {
  collectionGroup: 'cases',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'departmentId', order: 'ASCENDING' },
    { fieldPath: '__name__', order: 'ASCENDING' },
  ],
};

describe('Firestore index readiness', () => {
  it('matches a ready index when gcloud omits the automatic document id', () => {
    const live: CompositeIndex = {
      name: 'projects/p/databases/(default)/collectionGroups/cases/indexes/abc',
      queryScope: 'COLLECTION',
      state: 'READY',
      fields: [{ fieldPath: 'departmentId', order: 'ASCENDING' }],
    };
    expect(collectionGroupFromName(live.name!)).toBe('cases');
    expect(indexIdentity(declared)).toBe(indexIdentity(live));
    expect(indexesNotReady([declared], [live])).toEqual([]);
  });

  it('fails when an index is still creating at the timeout', async () => {
    const live: CompositeIndex = { ...declared, state: 'CREATING' };
    let clock = 0;
    await expect(
      waitUntilIndexesReady({
        declared: [declared],
        list: async () => [live],
        timeoutMs: 20,
        intervalMs: 10,
        sleep: async () => {
          clock += 10;
        },
        now: () => clock,
      }),
    ).rejects.toThrow(/not READY[\s\S]*traffic was not changed/);
  });

  it('returns once every declared index is READY', async () => {
    let calls = 0;
    await waitUntilIndexesReady({
      declared: [declared],
      list: async () => {
        calls += 1;
        return [{ ...declared, state: calls < 2 ? 'CREATING' : 'READY' }];
      },
      timeoutMs: 1000,
      intervalMs: 1,
      sleep: async () => undefined,
      now: () => 0,
    });
    expect(calls).toBe(2);
  });
});

describe('deploy order', () => {
  it('waits for ready indexes before the API can receive traffic', () => {
    for (const file of ['.github/workflows/deploy-dev.yml', '.github/workflows/deploy-prod.yml']) {
      const workflow = readFileSync(file, 'utf8');
      const submit = workflow.indexOf('--only firestore:indexes');
      const wait = workflow.indexOf('scripts/wait-for-firestore-indexes.ts');
      const deploy = workflow.indexOf('gcloud run deploy');
      const shift = workflow.indexOf('gcloud run services update-traffic');
      expect(submit).toBeGreaterThan(-1);
      expect(wait).toBeGreaterThan(submit);
      expect(deploy).toBeGreaterThan(wait);
      expect(shift).toBeGreaterThan(deploy);
      expect(workflow.match(/--only firestore:indexes/g)).toHaveLength(1);
    }
    expect(readFileSync('docs/ci.md', 'utf8')).not.toContain('Rules publish last');
  });
});
