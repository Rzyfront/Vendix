import {
  IsArray,
  IsEmail,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { DOCUMENT_TYPE_CODES } from '../../../../common/constants/document-types';
import { DocumentNumberMatchesType } from '../../../../common/validators/document-number.validator';

/**
 * Error canónico para UNA fila del lote de carga masiva.
 *
 * Este shape es emitido por DOS lugares del backend:
 *  - El `ValidationPipe` scoped del controller (errores de DTO: emails mal
 *    formados, strings en lugar de números, etc.).
 *  - El catch por fila de `CustomersBulkService.uploadCustomers()` (errores
 *    de negocio: email duplicado, documento duplicado, etc.).
 *
 * Mantener el mismo shape permite que el frontend renderice una sola tabla
 * de errores sin tener que distinguir entre "falló la validación del DTO" y
 * "falló al guardar en BD".
 */
export interface BulkRowError {
  /** Índice 1-based de la fila dentro de la plantilla Excel (header = fila 1). */
  row: number;
  /** Encabezado de la columna legible para el operador (`"Correo"`, `"Documento"`, etc.). */
  column: string;
  /** Clave técnica del campo (`email`, `document_number`, etc.). */
  field: string;
  /** Valor que disparó el error, tal cual vino en la fila. */
  value: unknown;
  /** Motivo concreto del fallo, en español. */
  message: string;
  /**
   * Código estable de error. El frontend puede usarlo para colorear / filtrar
   * (`validation` | `duplicate_email` | `duplicate_document` | `conflict` |
   * `internal`, etc.).
   */
  code: string;
  /** Acción sugerida para corregir el error, en español. Vacío si no aplica. */
  suggestion?: string;
}

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

  @ApiPropertyOptional({ example: 3 })
  @IsNumber({}, { message: 'El número de fila debe ser numérico' })
  @IsOptional()
  row_number?: number;
}

export class BulkCustomerUploadDto {
  @ApiProperty({ type: [BulkCustomerItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkCustomerItemDto)
  customers: BulkCustomerItemDto[];
}

export class BulkCustomerUploadItemResultDto {
  @ApiPropertyOptional()
  customer?: any;

  @ApiProperty({ example: 'success' })
  status: 'success' | 'error';

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
