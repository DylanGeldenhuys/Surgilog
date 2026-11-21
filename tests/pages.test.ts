import { FieldPath } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { departmentQuery, readQuery } from '../apps/api/pages.ts';

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
    await expect(readQuery<Row>(queryFor(rows) as never, 2)).resolves.toEqual(rows);
    await expect(readQuery<Row>(queryFor([]) as never, 2)).resolves.toEqual([]);
  });

  it('does not stop at the old 1,000 or 5,000 pilot caps', async () => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: `row-${String(index).padStart(4, '0')}`,
      name: 'synthetic',
    }));
    const read = await readQuery<Row>(queryFor(rows) as never, 300);
    expect(read).toHaveLength(1001);
    expect(read[0]?.id).toBe('row-0000');
    expect(read[1000]?.id).toBe('row-1000');
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
