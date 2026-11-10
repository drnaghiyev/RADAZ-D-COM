/** Bounded, ordered prefetch. Consumer pauses retain at most `concurrency` results.
 * Errors are observed in source order and all started work is drained on exit.
 * The byte budget limits concurrent inputs; an oversized input runs alone.
 */
export async function* prefetchOrdered<T, R>(
  items: readonly T[], load: (item: T, index: number) => Promise<R>,
  concurrency = 4, bytes: (item: T) => number = () => 1, byteBudget = Infinity,
): AsyncGenerator<R> {
  type Outcome = { ok: true; value: R } | { ok: false; error: unknown };
  const pending = new Map<number, { promise: Promise<Outcome>; size: number }>();
  let next = 0, retained = 0;
  const fill = () => {
    while (next < items.length && pending.size < Math.max(1, concurrency)) {
      const size = Math.max(1, bytes(items[next]));
      if (pending.size && retained + size > byteBudget) break;
      const index = next++;
      const promise = Promise.resolve().then(() => load(items[index], index))
        .then<Outcome, Outcome>(value => ({ ok: true, value }), error => ({ ok: false, error }));
      pending.set(index, { promise, size }); retained += size;
    }
  };
  try {
    for (let index = 0; index < items.length; index++) {
      fill();
      const entry = pending.get(index)!;
      const outcome = await entry.promise;
      pending.delete(index); retained -= entry.size;
      if (!outcome.ok) throw outcome.error;
      yield outcome.value;
    }
  } finally { await Promise.all([...pending.values()].map(entry => entry.promise)); }
}
