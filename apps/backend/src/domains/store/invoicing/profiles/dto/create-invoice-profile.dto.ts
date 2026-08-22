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
  INVOICE_PROFILE_NAME_MAX_LENGTH,
  INVOICE_PROFILE_OPERATION_TYPES,
  INVOICE_PROFILE_STATES,
} from './invoice-profile.constants';
import { normalizeProfileName } from './invoice-profile-name';

/** Mismo criterio que `CreateInvoiceDto`: un texto vacío es ausencia, no error. */
const blankToUndefined = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

export class CreateInvoiceProfileDto {
  /**
   * `@Transform(normalizeProfileName)` antes de `@MaxLength`, por dos razones
   * distintas que dan la misma respuesta.
   *
   * La primera es la cota: sin recortar, 150 caracteres más un espacio final
   * pasaban la validación y Postgres rechazaba el INSERT contra `VarChar(150)`
   * con un error de Prisma que el filtro global degrada a 500. La cota del DTO
   * tiene que medir exactamente lo que se va a guardar.
   *
   * La segunda es la unicidad: el nombre es único por tienda vía
   * `invoice_profiles_unique_name_per_store` sobre `(store_id, lower(name))`,
   * y ese índice no colapsa espacios. Sin normalizar, `"AIU  obras"` entra como
   * un segundo perfil junto a `"AIU obras"` y el selector del wizard ofrece dos
   * opciones que la persona lee iguales.
   */
  @Transform(normalizeProfileName)
  @IsString({ message: 'El nombre del perfil es obligatorio.' })
  @MinLength(1, { message: 'El nombre del perfil no puede estar vacío.' })
  @MaxLength(INVOICE_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${INVOICE_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name: string;

  @IsIn(INVOICE_PROFILE_OPERATION_TYPES, {
    message: `operation_type debe ser uno de los códigos DIAN de tipo de operación: ${INVOICE_PROFILE_OPERATION_TYPES.join(', ')}.`,
  })
  operation_type: string;

  @IsOptional()
  @Transform(blankToUndefined)
  @IsIn(INVOICE_PROFILE_STATES, {
    message: `state debe ser ${INVOICE_PROFILE_STATES.join(' o ')}.`,
  })
  state?: string;

  /**
   * Marca el perfil como predeterminado de su `operation_type` en la creación.
   *
   * El invariante «exactamente uno por (`store_id`, `operation_type`)» lo hace
   * cumplir un índice único PARCIAL en la base, así que crear un segundo
   * predeterminado no se cuela por acá: el servicio desmarca el anterior dentro
   * de la misma transacción.
   */
  @IsOptional()
  @IsBoolean({ message: 'is_default debe ser booleano.' })
  is_default?: boolean;

  /**
   * El snapshot de configuración de las 7 secciones.
   *
   * ## Por qué NO lleva `@ValidateNested`
   *
   * El `ValidationPipe` global corre con `forbidNonWhitelisted: true`, que al
   * entrar en un objeto anidado rechaza toda clave que su clase no declare. Las
   * siete secciones tienen decenas de campos opcionales y anidamiento variable
   * (`mapping_key_overrides` es un mapa de claves libres por diseño): declararlas
   * como clases obligaría a mantener dos definiciones de la misma forma —los
   * decoradores y el contrato compartido con el frontend— y a que divergieran.
   *
   * ## Qué lo protege entonces
   *
   * `@IsObject()` sólo garantiza que es un objeto; el contenido lo gobierna
   * `normalizeAndAssertProfileConfig`, que proyecta la entrada sobre la forma
   * conocida, reporta cada clave desconocida por su ruta y aplica las reglas
   * fiscales. Es la ÚNICA puerta hacia `invoice_profile_versions.config`, y
   * ningún camino del servicio persiste `dto.config` directamente.
   */
  @IsObject({ message: 'config debe ser el objeto de configuración del perfil.' })
  config: Record<string, unknown>;
}
