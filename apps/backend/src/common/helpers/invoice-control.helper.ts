import { DianInvoiceControl } from '../../domains/store/invoicing/providers/dian-direct/interfaces/dian-config.interface';
import { localDateString } from '../utils/store-timezone.util';

/**
 * RESOLVEDOR ÚNICO DEL BLOQUE `sts:InvoiceControl`.
 *
 * POR QUÉ EXISTE
 *
 * El bloque de autorización de numeración lo construía solo la ruta de
 * habilitación (`dian-test.service.ts`). La ruta de emisión real no lo construía
 * ni podía: `ProviderInvoiceData` no declaraba prefijo ni rango, así que ningún
 * llamador tenía dónde ponerlo. El resultado no era un bloque ausente sino un
 * bloque VACÍO — `ubl-common.builder.ts` emite `control?.invoice_authorization ?? ''`
 * y omite `sts:Prefix` cuando no hay prefijo—, y sin `sts:Prefix` desaparece el
 * lado derecho de FAB10a, que compara
 *
 *   sts:AuthorizedInvoices/sts:Prefix
 *     == cac:PartyLegalEntity/cac:CorporateRegistrationScheme/cbc:ID
 *
 * En cascada la DIAN no resuelve el punto de facturación, ni la autorización
 * (FAD05e), ni el software habilitado para ella (FAB24a, FAB27b). Y en la vía
 * asincrónica el efecto es peor que un rechazo: devuelve ZipKey, no clasifica el
 * lote, el portal queda en «Recibidos 0» y `GetStatus` responde código 66 sobre
 * un CUFE que ella misma validó por la vía sincrónica.
 *
 * Tener dos implementaciones era la causa raíz: el set de pruebas y la emisión
 * real no compartían contrato fiscal, así que uno podía corregirse sin el otro —
 * y es exactamente lo que pasó. Este archivo es el único punto donde el bloque se
 * construye, para que esa divergencia no pueda volver a existir. Es el mismo
 * criterio que `fiscal-identity.helper.ts` aplica al NIT y a la razón social.
 *
 * POR QUÉ ES ESTRICTO Y NO TIENE VARIANTE PERMISIVA
 *
 * `fiscal-identity.helper.ts` expone un resolvedor estricto y otro permisivo,
 * porque la identidad fiscal se LEE en pantallas donde el comerciante todavía la
 * está completando. El bloque de control no tiene superficie de lectura: solo se
 * usa al construir un documento que se firma y se transmite. Un bloque vacío no
 * es un dato incompleto que alguien pueda ir a completar — es una declaración
 * falsa ante la DIAN que además quema un consecutivo autorizado irrecuperable.
 * Fallar aquí, en local y con nombre propio, es estrictamente mejor que fallar
 * allá con un consecutivo gastado.
 */

/**
 * Forma mínima que el resolvedor necesita de una fila `invoice_resolutions`.
 *
 * Se declara estructuralmente en vez de importar el tipo de Prisma para que el
 * helper sea probable sin base de datos: la fila real de Prisma satisface esta
 * forma y se pasa tal cual.
 */
export interface InvoiceControlSource {
  resolution_number: string | null;
  prefix: string | null;
  range_from: number;
  range_to: number;
  valid_from: Date;
  valid_to: Date;
  is_active: boolean;
}

/** Contexto para el mensaje de error. No participa en el valor resuelto. */
export interface InvoiceControlContext {
  /** Id de la resolución, si se conoce. Solo para diagnosticar. */
  resolution_id?: number;
  /** Tipo de documento que se está emitiendo. Solo para diagnosticar. */
  document_type?: string;
}

function describe(ctx?: InvoiceControlContext): string {
  const parts: string[] = [];
  if (ctx?.resolution_id !== undefined)
    parts.push(`resolución ${ctx.resolution_id}`);
  if (ctx?.document_type) parts.push(`documento ${ctx.document_type}`);
  return parts.length ? ` (${parts.join(', ')})` : '';
}

