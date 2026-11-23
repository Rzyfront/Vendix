import {
  ArrayMinSize,
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TransferAdvancedFieldsDto } from '../../../../store/orders/stock-transfers/dto/transfer-advanced.dto';

export class CreateOrgTransferItemDto {
  @IsInt()
  @IsNotEmpty()
  product_id!: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  /** D5 — lote elegido por fila (opcional; al despachar se usa el más antiguo). */
  @IsOptional()
  @IsInt()
  @Min(1)
  batch_id?: number;

  @IsInt()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  cost_per_unit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Org-level cross-store / central-warehouse stock transfer creation payload.
 *
 * Locations may be central-warehouse or any store-bound warehouse within the
 * organization (validated via `OperatingScopeService.enforceLocationAccess`
 * with `allowCentral: true`).
 */
export class CreateOrgTransferDto extends TransferAdvancedFieldsDto {
  @IsInt()
  @IsNotEmpty()
  from_location_id!: number;

  /** D8: el destino es obligatorio salvo en una salida a destino externo. */
  @ValidateIf((dto: CreateOrgTransferDto) => !dto.is_external_destination)
  @IsInt()
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
  @Type(() => CreateOrgTransferItemDto)
  items!: CreateOrgTransferItemDto[];
}
