
export async function mapConcurrent<T, R>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new RangeError('Concurrency must be a positive integer.');
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  async function worker(): Promise<void> {
    if (failed) return;
    signal?.throwIfAborted();
    const index = next++;
    if (index >= items.length) return;
    try { results[index] = await task(items[index], index); }
    catch (error) { failed = true; throw error; }
    return worker();
  }
  const settled = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  const failure = settled.find(result => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  signal?.throwIfAborted();
  return results;
}
