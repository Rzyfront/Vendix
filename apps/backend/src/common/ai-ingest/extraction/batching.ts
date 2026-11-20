/** Splits `items` into consecutive batches of at most `size`. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += step) {
    out.push(items.slice(i, i + step));
  }
  return out;
}

/**
 * Runs `worker` over `inputs` with at most `concurrency` in flight and keeps
 * the input order in the result. The first rejection rejects the whole run
 * (workers already started finish on their own; no new one starts).
 */
export async function mapWithConcurrency<I, O>(
  inputs: readonly I[],
  concurrency: number,
  worker: (input: I, index: number) => Promise<O>,
): Promise<O[]> {
  const results = new Array<O>(inputs.length);
  let next = 0;
  let failed = false;
  const lanes = Math.max(1, Math.min(Math.floor(concurrency), inputs.length));
  const run = async (): Promise<void> => {
    while (!failed && next < inputs.length) {
      const index = next++;
      try {
        results[index] = await worker(inputs[index], index);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: lanes }, run));
  return results;
}
