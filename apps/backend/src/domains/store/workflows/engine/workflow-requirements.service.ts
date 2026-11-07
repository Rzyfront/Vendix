import { Injectable } from '@nestjs/common';
import { WorkflowStageDef } from '@common/workflows/contract';
import { isBlockingRequirement, isFilledValue } from './workflow-rules';
import { DossiersService } from '../../documents/dossiers.service';
import {
  PendingRequirement,
  WorkflowInstanceRow,
  WorkflowRequirementsService,
  WorkflowTx,
} from './workflow-engine.types';

const isFilled = isFilledValue;

/** Issued-document statuses that satisfy an `issued_document` requirement. */
const ISSUED_OK = new Set(['issued', 'pending_signature', 'signed']);

function fileIdsOf(v: unknown): number[] {
  const list = Array.isArray(v) ? v : [v];
  return list.filter((x): x is number => Number.isInteger(x) && (x as number) > 0);
}

/**
 * Evaluation backed by the instance dossier.
 *
 * - `upload`: satisfied when the dossier holds an active (`received` |
 *   `validated`) item with that `requirement_key`. `blocks_exit: false` never
 *   blocks (it is not reported as pending).
 * - `file_field`: the instance data field is non-empty AND every file id in it
 *   is a stored file of this store that belongs to the instance dossier.
 * - `issued_document` (P4.1): satisfied when the instance's current issued
 *   document for that key is rendered (`issued`, `pending_signature` or
 *   `signed`); `rendering` and `failed` stay pending.
 * - `signature` (P4.2): satisfied when the current issued document of `of` is
 *   `signed` (sealed). `blocks_exit: false` never blocks.
 */
@Injectable()
export class DossierWorkflowRequirementsService extends WorkflowRequirementsService {
  constructor(private readonly dossiers: DossiersService) {
    super();
  }

  async pendingRequirements(
    instance: Pick<WorkflowInstanceRow, 'id' | 'data' | 'current_stage_key'> &
      Partial<WorkflowInstanceRow>,
    stage: WorkflowStageDef,
    tx?: WorkflowTx,
  ): Promise<PendingRequirement[]> {
    const requirements = stage.requirements ?? [];
    if (requirements.length === 0) return [];
    const dossier = requirements.some((r) => r.kind === 'upload' || r.kind === 'file_field')
      ? await this.dossiers.getByInstance(instance.id, tx)
      : null;

    const pending: PendingRequirement[] = [];
    for (const req of requirements) {
      if (!isBlockingRequirement(req)) continue;
      switch (req.kind) {
        case 'file_field': {
          const value = (instance.data ?? {})[req.field];
          if (!isFilled(value)) {
            pending.push({ key: req.key, label: req.label });
            break;
          }
          const ids = fileIdsOf(value);
          const missing = dossier
            ? await this.dossiers.missingFileIds(dossier.id, ids, tx)
            : ids;
          if (ids.length === 0 || missing.length > 0) {
            pending.push({ key: req.key, label: req.label });
          }
          break;
        }
        case 'upload': {
          if (req.blocks_exit === false) break;
          const done = dossier
            ? await this.dossiers.hasActiveItem(dossier.id, req.key, tx)
            : false;
          if (!done) pending.push({ key: req.key, label: req.label });
          break;
        }
        case 'signature': {
          if (req.blocks_exit === false) break;
          const status = await this.dossiers.currentIssuedStatus(instance.id, req.of, tx);
          if (status !== 'signed') pending.push({ key: req.key, label: req.label });
          break;
        }
        case 'issued_document': {
          const status = await this.dossiers.currentIssuedStatus(instance.id, req.key, tx);
          if (!status || !ISSUED_OK.has(status)) pending.push({ key: req.key, label: req.label });
          break;
        }
      }
    }
    return pending;
  }
}
