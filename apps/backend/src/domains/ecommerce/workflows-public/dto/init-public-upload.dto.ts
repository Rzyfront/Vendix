import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PublicWorkflowCaptchaDto } from './submit-public-workflow-form.dto';

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

  /** Form uploads of a captcha link: a solved proof (single use)... */
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicWorkflowCaptchaDto)
  captcha?: PublicWorkflowCaptchaDto;

  /** ...or the grant returned by an earlier init of the same form. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  upload_grant?: string;
}

export class ReplyTrackingDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;
}
