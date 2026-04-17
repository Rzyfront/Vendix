import { IsInt, IsOptional, Min } from 'class-validator';

export class AddToWishlistDto {
    @IsInt()
    @Min(1)
    product_id: number;

    @IsOptional()
    @IsInt()
    @Min(1)
    product_variant_id?: number;
}
