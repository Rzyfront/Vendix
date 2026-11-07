import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export const MAX_RETAIN_DAYS = 36500;

export class CreateRetentionPolicyDto {
  /** Unique per store. Derived from the name when omitted. */
  @IsOptional() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{0,79}$/)
  key?: string;

  @IsString() @MaxLength(160)
  name!: string;

  /** Dossier subject it applies to (`employee`, `supplier`, ...); null = any. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40)
  subject_type?: string | null;

  /** File type (`document_file_profiles.doc_type`); null = any. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60)
  doc_type?: string | null;

  /** Days kept after the dossier closes. */
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_RETAIN_DAYS)
  retain_days!: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

export class UpdateRetentionPolicyDto {
  @IsOptional() @IsString() @MaxLength(160)
  name?: string;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(40)
  subject_type?: string | null;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60)
  doc_type?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_RETAIN_DAYS)
  retain_days?: number;

  @IsOptional() @IsBoolean()
  is_active?: boolean;
}

export class PageQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number = 20;
}
