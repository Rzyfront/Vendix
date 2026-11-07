import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsArray,
  ValidateNested,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { WORKFLOW_KEY_PATTERN } from '@common/workflows/contract';

export class WorkflowDefinitionsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 10;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['draft', 'active', 'archived']) status?: 'draft' | 'active' | 'archived';
}

export class CreateWorkflowDefinitionDto {
  @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @Matches(WORKFLOW_KEY_PATTERN, {
    message: 'La clave solo admite minúsculas, números, guion y guion bajo.',
  })
  key?: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() @MaxLength(60) category?: string;
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
}

export class SaveWorkflowDraftDto {
  @IsObject() definition!: Record<string, unknown>;
  @IsOptional() @IsString() expected_draft_updated_at?: string;
}

export class ValidateWorkflowDto {
  @IsObject() definition!: Record<string, unknown>;
}

export class PublishWorkflowDto {
  @IsOptional() @IsString() @MaxLength(500) changelog?: string;
}

export class ImportWorkflowDto {
  @IsObject() definition!: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(160) name?: string;
}

export class ExportWorkflowQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) version?: number;
}

export class SimulateStateDto {
  @IsString() @MinLength(1) @MaxLength(100) stage_key!: string;
  @IsObject() data!: Record<string, unknown>;
}

export class SimulateWorkflowDto {
  @IsOptional() @IsObject() definition?: Record<string, unknown>;
  @IsOptional() @ValidateNested() @Type(() => SimulateStateDto) state?: SimulateStateDto;
  @IsOptional() @IsString() @MaxLength(100) outcome?: string;
  @IsOptional() @IsObject() values?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true })
  satisfied_requirements?: string[];
}

/** P2.11 */
export class SetWorkflowEnabledDto {
  @IsBoolean() enabled!: boolean;
}

/** P2.8: old stage key → stage key of the published version. */
export class MigrateWorkflowInstancesDto {
  @Type(() => Number) @IsInt() @Min(1) from_version_id!: number;
  @IsOptional() @IsObject() stage_map?: Record<string, string>;
}
