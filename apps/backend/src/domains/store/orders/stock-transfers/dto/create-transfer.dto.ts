import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDate,
  ValidateNested,
  IsArray,
  IsInt,
  Min,
  ArrayMinSize,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransferAdvancedFieldsDto } from './transfer-advanced.dto';

export class CreateTransferItemDto {
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsOptional()
  @IsNumber()
  product_variant_id?: number;

  /** D5 — lote elegido por fila (opcional; al despachar se usa el más antiguo). */
  @IsOptional()
  @IsInt()
  @Min(1)
  batch_id?: number;

  // Unidades de stock (las mismas de `stock_levels`, columna Int): la compra
  // ya convierte su unidad de compra a unidad de stock al recibir.
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  cost_per_unit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTransferDto extends TransferAdvancedFieldsDto {
  @IsNumber()
  @IsNotEmpty()
  from_location_id: number;

  /** D8: el destino es obligatorio salvo en una salida a destino externo. */
  @ValidateIf((dto: CreateTransferDto) => !dto.is_external_destination)
  @IsNumber()
  @IsNotEmpty()
  to_location_id?: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expected_date?: Date;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items: CreateTransferItemDto[];
}
