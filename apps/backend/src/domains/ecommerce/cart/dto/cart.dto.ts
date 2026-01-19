import { IsInt, IsOptional, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class AddToCartDto {
    @IsInt()
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
    @IsInt()
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
