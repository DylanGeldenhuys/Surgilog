import { expect, it } from 'vitest';
import { SnapshotGuard } from '../apps/web/snapshot-guard.ts';

it('ignores superseded reads but keeps independent department reads', () => {
  const guard = new SnapshotGuard();
  const first = guard.beginRead('hospital/general'),
    other = guard.beginRead('hospital/orthopaedics');
  const latest = guard.beginRead('hospital/general');
  expect(first()).toBe(false);
  expect(latest()).toBe(true);
  expect(other()).toBe(true);
});

it('rejects reads straddling a mutation, including reads during a pending write', async () => {
  const guard = new SnapshotGuard(),
    earlier = guard.beginRead('workspace');
  let finish!: () => void;
  const write = guard.write(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  expect(earlier()).toBe(false);
  const during = guard.beginRead('workspace');
  expect(during()).toBe(false);
  finish();
  await write;
  expect(during()).toBe(false);
  expect(guard.beginRead('workspace')()).toBe(true);
});

it('recovers after a failed mutation and waits for overlapping writes', async () => {
  const guard = new SnapshotGuard();
  let finish!: () => void;
  const write = guard.write(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await expect(
    guard.write(async () => {
      throw new Error('uncertain');
    }),
  ).rejects.toThrow('uncertain');
  expect(guard.beginRead('workspace')()).toBe(false);
  finish();
  await write;
  expect(guard.beginRead('workspace')()).toBe(true);
});
