import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  MaxLength,
  Min,
  IsEnum,
  IsLatLong,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum AddressStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum AddressType {
  BILLING = 'billing',
  SHIPPING = 'shipping',
  HEADQUARTERS = 'headquarters',
  BRANCH_OFFICE = 'branch_office',
  WAREHOUSE = 'warehouse',
  LEGAL = 'legal',
  STORE_PHYSICAL = 'store_physical',
}

export class CreateAddressDto {
  @ApiProperty({ example: 'Calle 123', description: 'Línea principal de la dirección' })
  @IsString()
  @MaxLength(255)
  address_line_1: string;

  @ApiPropertyOptional({ example: 'Depto 4B', description: 'Línea secundaria de la dirección (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(255)
  address_line_2?: string;

  @ApiProperty({ example: 'Ciudad de México', description: 'Ciudad' })
  @IsString()
  @MaxLength(100)
  city: string;

  @ApiProperty({ example: 'CDMX', description: 'Estado o provincia' })
  @IsString()
  @MaxLength(100)
  state: string;

  @ApiProperty({ example: '01234', description: 'Código postal' })
  @IsString()
  @MaxLength(20)
  postal_code: string;

  @ApiProperty({ example: 'México', description: 'País' })
  @IsString()
  @MaxLength(100)
  country: string;

  @ApiPropertyOptional({ example: 'shipping', description: 'Tipo de dirección (opcional)' })
  @IsEnum(AddressType)
  @IsOptional()
  type?: AddressType;

  @ApiPropertyOptional({ example: 1, description: 'ID de cliente (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  customer_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de tienda (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: false, description: '¿Es dirección principal? (opcional)' })
  @IsBoolean()
  @IsOptional()
  is_default?: boolean;

  @ApiPropertyOptional({ example: '19.4326', description: 'Latitud (opcional)' })
  @IsString()
  @IsOptional()
  @IsLatLong()
  latitude?: string;

  @ApiPropertyOptional({ example: '-99.1332', description: 'Longitud (opcional)' })
  @IsString()
  @IsOptional()
  @IsLatLong()
  longitude?: string;

  @ApiPropertyOptional({ example: 'Frente a parque', description: 'Referencia o punto de interés (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  landmark?: string;

  @ApiPropertyOptional({ example: 'Dejar con portero', description: 'Instrucciones de entrega (opcional)' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  delivery_instructions?: string;

  @ApiPropertyOptional({ example: 'active', description: 'Estado de la dirección (opcional)' })
  @IsEnum(AddressStatus)
  @IsOptional()
  status?: AddressStatus;
}

// Update Address DTO
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

// Address Query DTO
export class AddressQueryDto {
  @ApiPropertyOptional({ example: 1, description: 'Página de resultados (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10, description: 'Cantidad de resultados por página (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({ example: 'parque', description: 'Búsqueda por texto (opcional)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por ID de cliente (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  customer_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'Filtrar por ID de tienda (opcional)' })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({ example: 'shipping', description: 'Filtrar por tipo de dirección (opcional)' })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional({ example: 'active', description: 'Filtrar por estado de dirección (opcional)' })
  @IsOptional()
  @IsEnum(AddressStatus)
  status?: AddressStatus;

  @ApiPropertyOptional({ example: false, description: 'Filtrar por dirección principal (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({ example: 'Ciudad de México', description: 'Filtrar por ciudad (opcional)' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'CDMX', description: 'Filtrar por estado (opcional)' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'México', description: 'Filtrar por país (opcional)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'created_at', description: 'Campo para ordenar (opcional)' })
  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @ApiPropertyOptional({ example: 'desc', description: 'Orden ascendente o descendente (opcional)' })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({ example: false, description: 'Incluir direcciones inactivas (opcional)' })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// GPS Coordinates DTO
export class UpdateGPSCoordinatesDto {
  @IsString()
  @IsLatLong()
  latitude: string;

  @IsString()
  @IsLatLong()
  longitude: string;
}
