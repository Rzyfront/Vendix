import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  BULK_FILE_HASH_PATTERN,
  BULK_UPLOAD_TYPES,
  CLIENT_REGISTERED_UPLOAD_TYPES,
} from '../bulk-upload-log.types';
import type { BulkUploadType } from '../bulk-upload-log.types';

/**
 * Ningún DTO de este módulo acepta `store_id`: la tienda sale SIEMPRE del
 * contexto de la petición. La whitelist global rechaza el campo si llega.
 */

/** Máximo de filas que admite cualquier carga (10.000) con holgura. */
const MAX_ROWS = 100_000;

export class QueryBulkUploadLogsDto {
  @ApiPropertyOptional({ enum: BULK_UPLOAD_TYPES })
  @IsOptional()
  @IsIn(BULK_UPLOAD_TYPES)
  upload_type?: BulkUploadType;

  @ApiPropertyOptional({ description: 'Fecha local de la tienda (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({ description: 'Fecha local de la tienda (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class CheckBulkUploadDuplicateDto {
  @ApiProperty({ enum: BULK_UPLOAD_TYPES })
  @IsIn(BULK_UPLOAD_TYPES)
  upload_type: BulkUploadType;

  @ApiProperty({ description: 'SHA-256 (hex) del contenido normalizado' })
  @Matches(BULK_FILE_HASH_PATTERN, {
    message: 'file_hash debe ser un SHA-256 en hexadecimal',
  })
  file_hash: string;
}

/**
 * Registro de una carga que el servidor no ve (el navegador lee el archivo).
 * Solo para `CLIENT_REGISTERED_UPLOAD_TYPES`.
 */
export class RegisterBulkUploadDto {
  @ApiProperty({ enum: CLIENT_REGISTERED_UPLOAD_TYPES })
  @IsIn(CLIENT_REGISTERED_UPLOAD_TYPES)
  upload_type: BulkUploadType;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  file_name: string;

  @ApiProperty()
  @Matches(BULK_FILE_HASH_PATTERN, {
    message: 'file_hash debe ser un SHA-256 en hexadecimal',
  })
  file_hash: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_ROWS)
  total_rows: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_ROWS)
  successful_rows: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_ROWS)
  failed_rows: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  @Max(MAX_ROWS)
  skipped_rows: number;

  @ApiPropertyOptional({
    description:
      'true cuando un paso accesorio falló (compras: pago o recepción); la carga queda «parcial».',
  })
  @IsOptional()
  @IsBoolean()
  accessory_step_failed?: boolean;

  @ApiPropertyOptional({ description: 'Resultado, p. ej. el número de la OC' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  result_reference?: string;
}

/**
 * Campos opcionales que el commit de una carga trae del analyze para que el
 * registro conozca el archivo (el commit no vuelve a recibirlo).
 */
export class BulkUploadFileRefDto {
  @ApiPropertyOptional({ description: 'Nombre original del archivo' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  file_name?: string;

  @ApiPropertyOptional({ description: 'Huella devuelta por el analyze' })
  @IsOptional()
  @Matches(BULK_FILE_HASH_PATTERN, {
    message: 'file_hash debe ser un SHA-256 en hexadecimal',
  })
  file_hash?: string;
}
