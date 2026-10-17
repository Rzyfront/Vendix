import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/** Selects one objective. It neither starts inference nor replenishes its budget. */
export class ResumeAgentObjectiveDto {
  @IsInt()
  @Min(1)
  expected_version!: number;

  /** Required true only when deliberately selecting this expired objective. */
  @IsOptional()
  @IsBoolean()
  confirm_expired?: boolean;
}

/** Bounded artifact retrieval; cursors refer only to this owned objective. */
export class AgentObjectiveResultsQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Declines a pending proposal; it never authorizes an alternative write. */
export class RejectAgentObjectiveProposalDto {
  @IsInt()
  @Min(1)
  expected_version!: number;
}
