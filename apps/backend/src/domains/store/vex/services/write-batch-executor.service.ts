import { Injectable } from '@nestjs/common';
import type { WriteBatchView } from './write-batch.types';

export interface WriteBatchApprovalResult {
  batch: WriteBatchView;
  /** True when this call lost the atomic claim (double click / second tab). */
  replayed: boolean;
}

/** T35 — single approval + sequential executor. Owned by the T35 writer. */
@Injectable()
export class WriteBatchExecutorService {
  async approve(_input: {
    batchId: string;
    userId: number | undefined;
    stepIds: string[];
  }): Promise<WriteBatchApprovalResult> {
    throw new Error('not implemented');
  }

  async reject(_input: {
    batchId: string;
    userId: number | undefined;
  }): Promise<WriteBatchApprovalResult> {
    throw new Error('not implemented');
  }
}
