import { AsyncLocalStorage } from 'async_hooks';
import type { AIProviderFailureReason } from './interfaces/ai-provider.interface';

/**
 * Remembers WHY the AI provider refused inside one unit of work (an AI job).
 *
 * Why it exists (QUI-1020): every scanner turns `aiEngine.run(...)` with
 * `success:false` into its own `*_AI_FAIL` code, so a spent balance or a 429
 * reached the user as "the AI could not read your document". The job runner
 * opens a recording scope; `AIEngineService` notes each final provider failure
 * in it; when the handler throws, the runner reads the note and reports "AI
 * without credits / unavailable" instead. Outside a scope every call is a
 * no-op, so chat, agents and HTTP callers are untouched.
 */
export interface RecordedProviderFailure {
  reason: AIProviderFailureReason;
  appKey?: string;
  /** Provider message, for the e-mail to Vendix only (never shown to tenants). */
  message?: string;
}

interface RecorderState {
  last: RecordedProviderFailure | null;
}

const storage = new AsyncLocalStorage<RecorderState>();

/** Runs `fn` inside a fresh recording scope. */
export function runRecordingProviderFailures<T>(
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run({ last: null }, fn);
}

/**
 * Called by the AI engine with the outcome of each logical provider call: a
 * classified failure is remembered, a success clears the previous note (a
 * handler that recovered from a 429 must not be blamed on it later).
 */
export function noteProviderOutcome(
  outcome: {
    success: boolean;
    failure_reason?: AIProviderFailureReason;
    error?: string;
  },
  appKey?: string,
): void {
  const state = storage.getStore();
  if (!state) return;
  if (outcome.success) {
    state.last = null;
    return;
  }
  if (!outcome.failure_reason) return;
  state.last = {
    reason: outcome.failure_reason,
    appKey,
    message: outcome.error?.slice(0, 300),
  };
}

/** The last classified provider failure of the current scope, if any. */
export function lastRecordedProviderFailure(): RecordedProviderFailure | null {
  return storage.getStore()?.last ?? null;
}
