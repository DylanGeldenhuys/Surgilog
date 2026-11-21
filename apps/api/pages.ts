import { FieldPath, type CollectionReference, type Query } from 'firebase-admin/firestore';

/** Firestore page size for department and report scans. */
export const QUERY_PAGE_SIZE = 300;

/**
 * Read every document in an ordered query. Callers must order the query so
 * `startAfter` is stable, and that order must have a composite index.
 */
export async function readQuery<T>(base: Query, pageSize = QUERY_PAGE_SIZE): Promise<T[]> {
  const rows: T[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  for (;;) {
    const snap = await (cursor ? base.startAfter(cursor) : base).limit(pageSize).get();
    if (snap.empty || snap.size === 0) return rows;
    for (const doc of snap.docs) rows.push(doc.data() as T);
    const last = snap.docs[snap.docs.length - 1];
    if (!last || snap.size < pageSize || last.id === cursor?.id) return rows;
    cursor = last;
  }
}

/** Equality on department plus document id. Indexed in firestore.indexes.json. */
export function departmentQuery(collection: CollectionReference, departmentId: string) {
  return collection.where('departmentId', '==', departmentId).orderBy(FieldPath.documentId());
}
