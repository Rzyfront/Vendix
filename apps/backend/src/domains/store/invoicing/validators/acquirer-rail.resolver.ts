import { onlyDigits } from '@common/utils/nit.util';
import {
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
} from './customer-fiscal-identity.validator';

/**
 * QUÉ ADQUIRIENTE SE PERSISTE AL CREAR LA FACTURA — ANTES de numerar.
 *
 * ## El defecto que cierra
 *
 * `InvoicingService.createFromOrder` decidía `customer_name` y `customer_tax_id`
 * por separado, cada uno con su propio fallback: el nombre caía a `'Consumidor
 * Final'` cuando no había `order.users`, y el número caía a `undefined` cuando
 * ninguna fuente lo traía. El resultado es una factura con NOMBRE de consumidor
 * final y SIN el número oficial que lo acompaña — una identidad partida a la
 * mitad que ningún emisor sabe leer.
 *
 * `dian-direct.provider.ts` (`buildCustomerData`) juzga al adquiriente por su
 * PROPIA regla, separada de esta: `declares_final_consumer` exige el número
 * oficial exacto, y `declares_nothing` exige que NADA venga declarado. Un nombre
 * no vacío sin número no es ninguna de las dos, así que cae al carril nominativo
 * y ESE exige número — lanzando después de que `generateNextNumber` ya reservó
 * el consecutivo. Ver el histórico de huecos de numeración en ventas anónimas.
 *
 * Esta función existe para que exista UN solo lugar donde se decide qué CARRIL
 * toma el documento, de modo que lo que se persiste en `invoices` ya viene
 * completo y coherente con lo que el proveedor va a exigir — nunca a medias.
 *
 * ## Por qué son exactamente DOS carriles, no tres
 *
 * La DIAN sólo reconoce dos formas de declarar al adquiriente de una venta:
 *
 *   - **Consumidor Final** (`final_consumer`) — el número oficial
 *     `222222222222`, sin excepción. Es el valor correcto para el mostrador
 *     anónimo, y CUALQUIER identidad incompleta se reconduce aquí: es preferible
 *     un documento que declara honestamente "no sé quién compró" a uno que
 *     inventa la mitad de un cliente.
 *   - **Nominativo mínimo** (`nominative_minimal`) — número Y nombre reales,
 *     los dos. Ninguno solo basta: un número sin nombre es un documento que
 *     identifica una cédula sin decir de quién es, y un nombre sin número es
 *     exactamente el bug que este archivo cierra.
 *
 * "Nombre sin número" NO es un tercer estado alcanzable porque la regla de
 * entrada a `nominative_minimal` exige AMBOS a la vez (`has_number &&
 * has_name`). Si sólo uno de los dos llegó, la función cae al primer carril. No
 * hay una tercera rama que darle a esa combinación: dársela sería reintroducir
 * el defecto con otro nombre.
 *
 * ## Por qué el número `222222222222` con nombre real NO es nominativo
 *
 * Ese número es la firma oficial de "no identificado". Un documento que lo trae
 * JUNTO con un nombre real está declarando dos cosas contradictorias — "no sé
 * quién es" y "se llama Fulano" — y `customer-fiscal-identity.validator.ts` ya
 * trata esa combinación como aviso (`FINAL_CONSUMER_IS_IDENTIFIED`), no como una
 * factura nominativa válida. Este resolver es coherente con esa regla: el
 * número manda, así que el sentinel siempre resuelve a `final_consumer` sin
 * importar qué nombre lo acompañe.
 *
 * ## Qué NO decide esta función
 *
 * No decide direcciones, correos ni responsabilidades fiscales — el carril
 * final_consumer las tiene fijas (ninguna) porque el consumidor final no las
 * declara, y el carril nominativo mínimo las deja para que el resto del flujo
 * (`CustomerFiscalIdentityValidator`, `dian-direct.provider.ts`) las complete o
 * las bloquee con su propio criterio. Esta función sólo resuelve identidad:
 * tipo, número y nombre.
 */

export type AcquirerRail = 'final_consumer' | 'nominative_minimal';

/** Lo que el llamador puede aportar sobre el adquiriente, de cualquier fuente. */
export interface AcquirerRailInput {
  document_type?: string | null;
  document_number?: string | null;
  /** Razón social — sólo aplica a personas jurídicas. */
  legal_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** Identidad YA resuelta, lista para persistir en `invoices.customer_*`. */
export interface AcquirerRailIdentity {
  /**
   * Literal o código DIAN, según el carril: `nominative_minimal` persiste el
   * literal declarado (o `'CC'` derivado); `final_consumer` persiste el código
   * DIAN oficial (`DIAN_FINAL_CONSUMER_TYPE_CODE`, `'13'`). La columna
   * `invoices.customer_document_type` acepta ambos vocabularios — ver su
   * comentario en `schema.prisma` — así que no hace falta traducir aquí.
   */
  document_type: string;
  document_number: string;
  name: string;
}

export interface AcquirerRailResolution {
  rail: AcquirerRail;
  identity: AcquirerRailIdentity;
}

/** Nombre nominativo válido: razón social, o nombre Y apellido — nunca uno solo. */
function resolveDeclaredName(input: AcquirerRailInput): string {
  const legal_name = (input.legal_name ?? '').trim();
  if (legal_name) return legal_name;

  const first_name = (input.first_name ?? '').trim();
  const last_name = (input.last_name ?? '').trim();
  return first_name && last_name ? `${first_name} ${last_name}`.trim() : '';
}

/**
 * Congelado a propósito. Este módulo vive en un proceso NestJS de larga vida y
 * la constante se devuelve POR REFERENCIA: sin `freeze`, un llamador que
 * mutara `resolution.identity` corrompería la identidad canónica para todas
 * las facturas siguientes del proceso. Una función que se anuncia pura no
 * puede entregar estado compartido mutable.
 */
const FINAL_CONSUMER_IDENTITY: AcquirerRailIdentity = Object.freeze({
  document_type: DIAN_FINAL_CONSUMER_TYPE_CODE,
  document_number: DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  name: DIAN_FINAL_CONSUMER_NAME,
});

/**
 * Decide el carril del adquiriente. Función pura: sin I/O, sin excepciones —
 * SIEMPRE hay una identidad completa que devolver, porque `final_consumer` es
 * el destino de todo lo que no alcanza a ser nominativo.
 */
export function resolveAcquirerRail(
  input: AcquirerRailInput,
): AcquirerRailResolution {
  const document_number = (input.document_number ?? '').trim();
  const document_number_digits = onlyDigits(document_number);
  const name = resolveDeclaredName(input);

  const is_final_consumer_sentinel =
    Boolean(document_number_digits) &&
    document_number_digits === DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER;

  const is_nominative =
    Boolean(document_number) && Boolean(name) && !is_final_consumer_sentinel;

  if (!is_nominative) {
    return { rail: 'final_consumer', identity: FINAL_CONSUMER_IDENTITY };
  }

  return {
    rail: 'nominative_minimal',
    identity: {
      // Réplica exacta de `dian-direct.provider.ts:2394` — una cédula es el
      // documento por defecto cuando el tipo no se declaró.
      document_type: (input.document_type ?? '').trim() || 'CC',
      document_number,
      name,
    },
  };
}
