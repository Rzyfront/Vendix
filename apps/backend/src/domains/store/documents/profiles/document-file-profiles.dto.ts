import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateFileProfileDto {
  /** Free-text document type ("Póliza", "RUT"); `null` or blank clears it. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(60)
  doc_type?: string | null;

  /** Replaces the tags; they are normalized (lower case, trimmed, no duplicates). */
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(60, { each: true })
  tags?: string[];

  /** `YYYY-MM-DD`; `null` clears the expiry. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  valid_until?: string | null;
}

export class SetLegalHoldDto {
  @IsBoolean()
  legal_hold!: boolean;
}
