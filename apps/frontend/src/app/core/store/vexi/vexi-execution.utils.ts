import type {
  VexiExecutionSummary,
  VexiToolExecution,
} from '../../services/vexi-api.service';
import { vexiErrorText, vexiIsNonFailureCode } from './vexi-user-copy.utils';

/**
 * Una llamada que el backend no despachó todavía (lote detenido, llamada en
 * espera) no es un fallo ni un resultado: se reintenta sola y no se muestra.
 */
export function vexiToolDeferred(execution?: VexiToolExecution): boolean {
  return !!execution && vexiIsNonFailureCode(execution.error_code);
}

/**
 * Una lectura resumida por tamaño (`compacted` o `freshness: 'truncated'`)
 * sigue siendo una lectura válida: no es «sin confirmar» ni un fallo.
 */
function observedEnough(execution: VexiToolExecution): boolean {
  return (
    execution.freshness === 'observed' ||
    execution.freshness === 'truncated' ||
    execution.compacted === true
  );
}

/** Pending, user input and uncertainty are not red technical errors or success. */
export function vexiToolFailed(
  execution?: VexiToolExecution,
  legacyFailed?: boolean,
): boolean | undefined {
  if (!execution) return legacyFailed;
  if (vexiToolDeferred(execution)) return false;
  return ['recoverable_error', 'blocked'].includes(execution.status);
}

export function vexiToolStepStatus(
  execution?: VexiToolExecution,
  failed?: boolean,
): 'done' | 'failed' | 'waiting' | 'unknown' {
  if (!execution) return failed ? 'failed' : 'done';
  if (vexiToolDeferred(execution)) return 'waiting';
  if (vexiToolFailed(execution)) return 'failed';
  if (
    execution.status === 'pending_confirmation' ||
    execution.status === 'needs_user_input'
  )
    return 'waiting';
  return execution.status === 'unknown_effect' || !observedEnough(execution)
    ? 'unknown'
    : 'done';
}

/**
 * Etiqueta visible de un paso. Sale del catálogo cerrado: nunca de las notas
 * internas del recibo.
 */
export function vexiToolLabel(execution?: VexiToolExecution): string | null {
  if (!execution) return null;
  if (vexiToolDeferred(execution)) return null;
  if (execution.status === 'pending_confirmation')
    return 'Cambio propuesto, pendiente de aprobación.';
  if (execution.status === 'needs_user_input')
    return 'Falta un dato para continuar.';
  if (execution.status === 'unknown_effect')
    return 'No pude confirmar si el cambio se aplicó; revísalo antes de repetirlo.';
  if (vexiToolFailed(execution))
    return `${vexiErrorText(execution.error_code)}.`;
  if (!observedEnough(execution)) return 'No pude confirmar este resultado.';
  return null;
}

const OUTCOME_COPY: Readonly<Record<VexiExecutionSummary['outcome'], string>> =
  {
    partial: 'Quedó una parte por revisar.',
    blocked: 'No pude terminarlo.',
    pending_confirmation: 'Hay un cambio esperando tu aprobación.',
    needs_user_input: 'Me falta un dato tuyo para seguir.',
    unknown_effect:
      'No pude confirmar si el cambio se aplicó; revísalo antes de repetirlo.',
    failed: 'No pude terminarlo.',
    cancelled: 'El trabajo se canceló.',
  };

/** Frase humana del resultado de una tarea de fondo. */
export function vexiOutcomeText(execution: VexiExecutionSummary): string {
  if (execution.outcome === 'blocked' || execution.outcome === 'failed') {
    return execution.error_code
      ? `${vexiErrorText(execution.error_code)}.`
      : OUTCOME_COPY[execution.outcome];
  }
  return OUTCOME_COPY[execution.outcome] ?? 'Quedó algo por revisar.';
}

export function vexiTaskExecution(
  result: unknown,
): VexiExecutionSummary | null {
  if (!result || typeof result !== 'object') return null;
  const execution = (result as { execution?: VexiExecutionSummary }).execution;
  return execution?.schema_version === '1' &&
    typeof execution.outcome === 'string'
    ? execution
    : null;
}
