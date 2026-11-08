import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class WorkflowSubjectDto {
  @IsString() @MaxLength(40) type!: string;
  @IsInt() @Min(1) id!: number;
}

export class StartWorkflowDto {
  @ValidateIf((o) => o.definition_key === undefined)
  @IsInt() @Min(1)
  definition_id?: number;

  @ValidateIf((o) => o.definition_id === undefined)
  @IsString() @MaxLength(80)
  definition_key?: string;

  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsObject() data?: Record<string, unknown>;
  @IsOptional() @ValidateNested() @Type(() => WorkflowSubjectDto) subject?: WorkflowSubjectDto;
  /** P5.5: branch (`inventory_locations`) of the store. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) location_id?: number;
}

export class WorkflowInstancesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 10;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) definition_id?: number;
  @IsOptional() @IsIn(['active', 'completed', 'rejected', 'cancelled', 'failed']) status?: string;
  @IsOptional() @IsString() @MaxLength(80) stage_key?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) assignee_user_id?: number;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value === 'true' : value))
  @IsBoolean()
  overdue?: boolean;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

export class CancelWorkflowInstanceDto {
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
}

export class ForceTransitionDto {
  @IsString() @IsNotEmpty() @MaxLength(80) to!: string;
  @IsString() @IsNotEmpty() @MaxLength(1000) reason!: string;
  @IsOptional() @IsInt() @Min(0) expected_row_version?: number;
}

export class CompleteWorkflowTaskDto {
  @IsString() @IsNotEmpty() @MaxLength(40) outcome!: string;
  @IsOptional() @IsObject() values?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsInt() @Min(0) expected_row_version!: number;
}
