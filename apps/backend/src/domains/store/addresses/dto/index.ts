import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  Matches,
  MaxLength,
  Min,
  IsEnum,
  IsLatitude,
  IsLongitude,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

export * from './dian-municipality.dto';

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
  @ApiProperty({
    example: 'Calle 123',
    description: 'Línea principal de la dirección',
  })
  @IsString()
  @MaxLength(255)
  address_line_1: string;

  @ApiPropertyOptional({
    example: 'Depto 4B',
    description: 'Línea secundaria de la dirección (opcional)',
  })
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

  @ApiPropertyOptional({
    example: '01234',
    description: 'Código postal (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  postal_code?: string;

  // La columna es `country_code varchar(3)` y el servicio le asigna este campo
  // tal cual (`addresses.service.ts:113`). Con `@MaxLength(100)` cualquier
  // nombre de país —que es justo lo que el ejemplo «México» invitaba a mandar—
  // pasaba la validación y reventaba en Postgres como P2000, que el filtro
  // traduce a un 500 «Error interno» sobre lo que en realidad es un campo mal
  // formado. Acotarlo al ancho real convierte ese 500 en un 400 que dice qué
  // corregir. Ningún consumidor del frontend manda nombre: todos envían ya el
  // código ISO (`country: payload.country_code`), así que no rompe contrato.
  @ApiProperty({ example: 'CO', description: 'Código ISO 3166-1 del país' })
  @IsString()
  @Matches(/^[A-Za-z]{2,3}$/, {
    message:
      'country debe ser el código ISO 3166-1 del país (2 o 3 letras), no su nombre. Ej.: CO.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  country: string;

  /**
   * Código DANE (Divipola) del municipio. Persiste en
   * `addresses.municipality_code` y es lo que
   * `invoice-flow.service.ts` lee para poblar `customer_address.city_code` del
   * documento electrónico.
   *
   * OPCIONAL a propósito: la captura general de direcciones (envío, despacho,
   * checkout) no lo exige y las direcciones históricas lo tienen en NULL. Quien
   * lo exige es el camino de facturación, que ya lanza `CITY_CODE_REQUIRED`
   * cuando falta. Hacerlo obligatorio aquí rompería toda alta de dirección no
   * fiscal.
   *
   * Cadena vacía se normaliza a `undefined` para que un formulario que envía
   * `''` no choque contra el regex ni escriba basura en la columna.
   */
  @ApiPropertyOptional({
    example: '05001',
    description:
      'Código DANE (Divipola) de 5 dígitos del municipio: 05001 = Medellín, 11001 = Bogotá. Obligatorio solo para emitir factura electrónica a este adquiriente.',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsString()
  @Matches(/^\d{5}$/, {
    message:
      'municipality_code debe ser el código DANE de municipio de 5 dígitos (ej. "05001" = Medellín).',
  })
  municipality_code?: string;

  @ApiPropertyOptional({
    example: 'shipping',
    description: 'Tipo de dirección (opcional)',
  })
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

  @ApiPropertyOptional({
    example: 1,
    description: 'ID de organización (opcional)',
  })
  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;

  @ApiPropertyOptional({ example: 1, description: 'ID de usuario (opcional)' })
  @IsInt()
  @IsOptional()
  @Min(1)
  user_id?: number;

  @ApiPropertyOptional({
    example: false,
    description: '¿Es dirección principal? (opcional)',
  })
  @IsBoolean()
  @IsOptional()
  is_primary?: boolean;

  @ApiPropertyOptional({
    example: '19.4326',
    description: 'Latitud (opcional)',
  })
  @IsString()
  @IsOptional()
  @IsLatitude()
  latitude?: string;

  @ApiPropertyOptional({
    example: '-99.1332',
    description: 'Longitud (opcional)',
  })
  @IsString()
  @IsOptional()
  @IsLongitude()
  longitude?: string;

  @ApiPropertyOptional({
    example: 'Frente a parque',
    description: 'Referencia o punto de interés (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  landmark?: string;

  @ApiPropertyOptional({
    example: 'Dejar con portero',
    description: 'Instrucciones de entrega (opcional)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  delivery_instructions?: string;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Estado de la dirección (opcional)',
  })
  @IsEnum(AddressStatus)
  @IsOptional()
  status?: AddressStatus;
}

// Update Address DTO
export class UpdateAddressDto extends PartialType(CreateAddressDto) {}

// Address Query DTO
export class AddressQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: 'Página de resultados (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 10,
    description: 'Cantidad de resultados por página (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @ApiPropertyOptional({
    example: 'parque',
    description: 'Búsqueda por texto (opcional)',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filtrar por ID de cliente (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  customer_id?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filtrar por ID de tienda (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @ApiPropertyOptional({
    example: 'shipping',
    description: 'Filtrar por tipo de dirección (opcional)',
  })
  @IsOptional()
  @IsEnum(AddressType)
  type?: AddressType;

  @ApiPropertyOptional({
    example: 'active',
    description: 'Filtrar por estado de dirección (opcional)',
  })
  @IsOptional()
  @IsEnum(AddressStatus)
  status?: AddressStatus;

  @ApiPropertyOptional({
    example: false,
    description: 'Filtrar por dirección principal (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_primary?: boolean;

  @ApiPropertyOptional({
    example: 'Ciudad de México',
    description: 'Filtrar por ciudad (opcional)',
  })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({
    example: 'CDMX',
    description: 'Filtrar por estado (opcional)',
  })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({
    example: 'México',
    description: 'Filtrar por país (opcional)',
  })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    example: 'created_at',
    description: 'Campo para ordenar (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @ApiPropertyOptional({
    example: 'desc',
    description: 'Orden ascendente o descendente (opcional)',
  })
  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @ApiPropertyOptional({
    example: false,
    description: 'Incluir direcciones inactivas (opcional)',
  })
  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// GPS Coordinates DTO
export class UpdateGPSCoordinatesDto {
  @IsString()
  @IsLatitude()
  latitude: string;

  @IsString()
  @IsLongitude()
  longitude: string;
}
