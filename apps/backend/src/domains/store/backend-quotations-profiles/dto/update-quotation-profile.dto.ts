import { Transform } from 'class-transformer';
import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import { QUOTATION_PROFILE_NAME_MAX_LENGTH } from './quotation-profile.constants';
import { normalizeQuotationProfileName } from './quotation-profile-name';

/**
 * Edición de un perfil.
 *
 * NO incluye `is_default` ni `state` a propósito: cada uno tiene su ruta
 * (`POST :id/set-default`, `POST :id/activate|deactivate`) porque el
 * `PermissionsGuard` autoriza por `(path, method)` además de por nombre —dos
 * operaciones que deben autorizarse distinto no pueden compartir ruta y
 * verbo— y porque solo esas vías invalidan/registran lo suyo sin divergir.
 */
export class UpdateQuotationProfileDto {
  @IsOptional()
  @Transform(normalizeQuotationProfileName)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil no puede estar vacío.' })
  @MaxLength(QUOTATION_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${QUOTATION_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name?: string;

  /**
   * Reemplazo COMPLETO del snapshot, nunca un parche: fusionar la
   * configuración vieja con la nueva produciría una TERCERA que nadie
   * escribió. Enviar el árbol completo hace que la validación mire lo mismo
   * que se va a guardar.
   */
  @IsOptional()
  @IsObject({ message: 'config debe ser el objeto de configuración del perfil.' })
  config?: Record<string, unknown>;
}
