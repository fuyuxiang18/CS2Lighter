const generations = new Map<string, number>();
const writes = new Map<string, Set<Promise<void>>>();

export function getDemoCacheGeneration(checksum: string) {
  return generations.get(checksum) ?? 0;
}

export function advanceDemoCacheGeneration(checksum: string) {
  generations.set(checksum, getDemoCacheGeneration(checksum) + 1);
}

export async function waitForDemoCacheWrites(checksum: string) {
  const active = writes.get(checksum);
  if (active) await Promise.allSettled(active);
}

/** Register before any await so invalidation can wait for rename/cleanup before removing derived files. */
export async function writeWithDemoCacheGeneration(checksum: string, generation: number, write: () => Promise<void>) {
  const assertCurrent = () => {
    if (getDemoCacheGeneration(checksum) !== generation)
      throw new Error('Match cache was invalidated during generation');
  };
  assertCurrent();
  const active = writes.get(checksum) ?? new Set<Promise<void>>();
  writes.set(checksum, active);
  const pending = Promise.resolve().then(async () => {
    assertCurrent();
    await write();
    assertCurrent();
  });
  active.add(pending);
  try {
    await pending;
  } finally {
    active.delete(pending);
    if (active.size === 0) writes.delete(checksum);
  }
}
