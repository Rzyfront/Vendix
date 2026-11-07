import { Type } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
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

  @Equals(true, { message: 'Debes aceptar el aviso de privacidad.' })
  accept_privacy!: true;
}
