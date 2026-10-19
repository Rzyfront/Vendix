import type { VexiObjective } from '../../services/vexi-api.service';

/** A pointer is a handle, not executable authority. All reads still traverse API guards. */
export function objectivePointer(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = metadata as Record<string, unknown>;
  if (value['agent_objective_authority'] === 'durable-v1') {
    const pointer = value['agent_objective_id'];
    return typeof pointer === 'string' && pointer.length > 0 ? pointer : null;
  }
  const nested = value['objective'];
  const id =
    nested && typeof nested === 'object'
      ? (nested as Record<string, unknown>)['id']
      : value['objective_id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export function objectiveProgress(objective: VexiObjective | null): string {
  if (!objective)
    return 'Voy avanzando, pero alcancé el límite de continuaciones automáticas. ¿Sigo?';
  const next =
    typeof objective.next_step === 'string' ? objective.next_step.trim() : '';
  return (
    `Objetivo conservado: ${objective.goal}. Estado: ${objective.semantic_status}.` +
    (next ? ` Siguiente: ${next}.` : '') +
    ' Alcancé el límite de continuaciones automáticas; puedes revisar el progreso y elegir reanudar.'
  );
}

export function objectiveNeedsExpiredChoice(
  objective: VexiObjective,
  now = Date.now(),
): boolean {
  const expires = Date.parse(objective.expires_at);
  return (
    objective.semantic_status === 'expired' ||
    !Number.isFinite(expires) ||
    expires <= now
  );
}

export function canResumeObjective(
  objective: VexiObjective,
  confirmExpired = false,
): boolean {
  // An approval or uncertain domain effect must be resolved, not bypassed by resume.
  if (
    [
      'completed_verified',
      'cancelled',
      'superseded',
      'waiting_approval',
      'awaiting_approval',
      'pending_confirmation',
      'unknown_effect',
    ].includes(objective.semantic_status)
  )
    return false;
  return !objectiveNeedsExpiredChoice(objective) || confirmExpired;
}

/** Rehydrate only the whitelisted progress contract, never arbitrary conversation metadata. */
export function persistedObjective(
  metadata: unknown,
  conversationId: number,
): VexiObjective | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>)['objective'];
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row['id'] !== 'string' ||
    row['conversation_id'] !== conversationId ||
    !Number.isSafeInteger(row['version']) ||
    Number(row['version']) < 1 ||
    typeof row['goal'] !== 'string' ||
    typeof row['semantic_status'] !== 'string' ||
    typeof row['expires_at'] !== 'string'
  )
    return null;
  return {
    id: row['id'],
    conversation_id: conversationId,
    version: Number(row['version']),
    goal: row['goal'],
    semantic_status: row['semantic_status'],
    expires_at: row['expires_at'],
    next_step: row['next_step'],
    requires_revalidation: row['requires_revalidation'] === true,
    ...(row['budget'] &&
    typeof row['budget'] === 'object' &&
    !Array.isArray(row['budget'])
      ? { budget: row['budget'] as Record<string, unknown> }
      : {}),
  };
}
