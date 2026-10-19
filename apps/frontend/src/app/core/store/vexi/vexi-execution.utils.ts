import type {
  VexiExecutionSummary,
  VexiToolExecution,
} from '../../services/vexi-api.service';

/** Pending, user input and uncertainty are not red technical errors or success. */
export function vexiToolFailed(
  execution?: VexiToolExecution,
  legacyFailed?: boolean,
): boolean | undefined {
  return execution
    ? ['recoverable_error', 'blocked'].includes(execution.status)
    : legacyFailed;
}

export function vexiToolStepStatus(
  execution?: VexiToolExecution,
  failed?: boolean,
): 'done' | 'failed' | 'waiting' | 'unknown' {
  if (!execution) return failed ? 'failed' : 'done';
  if (vexiToolFailed(execution)) return 'failed';
  if (
    execution.status === 'pending_confirmation' ||
    execution.status === 'needs_user_input'
  )
    return 'waiting';
  return execution.status === 'unknown_effect' ||
    execution.freshness !== 'observed'
    ? 'unknown'
    : 'done';
}

export function vexiToolLabel(execution?: VexiToolExecution): string | null {
  if (!execution) return null;
  if (execution.status === 'pending_confirmation')
    return 'Cambio propuesto, pendiente de aprobación.';
  if (execution.status === 'needs_user_input')
    return execution.next_action || 'Falta un dato para continuar.';
  if (
    execution.status === 'unknown_effect' ||
    execution.freshness !== 'observed'
  )
    return 'Resultado sin verificar; no se confirma una acción completada.';
  if (vexiToolFailed(execution))
    return execution.next_action || 'No se pudo completar esta acción.';
  return null;
}

export function vexiTaskExecution(
  result: unknown,
): VexiExecutionSummary | null {
  if (!result || typeof result !== 'object') return null;
  const execution = (result as { execution?: VexiExecutionSummary }).execution;
  return execution?.schema_version === '1' &&
    typeof execution.next_action === 'string'
    ? execution
    : null;
}
