import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';

export class TokenizePaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(16)
  @MaxLength(512)
  provider_token: string;

  @IsString()
  @IsOptional()
  type?: string = 'card';

  @IsString()
  @IsOptional()
  last4?: string;

  @IsString()
  @IsOptional()
  brand?: string;

  @IsString()
  @IsOptional()
  expiry_month?: string;

  @IsString()
  @IsOptional()
  expiry_year?: string;

  @IsString()
  @IsOptional()
  card_holder?: string;

  @IsBoolean()
  @IsOptional()
  is_default?: boolean = false;
}
