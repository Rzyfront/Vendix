import { AsyncLocalStorage } from 'node:async_hooks';
import type { AIResponse } from '../interfaces/ai-provider.interface';

/** Request-local observer only. No headers, bearer, prompts or reasoning persist here. */
export interface ObjectiveProviderMeter {
  attempts: number;
  observed: boolean;
  dispatch(): Promise<void>;
  retry(): Promise<void>;
  usage(usage: AIResponse['usage'], cost: number | null): Promise<void>;
}
export const objectiveProviderMeter =
  new AsyncLocalStorage<ObjectiveProviderMeter>();

/** Observe SDK retries without changing their configuration or adding retries. */
export function objectiveMeteredFetch(fetcher: typeof fetch): typeof fetch {
  return async (input, init) => {
    const meter = objectiveProviderMeter.getStore();
    if (meter && meter.attempts++ > 0) await meter.retry();
    return fetcher(input, init);
  };
}
