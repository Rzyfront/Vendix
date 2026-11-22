import {
  ArrayMaxSize,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';
import { WRITE_BATCH_MAX_STEPS } from '../services/write-batch.types';

/**
 * Body of `POST batches/:id/approve`. It only SELECTS which server-stored
 * steps run (`s1`…`s25`); tools and arguments always come from the persisted
 * batch, never from the client. An empty selection rejects the batch.
 */
export class ApproveWriteBatchDto {
  @IsArray()
  @ArrayMaxSize(WRITE_BATCH_MAX_STEPS)
  @IsString({ each: true })
  @Matches(/^s\d{1,3}$/, { each: true })
  step_ids!: string[];
}
