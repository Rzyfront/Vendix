import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  TRANSFER_MOVEMENT_MODES,
  TRANSFER_SUPPORT_DOCUMENT_TYPES,
  TRANSFER_TRANSPORT_METHODS,
  type TransferMovementMode,
  type TransferSupportDocumentType,
  type TransferTransportMethod,
} from '../transfer-transport';

/**
 * Campos compartidos de la orden avanzada (D3–D8) por las dos superficies de
 * transferencias: tienda (`store/stock-transfers`) y organización
 * (`organization/inventory/transfers`). Viven acá para que un cambio de regla
 * no obligue a tocar dos DTOs que después divergen.
 */

export class InlineVehicleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  plate!: string;

  @IsOptional()
  @IsIn(['motorcycle', 'car', 'truck', 'van', 'bicycle', 'other'])
  type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  model_name?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  capacity_kg?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity_units?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  primary_driver_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class TransferTransportFieldsDto {
  @IsOptional()
  @IsIn([...TRANSFER_TRANSPORT_METHODS])
  transport_method?: TransferTransportMethod;

  @IsOptional()
  @IsInt()
  @Min(1)
  vehicle_id?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => InlineVehicleDto)
  vehicle?: InlineVehicleDto;

  @IsOptional()
  @IsInt()
  @Min(1)
  driver_user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  driver_name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_method_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  carrier_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  tracking_number?: string;

  /**
   * Costo del transporte: solo registro, no revaloriza el inventario (D6).
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  shipping_cost?: number;
}

export class TransferAdvancedFieldsDto extends TransferTransportFieldsDto {
  /**
   * D3: `mass_only` (sin remisiones) o `with_dispatch_notes` (remisión de
   * salida y de entrada). `quick` pertenece al movimiento rápido; `null` deja
   * el flujo anterior sin documentos.
   */
  @IsOptional()
  @IsIn([...TRANSFER_MOVEMENT_MODES])
  movement_mode?: TransferMovementMode;

  /** D8 — destino fuera de la organización: solo salida, sin recepción. */
  @IsOptional()
  @IsBoolean()
  is_external_destination?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_destination_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  external_destination_tax_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  external_destination_address?: string;

  @IsOptional()
  @IsIn([...TRANSFER_SUPPORT_DOCUMENT_TYPES])
  support_document_type?: TransferSupportDocumentType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  support_document_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  exit_reason?: string;
}

export class DispatchTransferItemDto {
  @IsInt()
  @Min(1)
  id!: number;

  /**
   * Conteo de salida de la línea (D3). Si no llega, se despacha la cantidad
   * completa pedida en la transferencia.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  quantity_dispatched?: number;

  /** Lote elegido por fila (D5). Si no llega, se usa el más antiguo. */
  @IsOptional()
  @IsInt()
  @Min(1)
  batch_id?: number;
}

export class DispatchTransferDto extends TransferTransportFieldsDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DispatchTransferItemDto)
  items?: DispatchTransferItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CloseTransferWithLossDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class ReceiveTransferItemDto {
  @IsInt()
  @Min(1)
  id!: number;

  @IsInt()
  @Min(0)
  quantity_received!: number;
}

export class ReceiveTransferDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiveTransferItemDto)
  items!: ReceiveTransferItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