/**
 * Construye `DianInvoiceControl` desde la resolución de numeración.
 *
 * LAS DOS FECHAS DEL PERÍODO SON FECHA-SÓLO, NO INSTANTES — y por eso se
 * formatean en UTC y NO en la zona del emisor.
 *
 * `valid_from` y `valid_to` guardan una fecha civil sin hora: Postgres las
 * almacena como medianoche UTC (`2019-01-19T00:00:00.000Z`). Convertir eso a
 * America/Bogota (UTC-5) da las 19:00 del día ANTERIOR, así que
 * `localDateString(valid_from, 'America/Bogota')` devolvía `2019-01-18` para una
 * resolución que la DIAN tiene registrada desde el `2019-01-19`. Medido en
 * producción, y es exactamente lo que la DIAN rechazaba:
 *
 *   FAB07b  «Fecha inicial del rango de numeración informado no corresponde a la
 *            fecha inicial de los rangos vigente para el contribuyente»
 *   FAB08b  igual con la fecha final
 *
 * El razonamiento que había aquí —derivar en la zona del emisor porque
 * `toISOString()` desplaza un día— es correcto para un INSTANTE, como la fecha y
 * hora de emisión del documento. Aplicado a una columna fecha-sólo hace justo el
 * daño que pretende evitar: le mete un desplazamiento de zona a un valor que no
 * tiene hora que desplazar.
 *
 * Regla: instante → zona del emisor. Fecha-sólo → UTC, tal como se guardó.
 *
 * @param resolution Fila de `invoice_resolutions` de la que cuelga la numeración.
 * @param timezone   Zona del emisor (`resolveStoreTimezone`, o el default).
 * @param now        Instante de referencia para la vigencia. Inyectable para test.
 * @throws Error si la resolución falta, está inactiva, le faltan campos
 *   obligatorios, su rango es inválido, o `now` cae fuera de su vigencia.
 */
export function resolveInvoiceControl(
  resolution: InvoiceControlSource | null | undefined,
  timezone: string,
  now: Date = new Date(),
  ctx?: InvoiceControlContext,
): DianInvoiceControl {
  const where = describe(ctx);

  if (!resolution) {
    throw new Error(
      `No hay resolución de numeración para construir sts:InvoiceControl${where}. ` +
        'La DIAN rechaza un documento cuyo bloque de autorización va vacío, y el ' +
        'consecutivo gastado no se recupera.',
    );
  }

  if (!resolution.is_active) {
    throw new Error(
      `La resolución de numeración está inactiva${where}. No se emite bajo una ` +
        'resolución desactivada: la DIAN numera por (NIT emisor, resolución) y ' +
        'declararla sería afirmar una autorización que no está en uso.',
    );
  }

  const invoice_authorization = resolution.resolution_number?.trim();
  if (!invoice_authorization) {
    throw new Error(
      `La resolución no tiene número de autorización${where}. Es el valor de ` +
        'sts:InvoiceAuthorization, que la DIAN confronta contra la autorización ' +
        'del punto de facturación.',
    );
  }

  const prefix = resolution.prefix?.trim();
  if (!prefix) {
    throw new Error(
      `La resolución no tiene prefijo${where}. Sin prefijo desaparecen ` +
        'sts:AuthorizedInvoices/sts:Prefix y cac:CorporateRegistrationScheme, y ' +
        'con ellos el lado derecho de la comparación FAB10a: la DIAN no resuelve ' +
        'el punto de facturación y en cascada rechaza por FAD05e, FAB24a y FAB27b.',
    );
  }

  if (
    !Number.isInteger(resolution.range_from) ||
    !Number.isInteger(resolution.range_to) ||
    resolution.range_from <= 0 ||
    resolution.range_to < resolution.range_from
  ) {
    throw new Error(
      `El rango autorizado de la resolución es inválido${where}: ` +
        `${resolution.range_from}..${resolution.range_to}. sts:From y sts:To ` +
        'delimitan la numeración que la DIAN autorizó.',
    );
  }

  // VIGENCIA. Se comprueba aquí y no se delega a la DIAN porque delegarla cuesta
  // un consecutivo: el documento saldría con un período de autorización expirado,
  // la DIAN lo rechazaría, y el número ya estaría gastado. Fallar en local no
  // gasta nada.
  if (now < resolution.valid_from || now > resolution.valid_to) {
    throw new Error(
      `La resolución no está vigente${where}: su período va de ` +
        `${localDateString(resolution.valid_from, 'UTC')} a ` +
        `${localDateString(resolution.valid_to, 'UTC')}. No se emite fuera del ` +
        'período que la DIAN autorizó.',
    );
  }

  return {
    invoice_authorization,
    // UTC, no `timezone`: ver la nota de fecha-sólo en la cabecera del archivo.
    authorization_start_date: localDateString(resolution.valid_from, 'UTC'),
    authorization_end_date: localDateString(resolution.valid_to, 'UTC'),
    prefix,
    range_from: String(resolution.range_from),
    range_to: String(resolution.range_to),
  };
}
