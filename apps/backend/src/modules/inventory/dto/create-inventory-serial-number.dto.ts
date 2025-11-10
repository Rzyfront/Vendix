import {
  IsString,
  IsOptional,
  IsUUID,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
// Using local enum definition until Prisma client is regenerated
enum SerialNumberStatus {
  IN_STOCK = 'in_stock',
  RESERVED = 'reserved',
  SOLD = 'sold',
  RETURNED = 'returned',
  DAMAGED = 'damaged',
  EXPIRED = 'expired',
  IN_TRANSIT = 'in_transit',
}

export class CreateInventorySerialNumberDto {
  @IsString()
  serialNumber: string;

  @IsUUID()
  batchId: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @IsUUID()
  organizationId: string;

  @IsOptional()
  @IsEnum(SerialNumberStatus)
  status?: SerialNumberStatus = SerialNumberStatus.IN_STOCK;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  cost?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSerialNumbersForBatchDto {
  @IsUUID()
  batchId: string;

  @IsArray()
  @IsString({ each: true })
  serialNumbers: string[];

  @IsUUID()
  organizationId: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

export class UpdateInventorySerialNumberDto {
  @IsOptional()
  @IsEnum(SerialNumberStatus)
  status?: SerialNumberStatus;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsUUID()
  salesOrderId?: string;

  @IsOptional()
  @IsUUID()
  purchaseOrderId?: string;
}

export class TransferSerialNumberDto {
  @IsUUID()
  targetLocationId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MarkAsSoldDto {
  @IsUUID()
  salesOrderId: string;
}

export class MarkAsReturnedDto {
  @IsUUID()
  locationId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class MarkAsDamagedDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetSerialNumbersDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @IsOptional()
  @IsUUID()
  batchId?: string;

  @IsOptional()
  @IsUUID()
  locationId?: string;

  @IsOptional()
  @IsEnum(SerialNumberStatus)
  status?: SerialNumberStatus;

  @IsOptional()
  @IsString()
  search?: string;
}

export class GetAvailableSerialNumbersDto {
  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  productVariantId?: string;

  @IsUUID()
  locationId: string;
}
