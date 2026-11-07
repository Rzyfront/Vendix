import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SignerInputDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  document_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  role_label?: string;

  /** `signature_slots[].key` of the template this signer fills. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  slot_key?: string;

  @IsIn(['otp_email', 'otp_whatsapp'])
  method!: 'otp_email' | 'otp_whatsapp';
}

export class CreateSignatureRequestDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  issued_document_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => SignerInputDto)
  signers!: SignerInputDto[];
}

export class CancelSignatureRequestDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class VerifyOtpDto {
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class SignDocumentDto {
  /** PNG of the stroke, base64 (a `data:image/png;base64,` prefix is accepted). */
  @IsString()
  @MinLength(100)
  @MaxLength(300_000)
  signature_png!: string;

  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

export class DeclineDocumentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
