import { Type } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';
import { WORKFLOW_SUBJECT_TYPES } from '@common/workflows/contract';

/** `GET store/workflow-links`: the record whose requests are listed. */
export class WorkflowLinksQueryDto {
  @IsIn(WORKFLOW_SUBJECT_TYPES.filter((t) => t !== 'none'))
  entity_type!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  entity_id!: number;
}
