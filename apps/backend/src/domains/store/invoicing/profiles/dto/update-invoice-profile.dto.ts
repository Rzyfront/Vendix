import { Transform } from 'class-transformer';
import {
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
} from './invoice-profile.constants';
import { normalizeProfileName } from './invoice-profile-name';

/**
 * Edición de un perfil.
 *
 * NO extiende `PartialType(CreateInvoiceProfileDto)` a propósito: `is_default`
 * no se puede cambiar por acá. El predeterminado tiene su propia ruta
 * (`POST :id/set-default`) porque el `PermissionsGuard` autoriza por
 * `(path, method)` —una fila de permiso ES un otorgamiento, no documentación— y
 * dos operaciones que deben autorizarse distinto no pueden compartir ruta y
 * verbo. Con `is_default` acá, cualquiera con `invoicing:profiles:write`
 * cambiaría el predeterminado sin tener `invoicing:profiles:set_default`.
 */
export class UpdateInvoiceProfileDto {
  @IsOptional()
  @Transform(normalizeProfileName)
  @IsString()
  @MinLength(1, { message: 'El nombre del perfil no puede estar vacío.' })
  @MaxLength(INVOICE_PROFILE_NAME_MAX_LENGTH, {
    message: `El nombre del perfil admite hasta ${INVOICE_PROFILE_NAME_MAX_LENGTH} caracteres.`,
  })
  name?: string;

  /**
   * Cambiar el tipo de operación es legítimo y NO reescribe el pasado: las
   * facturas ya timbradas apuntan a la versión con la que se emitieron. Lo que
   * sí obliga es a revalidar la configuración contra el tipo NUEVO — un perfil
   * que deja de ser `'09'` no puede conservar su sección AIU
   * (`AIU_SECTION_NOT_APPLICABLE`), y uno que empieza a serlo tiene que traerla
   * (`AIU_SECTION_REQUIRED`).
   */
  @IsOptional()
  @IsIn(INVOICE_PROFILE_OPERATION_TYPES, {
    message: `operation_type debe ser uno de los códigos DIAN de tipo de operación: ${INVOICE_PROFILE_OPERATION_TYPES.join(', ')}.`,
  })
  operation_type?: string;

  /**
   * `state` NO está en este DTO — igual que `is_default`, y por la misma razón
   * de fondo: cada uno tiene su ruta.
   *
   * La primera versión sí lo aceptaba, con el argumento de que las dos vías
   * comparten el permiso `write` y por tanto ninguna abre lo que la otra cierra.
   * Eso es cierto para la autorización y falso para todo lo demás. Dos caminos
   * hacia el mismo hecho se separan en cuanto uno de los dos crece: la
   * invalidación de la caché del catálogo (C.5) y la fila de auditoría (C.7)
   * cuelgan de `activate`/`deactivate`, y un `PATCH` que cambiara el estado por
   * su cuenta dejaría el catálogo sirviendo un perfil retirado y la acción sin
   * registrar. Que hoy funcione no es una defensa: la próxima línea que se
   * añada a una de las dos vías es la que produce la divergencia.
   *
   * Cambiar el estado: `POST :id/activate` o `POST :id/deactivate`.
   */

  /**
   * Reemplazo COMPLETO del snapshot, nunca un parche.
   *
   * Un parche exigiría fusionar la configuración vieja con la nueva, y la fusión
   * de dos configuraciones fiscales produce una TERCERA que nadie escribió: si
   * el cliente cambia el régimen a `decreto_1372_1992` y no toca la matriz de
   * impuestos, la fusión conservaría la matriz del 462-1 y el resultado sería
   * exactamente la contradicción que `TAX_MATRIX_CONTRADICTS_REGIME` existe para
   * impedir. Enviar el árbol completo hace que la validación mire lo mismo que
   * se va a guardar.
   */
  @IsOptional()
  @IsObject({ message: 'config debe ser el objeto de configuración del perfil.' })
  config?: Record<string, unknown>;
}
