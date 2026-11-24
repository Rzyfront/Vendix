import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BULK_FILE_HASH_PATTERN } from '../../bulk-uploads/bulk-upload-log.types';
import { BulkCustomerItemDto } from './bulk-customer.dto';

/** Tope de filas por archivo de clientes. */
export const MAX_BULK_CUSTOMER_JOB_ROWS = 10000;

/**
 * `POST store/customers/bulk/jobs` (QUI-1009). Las filas ya vienen leídas del
 * Excel en el navegador: el servidor las guarda en S3 y el trabajo las lee.
 *
 * A diferencia de los demás tipos, la huella es opcional: la calcula el
 * navegador y, si no pudo (p. ej. sin `crypto.subtle`), el servidor usa la de
 * las filas recibidas en vez de rechazar la carga. Ningún campo acepta
 * `store_id`: la tienda sale del contexto.
 *
 * QUI-1047: aquí solo se valida la forma del lote. Las filas NO llevan
 * `@ValidateNested`: una fila inválida no rechaza el archivo entero; el
 * trabajo la valida (`validateBulkRow`, con `whitelist` +
 * `forbidNonWhitelisted`) y la marca como fallida con su fila y columna.
 */
export class BulkCustomersJobDto {
  @ApiProperty({ description: 'Nombre original del archivo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  file_name: string;

  @ApiPropertyOptional({
    description:
      'Huella del archivo calculada en el navegador; si falta, el servidor usa la de las filas',
  })
  @IsOptional()
  @Matches(BULK_FILE_HASH_PATTERN, {
    message: 'file_hash debe ser un SHA-256 en hexadecimal',
  })
  file_hash?: string;

  @ApiProperty({ type: [BulkCustomerItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_BULK_CUSTOMER_JOB_ROWS, {
    message: `El archivo admite máximo ${MAX_BULK_CUSTOMER_JOB_ROWS} clientes`,
  })
  @Type(() => BulkCustomerItemDto)
  customers: BulkCustomerItemDto[];
}
