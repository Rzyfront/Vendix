import {
  DianAddressFields,
  UblCommonBuilder,
} from './xml/ubl-common.builder';
import { DianAcquirerAddressSource } from './interfaces/dian-config.interface';

/**
 * CASCADA DE RESPALDO DE LA DIRECCIÓN DEL ADQUIRIENTE.
 *
 * ## El problema que resuelve
 *
 * Un documento electrónico declara DÓNDE ocurrió la operación. Cuando el
 * cliente no tiene dirección fiscal hay exactamente dos maneras de fallar, y
 * las dos cuestan dinero:
 *
 *  1. **Inventar.** Rellenar `Bogotá / 11001 / 110111` produce un documento
 *     ACEPTADO que afirma un municipio que nadie verificó. No se corrige: se
 *     anula con nota crédito y se reemite, gastando dos consecutivos.
 *  2. **Encallar.** Bloquear la emisión porque falta un dato que el negocio
 *     conoce por otra vía —el cliente sí tiene dirección de envío, o la venta
 *     ocurrió en el mostrador de la tienda— deja al comerciante sin poder
 *     facturar por un vacío que el sistema podía llenar con un dato REAL.
 *
 * La salida no es elegir entre las dos: es agotar los domicilios reales que el
 * sistema ya conoce antes de rendirse, y DECIR cuál se usó.
 *
 * ## El orden y por qué es ese
 *
 * ```
 *   1. fiscal   — dirección de facturación del cliente (`billing` / `legal`)
 *   2. shipping — cualquier otra dirección del cliente (envío, casa, trabajo…)
 *   3. store    — dirección fiscal de la tienda/organización que emite
 * ```
 *
 * Los tres son domicilios REALES tomados de la base de datos; ninguno es un
 * literal escrito en el código. El tercero es además el más defendible de los
 * respaldos: en una venta de mostrador la operación ocurrió, literalmente, en
 * el municipio del emisor.
 *
 * ## Por qué la cascada es OBSERVABLE
 *
 * `resolveAcquirerAddress` devuelve `source` junto con la dirección. Que el
 * respaldo fuera SILENCIOSO es lo que produjo el defecto original: nadie sabía
 * que el documento estaba declarando Bogotá hasta que la DIAN cruzó los
 * municipios. Un respaldo que se anuncia es una decisión; uno que no se anuncia
 * es una suposición disfrazada de dato.
 *
 * ## Qué NO decide este módulo
 *
 * No decide si una dirección es utilizable: eso lo contesta
 * `UblCommonBuilder.canEmitAddress`, que delega en el mismo resolvedor de
 * municipio que usa la emisión. Una segunda definición de «dirección válida»
 * escrita acá se desincronizaría del emisor, y la forma de desincronizarse
 * sería la peor: esta cascada eligiendo un candidato que el builder rechaza
 * después, ya dentro del camino que gasta el consecutivo.
 */

/**
 * De dónde salió la dirección que el documento declara para el adquiriente.
 *
 * Viaja hasta `ProviderResponse.provider_data.acquirer_address_source` para que
 * la pantalla de confirmación pueda decírselo al usuario ANTES de que el
 * documento sea irreversible. El tipo se DECLARA en
 * `interfaces/dian-config.interface.ts` (ver la nota allí sobre el ciclo de
 * importación) y se re-exporta acá, que es donde vive su política.
 */
export { DianAcquirerAddressSource };

/**
 * Una dirección candidata tal como llega de la base: los nombres de columna de
 * `addresses` ya normalizados a los del builder, más el `type` de la fila.
 *
 * `type` es lo único que separa el escalón 1 del 2 de la cascada. Cuando llega
 * ausente —un llamador que compuso la dirección a mano en el DTO, sin fila
 * detrás— se clasifica como `fiscal`: quien la escribió la declaró PARA ESTE
 * documento, que es exactamente lo que significa una dirección de facturación.
 */
export interface AcquirerAddressCandidate extends DianAddressFields {
  /** Valor de `addresses.type` (`billing`, `shipping`, `home`…). */
  type?: string | null;
}

/** Resultado de la cascada: la dirección elegida y de qué escalón salió. */
export interface ResolvedAcquirerAddress {
  address: DianAddressFields;
  source: DianAcquirerAddressSource;
}

