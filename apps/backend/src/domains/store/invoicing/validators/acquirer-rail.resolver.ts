import { Logger } from '@nestjs/common';
import { onlyDigits } from '@common/utils/nit.util';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { ErrorCodes } from '@common/errors/error-codes';
import {
  DIAN_FINAL_CONSUMER_DOCUMENT_NUMBER,
  DIAN_FINAL_CONSUMER_NAME,
  DIAN_FINAL_CONSUMER_TYPE_CODE,
} from './customer-fiscal-identity.validator';
import { resolveMissingAcquirerDocumentType } from '../utils/acquirer-identity.resolver';

const logger = new Logger('AcquirerRailResolver');

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
  /** Valor CRUDO (sin derivar) de `users.person_type` — opcional; no todo
   *  llamador lo tiene a mano. Alimenta la política de P1-B (ver
   *  `resolveMissingAcquirerDocumentType`). */
  person_type?: string | null;
  /** Sólo para trazabilidad (`logger.warn`) cuando se infiere el tipo. */
  customer_id?: number | string | null;
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
 * Decide el carril del adquiriente. Sin I/O — SIEMPRE hay una identidad
 * completa que devolver para `final_consumer`, porque ese carril es el
 * destino de todo lo que no alcanza a ser nominativo.
 *
 * YA NO es incondicionalmente libre de excepciones: un adquiriente nominativo
 * (número Y nombre reales) sin tipo de identificación declarado, con SEÑAL de
 * persona jurídica, LANZA en vez de inventar `'CC'`. Antes,
 * `(input.document_type ?? '').trim() || 'CC'` completaba en silencio y esta
 * identidad a medias se persistía en `invoices.customer_document_type` — de
 * ahí viajaba intacta hasta `DianDirectProvider.buildCustomerData`, que
 * repetía el mismo `|| 'CC'` y transmitía a la DIAN una Cédula de Ciudadanía
 * para un adquiriente cuyo documento real era un NIT (incidente Óptica
 * Panorama SAS / Pollo Árabe). Lanzar AQUÍ —antes de que
 * `InvoicingService.createFromOrder` numere el documento— es estrictamente
 * mejor que dejar que la emisión lo descubra con el consecutivo ya tomado.
 *
 * P1-B corrige el sobre-alcance de ese cierre: prod tiene 67 fichas antiguas
 * con número+nombre y `document_type` NULL (sólo 21 con forma de NIT). Sin
 * señal de riesgo (`resolveMissingAcquirerDocumentType`), se infiere `'CC'` y
 * se sigue — bloquear las 67 rompía ventas POS de clientes que llevan años
 * siendo persona natural.
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

  let document_type = (input.document_type ?? '').trim();
  if (!document_type) {
    const decision = resolveMissingAcquirerDocumentType({
      document_number,
      legal_name: input.legal_name,
      person_type: input.person_type,
    });

    if (decision.should_block) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_ACQUIRER_DOCUMENT_TYPE_REQUIRED,
        'No se puede emitir: el adquiriente tiene número de identificación y nombre pero no tiene tipo de documento (CC, NIT, CE, …). Complétalo en la ficha del cliente antes de facturar, o emite la venta como Consumidor Final si el comprador no se identifica.',
        { document_number, has_name: true },
      );
    }

    document_type = decision.inferred_document_type ?? 'CC';
    logger.warn(
      `Adquiriente sin document_type declarado (customer_id=${input.customer_id ?? 'n/a'}, documento=${document_number}): se infiere '${document_type}' por política (sin señal de persona jurídica).`,
    );
  }

  return {
    rail: 'nominative_minimal',
    identity: {
      document_type,
      document_number,
      name,
    },
  };
}
