import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { INVOICE_PROFILE_NAME_MAX_LENGTH } from './invoice-profile.constants';
import { normalizeProfileName } from './invoice-profile-name';

/**
 * Clonar produce un perfil INDEPENDIENTE (ADR-1), no una versión del original.
 *
 * `cloned_from_profile_id` y `cloned_from_version` quedan como procedencia para
 * el historial, con `ON DELETE SetNull`: borrar el origen no puede tocar al
 * clon. Si el clon fuera una versión, editar el original cambiaría lo que el
 * clon emite.
 */
export class CloneInvoiceProfileDto {
  @Transform(normalizeProfileName)
  @IsString({ message: 'El nombre del nuevo perfil es obligatorio.' })
  @MinLength(1, { message: 'El nombre del nuevo perfil no puede estar vacío.' })
  @MaxLength(INVOICE_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${INVOICE_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name: string;

  /**
   * Versión de origen. Por omisión, la vigente.
   *
   * Se puede nombrar una anterior a propósito: clonar «como estaba antes» es la
   * única forma de recuperar una configuración de la que se salió, porque las
   * versiones son inmutables y no hay «restaurar» que las reescriba.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'source_version debe ser un entero.' })
  @Min(1, { message: 'Las versiones empiezan en 1.' })
  source_version?: number;
}
