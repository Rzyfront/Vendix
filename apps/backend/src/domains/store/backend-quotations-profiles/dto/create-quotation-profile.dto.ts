import { Transform, TransformFnParams } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  QUOTATION_PROFILE_NAME_MAX_LENGTH,
  QUOTATION_PROFILE_STATES,
} from './quotation-profile.constants';
import { normalizeQuotationProfileName } from './quotation-profile-name';

/** Un texto vacío es ausencia, no error (mismo criterio que invoice). */
const blankToUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class CreateQuotationProfileDto {
  /**
   * `@Transform` antes de `@MaxLength`: la cota mide lo que se va a guardar
   * (sin recortar, 150 caracteres más un espacio final pasaban la validación
   * y Postgres rechazaba el INSERT con un 500), y la unicidad por tienda no
   * colapsa espacios (sin normalizar, `"Obra  norte"` duplicaría
   * `"Obra norte"` ante los ojos del usuario).
   */
  @Transform(normalizeQuotationProfileName)
  @IsString({ message: 'El nombre del perfil es obligatorio.' })
  @MinLength(1, { message: 'El nombre del perfil no puede estar vacío.' })
  @MaxLength(QUOTATION_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${QUOTATION_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(QUOTATION_PROFILE_STATES, {
    message: `state debe ser ${QUOTATION_PROFILE_STATES.join(' o ')}.`,
  })
  state?: string;

  /**
   * Marca el perfil como predeterminado de la tienda en la creación. El
   * invariante «uno por store» lo cumple el índice único PARCIAL
   * `quotation_profiles_store_default_uq`: el servicio desmarca el anterior
   * dentro de la misma transacción.
   */
  @IsOptional()
  @IsBoolean({ message: 'is_default debe ser booleano.' })
  is_default?: boolean;

  /**
   * Snapshot inicial de configuración. `@IsObject()` solo garantiza que es
   * un objeto; el contenido lo gobierna
   * `normalizeAndAssertQuotationProfileConfig`, ÚNICA puerta hacia
   * `quotation_profile_versions.config` (sin `@ValidateNested`: el pipe
   * global corre con `forbidNonWhitelisted` y dos definiciones de la misma
   * forma divergirían).
   */
  @IsObject({ message: 'config debe ser el objeto de configuración del perfil.' })
  config: Record<string, unknown>;
}
