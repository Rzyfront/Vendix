import {
    IsString,
    IsOptional,
    IsEnum,
    IsObject,
    IsNumber,
    IsInt,
    IsArray,
    ValidateNested,
    Min,
    MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { payment_method_state_enum } from '@prisma/client';

export class EnablePaymentMethodDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    display_name?: string;

    @IsOptional()
    @IsObject()
    custom_config?: any;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    display_order?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    min_amount?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    max_amount?: number;
}

export class UpdateStorePaymentMethodDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    display_name?: string;

    @IsOptional()
    @IsObject()
    custom_config?: any;

    @IsOptional()
    @IsEnum(payment_method_state_enum)
    state?: payment_method_state_enum;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    display_order?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    min_amount?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    max_amount?: number;
}

export class PaymentMethodOrderItem {
    @IsInt()
    @Type(() => Number)
    id: number;
}

export class ReorderPaymentMethodsDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PaymentMethodOrderItem)
    methods: PaymentMethodOrderItem[];
}
