import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
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

  /** Separate from the listResults UUID cursor; bound to snapshot+projection. */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  artifact_cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  text_offset?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3000)
  text_limit?: number;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',') : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Matches(/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/, { each: true })
  columns?: string[];

  @IsOptional()
  @IsString()
  @Matches(/^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/)
  aggregate_field?: string;

  @IsOptional()
  @IsIn(['sum', 'avg', 'count', 'min', 'max'])
  aggregate_function?: 'sum' | 'avg' | 'count' | 'min' | 'max';
}

/** Declines a pending proposal; it never authorizes an alternative write. */
export class RejectAgentObjectiveProposalDto {
  @IsInt()
  @Min(1)
  expected_version!: number;
}
