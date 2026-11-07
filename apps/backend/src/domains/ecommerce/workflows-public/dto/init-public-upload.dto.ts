import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Opens a chunked upload (form field or tracking requirement). */
export class InitPublicUploadDto {
  /** Form uploads only: the `file` field of the start form. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  field_key?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  file_name!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  mime_type!: string;

  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  size_bytes!: number;
}

export class ReplyTrackingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
