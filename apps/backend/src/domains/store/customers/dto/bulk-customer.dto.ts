import {
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { DOCUMENT_TYPE_CODES } from '../../../../common/constants/document-types';
import { DocumentNumberMatchesType } from '../../../../common/validators/document-number.validator';

/**
 * Re-export del shape canónico de error de carga masiva. La definición
 * vive en `@common/validators/bulk-validation.util` para que pueda ser
 * reutilizado por otros bulks (products, orders) sin invertir la
 * dependencia `common → domains`.
 */
import type { BulkRowError } from '../../../../common/validators/bulk-validation.util';
export type { BulkRowError };

export class BulkCustomerItemDto {
  @ApiPropertyOptional({ example: 'maria.garcia@email.com' })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  @IsOptional()
  @IsEmail(
    {},
    {
      message:
        'El formato del correo electrónico no es válido (ej. usuario@dominio.com)',
    },
  )
  email?: string;

  @ApiPropertyOptional({ example: 'Maria' })
  @IsOptional()
  @IsString({ message: 'El nombre debe ser texto' })
  first_name?: string;

  @ApiPropertyOptional({ example: 'Garcia' })
  @IsOptional()
  @IsString({ message: 'El apellido debe ser texto' })
  last_name?: string;

  @ApiPropertyOptional({ example: '12345678' })
  @IsOptional()
  @IsString({ message: 'El número de documento debe ser texto' })
  @DocumentNumberMatchesType()
  document_number?: string;

  @ApiPropertyOptional({ example: 'CC', enum: DOCUMENT_TYPE_CODES })
  @IsOptional()
  @IsString({ message: 'El tipo de documento debe ser texto' })
  @IsIn(DOCUMENT_TYPE_CODES as unknown as string[], {
    message: 'document_type debe ser uno de los códigos DIAN válidos',
  })
  document_type?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsString({ message: 'El teléfono debe ser texto' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({ example: 'NATURAL', enum: ['NATURAL', 'JURIDICA'] })
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.trim() === ''
        ? undefined
        : value.trim().toUpperCase()
      : value,
  )
  @IsOptional()
  @IsIn(['NATURAL', 'JURIDICA'], {
    message: "El tipo de persona debe ser 'NATURAL' o 'JURIDICA'",
  })
  person_type?: 'NATURAL' | 'JURIDICA';

  @ApiPropertyOptional({ example: 'Acme S.A.S' })
  @IsOptional()
  @IsString({ message: 'La razón social debe ser texto' })
  @MaxLength(255)
  legal_name?: string;

  @ApiPropertyOptional({ example: '7' })
  @IsOptional()
  @IsString({ message: 'El DV debe ser texto' })
  @MaxLength(1, { message: 'El DV debe ser un único dígito' })
  verification_digit?: string;

  @ApiPropertyOptional({ example: 'Sede Norte' })
  @IsOptional()
  @IsString({ message: 'El nombre de la sede debe ser texto' })
  @MaxLength(120)
  location_name?: string;

  @ApiPropertyOptional({ example: 'Calle 123 # 45-67' })
  @IsOptional()
  @IsString({ message: 'La dirección debe ser texto' })
  @MaxLength(255)
  address_line_1?: string;

  @ApiPropertyOptional({ example: 'Bodega 4' })
  @IsOptional()
  @IsString({ message: 'La dirección 2 debe ser texto' })
  @MaxLength(255)
  address_line_2?: string;

  @ApiPropertyOptional({ example: 'Medellín' })
  @IsOptional()
  @IsString({ message: 'La ciudad debe ser texto' })
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ example: 'Antioquia' })
  @IsOptional()
  @IsString({ message: 'El departamento debe ser texto' })
  @MaxLength(100)
  state?: string;

  @ApiPropertyOptional({ example: '05001' })
  @IsOptional()
  @IsString({ message: 'El código DANE debe ser texto' })
  @MaxLength(10)
  municipality_code?: string;

  @ApiPropertyOptional({ example: 'CO' })
  @IsOptional()
  @IsString({ message: 'El país debe ser texto' })
  @MaxLength(3)
  country?: string;

  @ApiPropertyOptional({ example: '3001234567' })
  @IsOptional()
  @IsString({ message: 'El teléfono de la sede debe ser texto' })
  @MaxLength(50)
  location_phone?: string;

  @ApiPropertyOptional({ example: 3 })
  @IsNumber({}, { message: 'El número de fila debe ser numérico' })
  @IsOptional()
  row_number?: number;
}

/** Tope por request: el cliente envía de a 100; el total por archivo (10.000) lo gobierna el servicio. */
export const MAX_BULK_CUSTOMER_UPLOAD_PAGE = 100;

export class BulkCustomerUploadDto {
  @ApiProperty({ type: [BulkCustomerItemDto] })
  @IsArray()
  @ArrayMaxSize(MAX_BULK_CUSTOMER_UPLOAD_PAGE, {
    message: `Cada envío admite máximo ${MAX_BULK_CUSTOMER_UPLOAD_PAGE} clientes; el total por archivo es de 10.000`,
  })
  @ValidateNested({ each: true })
  @Type(() => BulkCustomerItemDto)
  customers: BulkCustomerItemDto[];
}

export class BulkCustomerUploadItemResultDto {
  @ApiPropertyOptional()
  customer?: any;

  @ApiProperty({ example: 'success' })
  status: 'success' | 'error' | 'location_added' | 'warning';

  @ApiProperty({ example: 'Cliente creado exitosamente' })
  message: string;

  @ApiPropertyOptional({ example: 'ConflictException' })
  error?: string;

  @ApiPropertyOptional({ example: 3 })
  row_number?: number;

  /**
   * Shape canónico de error para esta fila, en el mismo formato que
   * `BulkRowError` (lo emite el `flattenBulkValidationErrors` y el catch
   * por fila del service). El frontend lo prefiere sobre `message` para
   * pintar columna / valor / sugerencia.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  row_error?: BulkRowError;
}

export class BulkCustomerUploadResultDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 10 })
  total_processed: number;

  @ApiProperty({ example: 8 })
  successful: number;

  @ApiProperty({ example: 2 })
  failed: number;

  @ApiPropertyOptional({
    example: 2,
    description: 'Ubicaciones agregadas (a clientes nuevos o existentes)',
  })
  locations_added?: number;

  @ApiPropertyOptional({
    example: 1,
    description: 'Filas con advertencia (p. ej. "Ubicación ya registrada")',
  })
  warnings?: number;

  @ApiProperty({ type: [BulkCustomerUploadItemResultDto] })
  results: BulkCustomerUploadItemResultDto[];

  /**
   * Errores agregados a nivel de LOTE (no atados a una sola fila), por
   * ejemplo "emails duplicados en el archivo" o "lote excede 1000". Mismo
   * shape que `BulkRowError` pero con `row: 0`.
   */
  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  batch_errors?: BulkRowError[];
}
