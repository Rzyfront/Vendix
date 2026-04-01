import { IsString, IsBoolean, IsOptional, IsNumber, IsDateString, MaxLength, IsArray, ValidateNested, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';

class CustomerReferenceDto {
  @IsString()
  @MaxLength(24)
  label: string;

  @IsBoolean()
  is_required: boolean;
}

export class CreatePaymentLinkDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  description: string;

  @IsBoolean()
  single_use: boolean;

  @IsBoolean()
  collect_shipping: boolean;

  @IsOptional()
  @IsNumber()
  amount_in_cents?: number | null;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsDateString()
  expires_at?: string;

  @IsOptional()
  @IsString()
  redirect_url?: string;

  @IsOptional()
  @IsString()
  image_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(36)
  sku?: string;

  @IsOptional()
  @IsNumber()
  order_id?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @ValidateNested({ each: true })
  @Type(() => CustomerReferenceDto)
  customer_references?: CustomerReferenceDto[];
}
