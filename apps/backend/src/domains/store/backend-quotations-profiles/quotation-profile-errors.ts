import { ErrorCodes, VendixHttpException } from '@common/errors';

/**
 * PERFIL NO ENCONTRADO — un único constructor para todas las rutas por `:id`.
 *
 * El id que no existe y el id de otra tienda producen la MISMA respuesta: el
 * servicio busca con el cliente scopeado, así que el perfil de otra tienda
 * simplemente no aparece. Distinguirlos convertiría el endpoint en un oráculo
 * de enumeración (barrer ids para inventariar perfiles ajenos).
 *
 * `profile_id` sí viaja en `details` porque es el id que el propio cliente
 * acaba de pedir: no revela nada que no supiera.
 */
export function quotationProfileNotFound(
  profile_id: number,
): VendixHttpException {
  return new VendixHttpException(
    ErrorCodes.QPROFILE_NOT_FOUND_001,
    'El perfil de cotización no existe o no pertenece a esta tienda.',
    { profile_id },
  );
}

/**
 * ERR-04 — el perfil existe pero es de OTRA tienda. Se usa cuando el id llega
 * como REFERENCIA (p. ej. `quotations.profile_id` en C.1), donde el llamador
 * ya sabe que la fila existe y lo que está mal es el tenant. Mensaje para el
 * selector: solo ofrece activos propios.
 */
export function quotationProfileInvalidForStore(
  profile_id: number,
): VendixHttpException {
  return new VendixHttpException(
    ErrorCodes.QPROFILE_STORE_001,
    'Perfil no válido para tu tienda.',
    { profile_id },
  );
}
