/**
 * Espejo EXACTO de las constantes AIU del backend, en
 * `apps/backend/src/domains/store/invoicing/providers/dian-direct/xml/ubl-common.builder.ts`.
 *
 * Se copian en vez de reinventarse porque la cadena que la DIAN juzga es la que
 * escribe el backend en `cbc:Note`: si esta pantalla midiera una nota armada de
 * otra forma, el contador diría "cumple" y la emisión rechazaría igual. Cualquier
 * cambio allá tiene que replicarse acá.
 */

/**
 * Literal EXACTO con el que debe empezar el `cbc:Note` de la línea de
 * Administración en un documento AIU (Anexo Técnico 1.9, regla CAV03).
 *
 * La regla valida el PREFIJO, no el contenido. Una tilde, la mayúscula inicial
 * o los dos puntos de más convierten el documento en rechazable.
 */
export const DIAN_AIU_NOTE_PREFIX = 'Contrato de servicios AIU por concepto de:';

/** Longitudes que CAV03 exige para el nodo `cbc:Note` COMPLETO (prefijo incluido). */
export const DIAN_AIU_NOTE_MIN_LENGTH = 20;
export const DIAN_AIU_NOTE_MAX_LENGTH = 5000;

/**
 * Cota del campo que escribe el usuario, tal como la valida
 * `AiuSettingsDto.contract_object` (`@MaxLength(4900)`). Es menor que el máximo
 * de la nota porque el prefijo obligatorio ya ocupa parte del nodo.
 */
export const DIAN_AIU_CONTRACT_OBJECT_MAX_LENGTH = 4900;

/**
 * Compone la nota AIU a partir del objeto del contrato. Misma lógica que
 * `buildAiuNote` en el backend, incluido el `trim` y el espacio entre prefijo y
 * objeto.
 *
 * Devuelve `''` cuando no hay objeto: el prefijo solo mide 41 caracteres y
 * CAV03 pide 20 como mínimo, así que devolver el prefijo pelado haría pasar la
 * validación describiendo un contrato vacío.
 */
export function buildAiuNote(contract_object?: string | null): string {
  const object = (contract_object || '').trim();
  return object ? `${DIAN_AIU_NOTE_PREFIX} ${object}` : '';
}
