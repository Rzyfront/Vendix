import { Injectable } from '@nestjs/common';
import type {
  WriteBatchStepInput,
  WriteBatchView,
} from './write-batch.types';

/** Result of `propose`: one entry per part (more than 25 steps → several parts). */
export interface WriteBatchProposal {
  group_id: string | null;
  batches: Array<{
    batch_id: string;
    part_index: number;
    part_total: number;
    step_count: number;
    block_id?: string;
  }>;
}

/**
 * Raised (as a value, not thrown) when a batch cannot be proposed: a step the
 * role cannot run, an irreversible step, a read-only tool, an invalid preview
 * or a limit breach. `explanation` is the human line Vex repeats verbatim.
 */
export interface WriteBatchRefusal {
  refused: true;
  reason:
    | 'empty'
    | 'unknown_tool'
    | 'not_a_write'
    | 'irreversible'
    | 'permission_denied'
    | 'invalid_arguments'
    | 'preview_error'
    | 'too_many_records'
    | 'no_conversation';
  /** 1-based order of the offending step, when one step caused it. */
  step_order?: number;
  explanation: string;
}

/**
 * T34 — proposes and reads Vex write batches. Owned by the T34 writer.
 * Skeleton signatures are the shared contract with the executor (T35) and the
 * compensation service (T36); keep them stable.
 */
@Injectable()
export class WriteBatchService {
  async propose(_input: {
    conversationId: number | null;
    goal: string;
    steps: WriteBatchStepInput[];
  }): Promise<WriteBatchProposal | WriteBatchRefusal> {
    throw new Error('not implemented');
  }

  /** Loads the batch row of the current store; 404 when absent, 403 when another user's. */
  async loadOwned(_batchId: string, _userId: number | undefined): Promise<any> {
    throw new Error('not implemented');
  }

  /** Client-safe view; expires a stale `proposed` batch first. */
  async getView(
    _batchId: string,
    _userId: number | undefined,
  ): Promise<WriteBatchView> {
    throw new Error('not implemented');
  }
}
