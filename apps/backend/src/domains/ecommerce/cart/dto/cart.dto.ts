import { IsInt, IsOptional, IsArray, ValidateNested, Min, IsNotEmpty } from 'class-validator';
import { Type } from 'class-transformer';

export class AddToCartDto {
    @IsNotEmpty()
    @IsInt()
    @Min(0)
    product_id: number;

    @IsOptional()
    @IsInt()
    product_variant_id?: number;

    @IsInt()
    @Min(1)
    quantity: number;
}

export class UpdateCartItemDto {
    @IsInt()
    @Min(1)
    quantity: number;
}

export class SyncCartItemDto {
    @IsNotEmpty()
    @IsInt()
    @Min(0)
    product_id: number;

    @IsOptional()
    @IsInt()
    product_variant_id?: number;

    @IsInt()
    @Min(1)
    quantity: number;
}

export class SyncCartDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SyncCartItemDto)
    items: SyncCartItemDto[];
}
