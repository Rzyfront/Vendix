import { Injectable } from '@nestjs/common';
import { WorkflowStageDef } from '@common/workflows/contract';
import {
  PendingRequirement,
  WorkflowInstanceRow,
  WorkflowRequirementsService,
} from './workflow-engine.types';

function isFilled(v: unknown): boolean {
  return !(
    v === undefined ||
    v === null ||
    v === '' ||
    (Array.isArray(v) && v.length === 0)
  );
}

/**
 * Default evaluation. `file_field` is satisfied when the instance data field is
 * non-empty. `upload`, `issued_document` and `signature` have no storage yet
 * (documents block): they are reported as pending whenever they block the exit,
 * and the documents module replaces this provider with the real evaluation.
 */
@Injectable()
export class DefaultWorkflowRequirementsService extends WorkflowRequirementsService {
  async pendingRequirements(
    instance: Pick<WorkflowInstanceRow, 'data'>,
    stage: WorkflowStageDef,
  ): Promise<PendingRequirement[]> {
    const pending: PendingRequirement[] = [];
    for (const req of stage.requirements ?? []) {
      if (req.kind === 'file_field') {
        if (!isFilled((instance.data ?? {})[req.field])) {
          pending.push({ key: req.key, label: req.label });
        }
        continue;
      }
      // upload / signature: blocks_exit defaults to true; issued_document blocks.
      const blocks =
        req.kind === 'issued_document' ? true : req.blocks_exit !== false;
      if (blocks) pending.push({ key: req.key, label: req.label });
    }
    return pending;
  }
}