/**
 * Tipos de `address_type_enum` que SON la dirección fiscal de una parte.
 *
 * Es una lista corta y cerrada a propósito. `headquarters` no está: la sede
 * principal de una empresa es un hecho operativo, no la dirección que su RUT
 * declara, y confundirlos es cómo se llega a facturar a la bodega.
 */
const FISCAL_ADDRESS_TYPES: ReadonlySet<string> = new Set(['billing', 'legal']);

/**
 * Escalón de la cascada al que pertenece una fila de `addresses`.
 *
 * Todo lo que no es explícitamente fiscal cuenta como `shipping`, incluidas
 * `home`, `work` y `residential`: son domicilios reales del cliente y por tanto
 * mejores que el respaldo de la tienda, pero no son lo que declaró como
 * dirección de facturación, y el reporte no debe decir que lo son.
 */
export function classifyAcquirerAddressType(
  type: string | null | undefined,
): 'fiscal' | 'shipping' {
  const normalized = (type ?? '').trim().toLowerCase();
  if (!normalized) return 'fiscal';
  return FISCAL_ADDRESS_TYPES.has(normalized) ? 'fiscal' : 'shipping';
}

/**
 * Aplica la cascada sobre las direcciones que el llamador pudo reunir.
 *
 * @param candidates direcciones DEL CLIENTE, en el orden en que la base las
 *   devolvió. El orden interno no manda: primero se agotan todas las fiscales,
 *   después todas las de envío. Que la principal del cliente sea una de envío
 *   no debe ganarle a una fiscal que existe.
 * @param store_address dirección fiscal del emisor, ya normalizada. `null`
 *   cuando el emisor tampoco la tiene — caso en el que la cascada se queda sin
 *   escalones y devuelve `null` para que el llamador lance el error accionable.
 *
 * @returns la dirección elegida con su origen, o `null` si NINGÚN candidato es
 *   emitible. Nunca devuelve una dirección fabricada: `null` significa «no lo
 *   sé», y el llamador debe decirlo en voz alta, no rellenarlo.
 */
export function resolveAcquirerAddress(params: {
  candidates: AcquirerAddressCandidate[];
  store_address?: DianAddressFields | null;
}): ResolvedAcquirerAddress | null {
  const usable = params.candidates.filter(
    (candidate) =>
      hasAnyAddressData(candidate) &&
      UblCommonBuilder.canEmitAddress(candidate, 'adquiriente'),
  );

  const fiscal = usable.find(
    (candidate) => classifyAcquirerAddressType(candidate.type) === 'fiscal',
  );
  if (fiscal) return { address: stripType(fiscal), source: 'fiscal' };

  const shipping = usable[0];
  if (shipping) return { address: stripType(shipping), source: 'shipping' };

  const store = params.store_address;
  // El emisor se prueba con su PROPIO rol. Un emisor tiene que estar en
  // Colombia y con municipio Divipola (FAJ09, FAJ16); si su dirección no
  // aguanta esa prueba no puede ser el respaldo de nadie, y el llamador debe
  // mandar al usuario a configurarla en vez de emitir con ella.
  if (store && hasAnyAddressData(store) && UblCommonBuilder.canEmitAddress(store, 'emisor')) {
    return { address: store, source: 'store' };
  }

  return null;
}

/**
 * ¿La fila trae ALGO además del país?
 *
 * Una fila con sólo `country_code: 'CO'` pasa `canEmitAddress` en el rol de
 * adquiriente sólo si además resuelve municipio; sin municipio lanza. Pero una
 * fila totalmente vacía con país extranjero pasaría —el resolvedor devuelve
 * `null` sin lanzar para el adquiriente extranjero—, y elegirla haría que la
 * cascada se detuviera en una dirección que no dice nada. Se descarta acá para
 * que el escalón siguiente tenga su turno.
 */
function hasAnyAddressData(address: AcquirerAddressCandidate): boolean {
  return Boolean(
    (address.address_line || '').trim() ||
      (address.city_code || '').trim() ||
      (address.city_name || '').trim(),
  );
}

/** Devuelve la dirección sin el `type`, que es metadato de la cascada y no del XML. */
function stripType(candidate: AcquirerAddressCandidate): DianAddressFields {
  const { type: _type, ...address } = candidate;
  return address;
}
