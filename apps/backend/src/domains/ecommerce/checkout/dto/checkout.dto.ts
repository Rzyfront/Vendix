import { IsInt, IsOptional, IsString, ValidateNested, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

class ShippingAddressDto {
    @IsNotEmpty()
    @IsString()
    address_line1: string;

    @IsOptional()
    @IsString()
    address_line2?: string;

    @IsNotEmpty()
    @IsString()
    city: string;

    @IsOptional()
    @IsString()
    state_province?: string;

    @IsNotEmpty()
    @IsString()
    country_code: string;

    @IsOptional()
    @IsString()
    postal_code?: string;

    @IsOptional()
    @IsString()
    phone_number?: string;
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
    @ValidateNested()
    @Type(() => ShippingAddressDto)
    shipping_address?: ShippingAddressDto;

    @IsNotEmpty()
    @IsInt()
    payment_method_id: number;

    @IsOptional()
    @IsString()
    notes?: string;
}
