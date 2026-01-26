import { IsString, IsOptional, IsInt, IsNumber, ValidateNested, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class ShippingAddressDto {
    @IsString()
    country_code: string;

    @IsString()
    @IsOptional()
    state_province?: string;

    @IsString()
    @IsOptional()
    city?: string;

    @IsString()
    @IsOptional()
    address_line1?: string;

    @IsString()
    @IsOptional()
    address_line2?: string;

    @IsString()
    @IsOptional()
    phone_number?: string;

    @IsString()
    @IsOptional()
    postal_code?: string;
}

export class CartItemCalcDto {
    @IsInt()
    product_id: number;

    @IsInt()
    quantity: number;

    @IsNumber()
    @IsOptional()
    weight?: number;

    @IsNumber()
    price: number;
}

export class CalculateShippingDto {
    @ValidateNested()
    @Type(() => ShippingAddressDto)
    address: ShippingAddressDto;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CartItemCalcDto)
    items: CartItemCalcDto[];
}
