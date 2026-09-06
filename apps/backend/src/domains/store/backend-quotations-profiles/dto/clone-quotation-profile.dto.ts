import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { QUOTATION_PROFILE_NAME_MAX_LENGTH } from './quotation-profile.constants';
import { normalizeQuotationProfileName } from './quotation-profile-name';

/**
 * Clonar produce un perfil INDEPENDIENTE, no una versión del original:
 * `cloned_from_*` queda como procedencia para el historial, con
 * `ON DELETE SetNull`. Si el clon fuera una versión, editar el original
 * cambiaría con qué números cita el clon.
 */
export class CloneQuotationProfileDto {
  @Transform(normalizeQuotationProfileName)
  @IsString({ message: 'El nombre del nuevo perfil es obligatorio.' })
  @MinLength(1, { message: 'El nombre del nuevo perfil no puede estar vacío.' })
  @MaxLength(QUOTATION_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${QUOTATION_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name: string;

  /**
   * Versión de origen. Por omisión, la vigente. Nombrar una anterior es la
   * única forma de recuperar una configuración de la que se salió, porque
   * las versiones son inmutables y no hay «restaurar» que las reescriba.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'source_version debe ser un entero.' })
  @Min(1, { message: 'Las versiones empiezan en 1.' })
  source_version?: number;
}
