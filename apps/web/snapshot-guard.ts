// Prevent a slow read started before a write (or a newer read) from replacing
// the cache with old data after the write has been acknowledged.
export class SnapshotGuard {
  private generation = 0;
  private writes = 0;
  private reads = new Map<string, symbol>();

  beginRead(key: string) {
    const token = Symbol(key),
      generation = this.generation;
    this.reads.set(key, token);
    return () =>
      this.writes === 0 && generation === this.generation && this.reads.get(key) === token;
  }

  async write<T>(task: () => Promise<T>): Promise<T> {
    this.generation++;
    this.writes++;
    try {
      return await task();
    } finally {
      this.writes--;
      this.generation++;
    }
  }
}
