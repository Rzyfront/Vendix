import { Injectable } from '@nestjs/common';
import type { WriteBatchView } from './write-batch.types';

/** T36 — "Deshacer" of one applied, compensable batch step. Owned by the T36 writer. */
@Injectable()
export class WriteBatchCompensationService {
  async undoStep(_input: {
    batchId: string;
    stepId: string;
    userId: number | undefined;
  }): Promise<WriteBatchView> {
    throw new Error('not implemented');
  }
}
