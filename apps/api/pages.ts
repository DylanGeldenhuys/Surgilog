import { FieldPath, type CollectionReference, type Query } from 'firebase-admin/firestore';

/** Firestore page size for department and report scans. */
export const QUERY_PAGE_SIZE = 300;
/** One department collection in a workspace or overview read. */
export const DEPARTMENT_COLLECTION_CAP = 2000;
/** Sessions and bookings returned to the browser for one department. */
export const WORKSPACE_LIST_CAP = 500;
/** Theatre report backstops. A fuller page is refused, not partially totalled. */
export const THEATRE_ENTRY_CAP = 5000;
export const THEATRE_BOOKING_CAP = 5000;
export const THEATRE_SESSION_CAP = 2000;
/** Full-scope Overview must not scan every hospital at once. */
export const OVERVIEW_CONCURRENCY = 4;
export const OVERVIEW_DOCUMENT_BUDGET = 8000;

export const TOO_MUCH_DATA = 'This request has too much data. Narrow the range.';

export type Page<T> = { rows: T[]; truncated: boolean };
export type ReadBudget = { used: number; max: number };

/**
 * Read an ordered query until it ends or `maxDocs` is reached.
 * The result never holds more than `maxDocs` rows. `truncated` means more
 * documents exist, so the caller must not treat the page as a complete total.
 */
export async function readQuery<T>(
  base: Query,
  options?: { pageSize?: number; maxDocs?: number; budget?: ReadBudget },
): Promise<Page<T>> {
  const pageSize = options?.pageSize ?? QUERY_PAGE_SIZE;
  const maxDocs = options?.maxDocs ?? DEPARTMENT_COLLECTION_CAP;
  const rows: T[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const budgetRoom = options?.budget ? options.budget.max - options.budget.used : maxDocs;
    if (rows.length >= maxDocs || budgetRoom <= 0) {
      // A later department, or another collection in the same request, must not
      // look empty when the shared budget was already used up.
      if (!cursor) return { rows, truncated: true };
      if (options?.budget) options.budget.used += 1;
      const probe = await base.startAfter(cursor).limit(1).get();
      if (options?.budget && probe.empty) options.budget.used -= 1;
      return { rows, truncated: !probe.empty };
    }
    const room = Math.min(pageSize, maxDocs - rows.length, budgetRoom);
    if (options?.budget) options.budget.used += room;
    const snap = await (cursor ? base.startAfter(cursor) : base).limit(room).get();
    if (options?.budget) options.budget.used -= room - snap.size;
    if (snap.empty || snap.size === 0) return { rows, truncated: false };
    for (const doc of snap.docs) rows.push(doc.data() as T);
    const last = snap.docs[snap.docs.length - 1];
    if (!last || last.id === cursor?.id || snap.size < room) return { rows, truncated: false };
    cursor = last;
  }
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Keep the newest rows so the browser payload stays bounded. */
export function newestByStart<T extends { start: string }>(rows: T[], max: number) {
  if (rows.length <= max) return rows;
  return [...rows].sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(-max);
}

/** Equality on department plus document id. The automatic single-field index serves this. */
export function departmentQuery(collection: CollectionReference, departmentId: string) {
  return collection.where('departmentId', '==', departmentId).orderBy(FieldPath.documentId());
}
