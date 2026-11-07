import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsInt,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PublicWorkflowContactDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;
}

/** Solved proof-of-work challenge (`GET .../captcha`). */
export class PublicWorkflowCaptchaDto {
  @IsString()
  @MaxLength(64)
  salt!: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  number!: number;

  @IsString()
  @MaxLength(40)
  expires_at!: string;

  @IsString()
  @MaxLength(128)
  signature!: string;
}

export class SubmitPublicWorkflowFormDto {
  /** Client-generated id of this submission: makes a double click idempotent. */
  @IsUUID()
  submission_id!: string;

  @IsObject()
  values!: Record<string, unknown>;

  @ValidateNested()
  @Type(() => PublicWorkflowContactDto)
  @IsNotEmptyObject()
  contact!: PublicWorkflowContactDto;

  /** Required only when the link asks for it (`captcha_required`). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PublicWorkflowCaptchaDto)
  captcha?: PublicWorkflowCaptchaDto;

  @Equals(true, { message: 'Debes aceptar el aviso de privacidad.' })
  accept_privacy!: true;
}
