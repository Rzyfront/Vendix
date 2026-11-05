import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' : value;

export class WorkflowInboxQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
  @IsOptional() @IsIn(['open', 'claimed']) status?: 'open' | 'claimed';
  @IsOptional() @Transform(toBool) @IsBoolean() overdue?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) definition_id?: number;
}

export class WorkflowBoardQueryDto {
  @IsOptional() @IsString() @MaxLength(80) column?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) cursor?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number = 20;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assignee_user_id?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() overdue?: boolean;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}

export class WorkflowCommentsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before_id?: number;
}

export class CreateWorkflowCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) body!: string;
}

export class WorkflowAnalyticsQueryDto {
  /** Store-local calendar dates, `YYYY-MM-DD`. */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['json', 'xlsx']) format?: 'json' | 'xlsx' = 'json';
}
