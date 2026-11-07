import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { WORKFLOW_KEY_PATTERN } from '@common/workflows/contract';
import { REFERENCE_PREFIX_PATTERN } from './workflow-record-fields';

/** The value exactly as the client sent it (no implicit conversion). */
const rawValue = ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key];

const toBool = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value === 'true' : value;

export class CreateWorkflowCollectionDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string;
  @IsString() @IsNotEmpty() @MaxLength(120) item_name!: string;
  @IsString() @Matches(WORKFLOW_KEY_PATTERN) key!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  /**
   * Deep shape checked by `validateCollectionFields`. The raw value is kept:
   * the global implicit conversion would turn each plain field into `{}`.
   */
  @Transform(rawValue) @IsArray() @ArrayMaxSize(50) fields!: Record<string, unknown>[];
  @IsOptional() @IsString() @MaxLength(80) title_field?: string;
  @IsOptional() @IsString() @Matches(REFERENCE_PREFIX_PATTERN) reference_prefix?: string;
}

/** `key` is immutable: it is not accepted here. */
export class UpdateWorkflowCollectionDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) item_name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @Transform(rawValue) @IsArray() @ArrayMaxSize(50) fields?: Record<string, unknown>[];
  @IsOptional() @IsString() @MaxLength(80) title_field?: string;
  @IsOptional() @IsString() @Matches(REFERENCE_PREFIX_PATTERN) reference_prefix?: string;
}

export class WorkflowCollectionsQueryDto {
  @IsOptional() @Transform(toBool) @IsBoolean() include_archived?: boolean;
}

export class CreateWorkflowRecordDto {
  @Type(() => Number) @IsInt() @Min(1) collection_id!: number;
  @IsOptional() @IsObject() values?: Record<string, unknown>;
}

/** `null` removes an optional value. */
export class UpdateWorkflowRecordDto {
  @IsObject() values!: Record<string, unknown>;
}

export class WorkflowRecordsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) collection_id!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 10;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsIn(['created_at', 'updated_at', 'title', 'reference']) sort_by?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sort_order?: 'asc' | 'desc';
  @IsOptional() @Transform(toBool) @IsBoolean() include_archived?: boolean;
}

export class StartWorkflowOnRecordDto {
  @Type(() => Number) @IsInt() @Min(1) definition_id!: number;
}
