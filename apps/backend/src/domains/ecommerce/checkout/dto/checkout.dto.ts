import { IsInt, IsOptional, IsString, IsObject, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

class CheckoutCartItemDto {
  @IsInt()
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CheckoutDto {
    @IsOptional()
    @IsInt()
    shipping_method_id?: number;

    @IsOptional()
    @IsInt()
    shipping_rate_id?: number;

    @IsOptional()
    @IsInt()
    shipping_address_id?: number;

    @IsOptional()
    @IsObject()
    shipping_address?: {
        address_line1: string;
        address_line2?: string;
        city: string;
        state_province?: string;
        country_code: string;
        postal_code?: string;
        phone_number?: string;
    };

    @IsInt()
    payment_method_id: number;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CheckoutCartItemDto)
    items?: CheckoutCartItemDto[];
}
