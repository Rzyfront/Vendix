import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteWhatsappEmbeddedSignupDto {
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  waba_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  phone_number_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  display_phone_number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  business_account_id?: string;
}
