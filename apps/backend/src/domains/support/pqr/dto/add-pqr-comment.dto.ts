import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class AddPqrCommentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(5000)
  content!: string;

  /**
   * When true, the comment is visible only to admins (default).
   * When false, the comment is treated as an official response to the
   * requester and triggers an email notification + appears on the public
   * tracking view.
   */
  @IsOptional()
  @Transform(({ value }) => (value === undefined ? true : Boolean(value)))
  @IsBoolean()
  is_internal?: boolean = true;

  /**
   * Force-send notification even when is_internal is false (e.g. when
   * the admin wants to mark a comment internal but still send a copy to
   * the requester). Defaults to is_internal's negation.
   */
  @IsOptional()
  @IsBoolean()
  notify_requester?: boolean;
}