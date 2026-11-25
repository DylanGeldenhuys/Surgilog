import { FieldPath } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  departmentQuery,
  mapWithConcurrency,
  newestByStart,
  readQuery,
} from '../apps/api/pages.ts';

type Row = { id: string; name: string };

function snapshot(row: Row) {
  return { id: row.id, data: () => row };
}

function queryFor(rows: Row[]) {
  const docs = rows.map(snapshot);
  const limited = (start: number) => ({
    limit(size: number) {
      const slice = docs.slice(start, start + size);
      return {
        get: async () => ({
          empty: slice.length === 0,
          size: slice.length,
          docs: slice,
        }),
      };
    },
  });
  return {
    startAfter(cursor: { id: string }) {
      const start = docs.findIndex((doc) => doc.id === cursor.id) + 1;
      return limited(start);
    },
    ...limited(0),
  };
}

describe('paged department reads', () => {
  it('returns every page, including a full final page', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => ({
      id: `case-${index}`,
      name: `Case ${index}`,
    }));
    await expect(readQuery<Row>(queryFor(rows) as never, { pageSize: 2 })).resolves.toEqual({
      rows,
      truncated: false,
    });
    await expect(readQuery<Row>(queryFor([]) as never, { pageSize: 2 })).resolves.toEqual({
      rows: [],
      truncated: false,
    });
  });

  it('stops at the document cap and reports that more rows exist', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `case-${index}`,
      name: `Ada Nkosi ${index}`,
    }));
    const page = await readQuery<Row>(queryFor(rows) as never, { pageSize: 2, maxDocs: 4 });
    expect(page.truncated).toBe(true);
    expect(page.rows).toHaveLength(4);
    expect(page.rows.map((row) => row.id)).toEqual(['case-0', 'case-1', 'case-2', 'case-3']);
  });

  it('stops when the shared overview budget is spent', async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ({ id: `row-${index}`, name: 'x' }));
    const budget = { used: 0, max: 3 };
    const page = await readQuery<Row>(queryFor(rows) as never, {
      pageSize: 2,
      maxDocs: 10,
      budget,
    });
    expect(page.truncated).toBe(true);
    expect(page.rows.length).toBeLessThanOrEqual(3);
    expect(budget.used).toBeLessThanOrEqual(4);
  });

  it('treats a follow-on query with a spent budget as truncated', async () => {
    let reads = 0;
    const base = queryFor([{ id: 'row-0', name: 'x' }]);
    const query = {
      ...base,
      limit(size: number) {
        reads += 1;
        return base.limit(size);
      },
    };
    const budget = { used: 8000, max: 8000 };
    const page = await readQuery<Row>(query as never, { pageSize: 2, maxDocs: 10, budget });
    expect(page).toEqual({ rows: [], truncated: true });
    expect(reads).toBe(0);
    expect(budget.used).toBe(8000);
  });

  it('does not stop at the old 1,000 or 5,000 pilot caps', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `row-${String(index).padStart(4, '0')}`,
      name: 'synthetic',
    }));
    const read = await readQuery<Row>(queryFor(rows) as never, { pageSize: 300, maxDocs: 2000 });
    expect(read.truncated).toBe(false);
    expect(read.rows).toHaveLength(1001);
    expect(read.rows[0]?.id).toBe('row-0000');
    expect(read.rows[1000]?.id).toBe('row-1000');
  });

  it('keeps the browser list to the newest rows and limits overview fan-out', async () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      start: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    }));
    expect(newestByStart(rows, 2).map((row) => row.start)).toEqual([rows[4].start, rows[5].start]);
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const pending = mapWithConcurrency([1, 2, 3, 4], 2, () => {
      active += 1;
      peak = Math.max(peak, active);
      return new Promise<void>((resolve) => {
        release.push(() => {
          active -= 1;
          resolve();
        });
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(peak).toBe(2);
    expect(active).toBe(2);
    release.splice(0).forEach((finish) => finish());
    await new Promise((resolve) => setTimeout(resolve, 0));
    release.splice(0).forEach((finish) => finish());
    await pending;
  });

  it('orders a department collection by document id', () => {
    const ordered: unknown[] = [];
    const collection = {
      where(field: string, op: string, value: string) {
        expect(field).toBe('departmentId');
        expect(op).toBe('==');
        expect(value).toBe('general');
        return {
          orderBy(fieldPath: unknown) {
            ordered.push(fieldPath);
            return { kind: 'query' };
          },
        };
      },
    };
    departmentQuery(collection as never, 'general');
    expect(ordered).toEqual([FieldPath.documentId()]);
  });

  it('declares composite indexes for the department document-id queries', () => {
    const indexes = JSON.parse(readFileSync('firebase/firestore.indexes.json', 'utf8')) as {
      indexes: { collectionGroup: string; fields: { fieldPath: string; order: string }[] }[];
    };
    for (const collection of ['cases', 'sessions', 'bookings']) {
      expect(indexes.indexes).toContainEqual({
        collectionGroup: collection,
        queryScope: 'COLLECTION',
        fields: [
          { fieldPath: 'departmentId', order: 'ASCENDING' },
          { fieldPath: '__name__', order: 'ASCENDING' },
        ],
      });
    }
    const theatre = indexes.indexes.filter((index) =>
      ['theatreEntries', 'bookings', 'sessions'].includes(index.collectionGroup),
    );
    expect(
      theatre.some(
        (index) =>
          index.collectionGroup === 'theatreEntries' &&
          index.fields.some((field) => field.fieldPath === 'operationDate'),
      ),
    ).toBe(true);
    expect(
      theatre.some(
        (index) =>
          index.collectionGroup === 'bookings' &&
          index.fields.some((field) => field.fieldPath === 'inAt'),
      ),
    ).toBe(true);
    expect(
      theatre.some(
        (index) =>
          index.collectionGroup === 'sessions' &&
          index.fields.some((field) => field.fieldPath === 'start'),
      ),
    ).toBe(true);
  });
});
