import { ErrorCodes, VendixHttpException } from '@common/errors';

/**
 * PERFIL NO ENCONTRADO — un único constructor para las seis rutas por `:id`.
 *
 * Existe por dos razones, y ninguna es la deduplicación:
 *
 * 1. **El mensaje del catálogo no es un mensaje de usuario.** `devMessage`
 *    documenta la decisión de diseño para quien lee el código, y
 *    `VendixHttpException` lo usa como `message` cuando nadie pasa uno. Sin este
 *    helper, cada 404 de esta superficie devolvía al cliente el párrafo en
 *    inglés que explica *por qué* el aislamiento responde 404 — es decir, le
 *    explicaba al atacante el razonamiento de seguridad, en un idioma que el
 *    usuario del panel no lee.
 * 2. **La respuesta tiene que ser idéntica en los dos casos.** El id que no
 *    existe y el id de otra tienda deben producir la MISMA respuesta byte a
 *    byte: mismo código, mismo texto, mismos `details`. Cualquier diferencia
 *    —un `store_id` en `details`, un texto más específico— convierte el endpoint
 *    en un oráculo de enumeración: probando ids se aprende cuáles existen en
 *    otras tiendas. Centralizarlo es lo que garantiza que no divergan al
 *    editar una ruta y olvidar las otras cinco.
 *
 * `profile_id` sí viaja en `details` porque es el id que el propio cliente
 * acaba de pedir: no revela nada que no supiera.
 */
export function profileNotFound(profile_id: number): VendixHttpException {
  return new VendixHttpException(
    ErrorCodes.INVOICING_PROFILE_001,
    'El perfil de facturación no existe o no pertenece a esta tienda.',
    { profile_id },
  );
}
