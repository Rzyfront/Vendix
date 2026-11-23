import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { BULK_FILE_HASH_PATTERN } from '../bulk-upload-log.types';
import { BULK_JOB_TYPES } from '../bulk-upload-job.types';
import type { BulkJobType } from '../bulk-upload-job.types';

/** `GET store/bulk-uploads/jobs/active?upload_type=`. La tienda sale del contexto, nunca del query. */
export class QueryActiveBulkJobDto {
  @ApiProperty({ enum: BULK_JOB_TYPES })
  @IsIn(BULK_JOB_TYPES)
  upload_type: BulkJobType;
}

/**
 * Base de los cuerpos `POST …/bulk/jobs`: nombre y huella del archivo (vienen
 * del analyze) son obligatorios porque la fila del historial los exige.
 * Ningún DTO acepta `store_id`: la tienda sale del contexto.
 */
export class BulkJobFileDto {
  @ApiProperty({ description: 'Nombre original del archivo' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  file_name: string;

  @ApiProperty({ description: 'Huella devuelta por el analyze' })
  @Matches(BULK_FILE_HASH_PATTERN, {
    message: 'file_hash debe ser un SHA-256 en hexadecimal',
  })
  file_hash: string;
}
