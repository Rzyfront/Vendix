import { IsInt, IsOptional } from 'class-validator';

export class AddToWishlistDto {
    @IsInt()
    product_id: number;

    @IsOptional()
    @IsInt()
    product_variant_id?: number;
}
