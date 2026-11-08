import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  isHumanStage,
  stageFormKeys,
  stageOutcomes,
  visibleFieldKeys,
} from '@common/workflows/contract';

/** Decisions that send the case back or reject it need neither form values nor requirements. */
const NO_VALUES_OUTCOMES = ['reject', 'return'];
/** The engine only blocks these outcomes on pending requirements. */
const REQUIREMENT_OUTCOMES = ['approve', 'submit'];

export interface StageMove {
  to_stage_key: string;
  outcome: string;
  /** True when completing the task needs more than a click (the UI opens the modal). */
  requires_modal: boolean;
}

/** A requirement that can hold the stage (same rule as the detail endpoint). */
export function hasBlockingRequirement(stage: WorkflowStageDef): boolean {
  return (stage.requirements ?? []).some((r) =>
    r.kind === 'file_field' || r.kind === 'issued_document' ? true : r.blocks_exit !== false,
  );
}

/** Outcomes with at least one transition, in stage order. */
export function usableOutcomes(stage: WorkflowStageDef): string[] {
  if (!isHumanStage(stage)) return [];
  const allowed = new Set(stageOutcomes(stage));
  return [...new Set((stage.transitions ?? []).map((t) => t.on))].filter((o) => allowed.has(o));
}

/**
 * Outcomes the inbox lets you do without opening the detail: no required
 * visible form field, no blocking requirement and not every transition of the
 * outcome asking for a comment.
 */
export function quickOutcomes(
  definition: WorkflowDefinitionV1,
  stage: WorkflowStageDef,
  data: Record<string, unknown>,
): string[] {
  const requiredVisible = visibleFieldKeys(definition, stage, data).some(
    (k) => definition.fields.find((f) => f.key === k)?.required,
  );
  const blocking = hasBlockingRequirement(stage);
  return usableOutcomes(stage).filter((outcome) => {
    if (requiredVisible && !NO_VALUES_OUTCOMES.includes(outcome)) return false;
    if (blocking && REQUIREMENT_OUTCOMES.includes(outcome)) return false;
    const transitions = (stage.transitions ?? []).filter((t) => t.on === outcome);
    return !transitions.every((t) => t.require_comment);
  });
}

/** Moves a card can make out of `stage`, with whether the UI must open the modal. */
export function stageMoves(stage: WorkflowStageDef): StageMove[] {
  const outcomes = new Set(usableOutcomes(stage));
  const hasForm = stageFormKeys(stage).length > 0;
  const blocking = hasBlockingRequirement(stage);
  const quorum = (stage.quorum?.required ?? 1) > 1;
  const seen = new Set<string>();
  const moves: StageMove[] = [];
  for (const t of stage.transitions ?? []) {
    if (!outcomes.has(t.on)) continue;
    const id = `${t.on}>${t.to}`;
    if (seen.has(id)) continue;
    seen.add(id);
    moves.push({
      to_stage_key: t.to,
      outcome: t.on,
      requires_modal:
        (hasForm && !NO_VALUES_OUTCOMES.includes(t.on)) ||
        (blocking && REQUIREMENT_OUTCOMES.includes(t.on)) ||
        !!t.when ||
        !!t.require_comment ||
        (quorum && t.on === 'approve'),
    });
  }
  return moves;
}
