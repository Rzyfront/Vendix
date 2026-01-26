import { IsInt, IsOptional, IsString, IsObject } from 'class-validator';

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
}
