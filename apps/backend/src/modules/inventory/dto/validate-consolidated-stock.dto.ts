import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ValidateConsolidatedStockDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsNumber()
  @Type(() => Number)
  @Min(1, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'El ID de organización debe ser mayor a 0' })
  organization_id?: number;
}