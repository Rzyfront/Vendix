/**
 * Reading of how long a DIAN habilitación batch has been waiting for a verdict.
 *
 * `SendTestSetAsync` only acknowledges receipt; the verdict comes from polling
 * `GetStatusZip`. When DIAN keeps answering "Batch en proceso de validación" the
 * batch is indistinguishable from one it silently dropped — and a UI that only
 * knows `pending: true` renders that as an unbounded wait with no way out.
 *
 * This module turns the stored `last_test_result` into a bounded state with an
 * explicit set of next actions, so "still processing" eventually becomes
 * "stalled — here is what to do" instead of a spinner forever.
 *
 * Pure on purpose: the HTTP services and the re-poll cron job must agree on the
 * verdict, and a shared pure function is the only way to guarantee that.
 */

/**
 * DIAN judges a habilitación batch in minutes, not days. Past this window,
 * waiting is no longer a strategy: the batch needs per-document diagnosis or a
 * re-send. Deliberately generous so a slow DIAN afternoon does not raise a
 * false alarm.
 */
export const TEST_SET_STALL_AFTER_MS = 6 * 60 * 60 * 1000;

export type TestSetWaitState =
  | 'idle'
  | 'processing'
  | 'stalled'
  | 'passed'
  | 'rejected'
  | 'abandoned';

export type TestSetNextAction =
  | 'run_test_set'
  | 'recheck'
  | 'diagnose_documents'
  | 'abandon_and_resend';

export interface TestSetWaitAnalysis {
  state: TestSetWaitState;
  /** Milliseconds since DIAN acknowledged the batch, when known. */
  waiting_ms: number | null;
  stalled: boolean;
  /**
   * Whether the batch can still be diagnosed document by document. False for
   * batches submitted before per-document keys were persisted: for those,
   * `GetStatus`-by-CUFE is impossible and re-sending is the only way forward.
   */
  diagnosable: boolean;
  /** Human-readable why, already in Spanish; null when there is nothing to explain. */
  reason: string | null;
  next_actions: TestSetNextAction[];
}

const HOUR_MS = 60 * 60 * 1000;

function hoursLabel(ms: number): string {
  const hours = Math.floor(ms / HOUR_MS);
  if (hours < 1) return 'menos de una hora';
  if (hours < 24) return `${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `${days} día${days === 1 ? '' : 's'}`;
}

/**
 * @param last_test_result the raw `dian_configurations.last_test_result` JSON
 * @param now injectable clock so the analysis is testable
 */
export function analyzeTestSetWait(
  last_test_result: unknown,
  now: number = Date.now(),
): TestSetWaitAnalysis {
  const result = (last_test_result ?? {}) as Record<string, any>;
  const zipKey: string | null = result.zip_key ?? null;

  if (!zipKey) {
    return {
      state: 'idle',
      waiting_ms: null,
      stalled: false,
      diagnosable: false,
      reason: null,
      next_actions: ['run_test_set'],
    };
  }

  const documents = Array.isArray(result.documents) ? result.documents : [];
  const diagnosable = documents.length > 0;

  if (result.abandoned === true) {
    return {
      state: 'abandoned',
      waiting_ms: null,
      stalled: false,
      diagnosable: false,
      reason: `El lote ${zipKey} se descartó sin veredicto de la DIAN.`,
      next_actions: ['run_test_set'],
    };
  }

  if (result.pending !== true) {
    if (result.rejected === true) {
      return {
        state: 'rejected',
        waiting_ms: null,
        stalled: false,
        diagnosable,
        reason:
          result.dian_response?.status_message ??
          'La DIAN rechazó el set de pruebas.',
        next_actions: ['abandon_and_resend'],
      };
    }
    return {
      state: 'passed',
      waiting_ms: null,
      stalled: false,
      diagnosable,
      reason: null,
      next_actions: [],
    };
  }

  // Measured from the submission, not from the last re-poll: what matters is how
  // long DIAN has held the batch, and re-polling must not reset that clock —
  // otherwise a user who keeps pressing "consultar" never reaches `stalled`.
  const submittedAt = result.executed_at
    ? new Date(result.executed_at).getTime()
    : NaN;
  const waiting_ms = Number.isFinite(submittedAt) ? now - submittedAt : null;
  const stalled =
    waiting_ms !== null && waiting_ms >= TEST_SET_STALL_AFTER_MS;

  if (!stalled) {
    return {
      state: 'processing',
      waiting_ms,
      stalled: false,
      diagnosable,
      reason: `La DIAN recibió el lote ${zipKey} y aún lo está validando.`,
      next_actions: ['recheck'],
    };
  }

  const waited = waiting_ms === null ? 'un tiempo prolongado' : hoursLabel(waiting_ms);

  return {
    state: 'stalled',
    waiting_ms,
    stalled: true,
    diagnosable,
    reason: diagnosable
      ? `La DIAN recibió el lote ${zipKey} hace ${waited} y no ha emitido veredicto. Consulta documento por documento para saber si los registró; si no los registró, descarta el lote y reenvía.`
      : `La DIAN recibió el lote ${zipKey} hace ${waited} y no ha emitido veredicto. Este lote se envió antes de que se guardaran las claves de documento, así que no se puede consultar por CUFE: descártalo y reenvía el set.`,
    next_actions: diagnosable
      ? ['diagnose_documents', 'abandon_and_resend']
      : ['abandon_and_resend'],
  };
}
