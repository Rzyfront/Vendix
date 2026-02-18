import { IsOptional, IsString, IsArray, ValidateNested, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

class WhatsappCartItemDto {
  @IsInt()
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class WhatsappCheckoutDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WhatsappCartItemDto)
  items?: WhatsappCartItemDto[];
}
