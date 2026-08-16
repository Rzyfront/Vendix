import { VendixHttpException, ErrorCodes } from '@common/errors';
import {
  TECHNICAL_KEY_LENGTH,
  isWellFormedTechnicalKey,
  normalizeTechnicalKey,
} from '../fiscal-document-requirements';

/**
 * Los campos de `invoice_resolutions` que SÍ pueden salir hacia el cliente.
 *
 * ── POR QUÉ ES UNA LISTA BLANCA Y NO UNA EXCLUSIÓN ─────────────────────────
 *
 * Porque una exclusión sólo protege de los secretos que ya conoces. El día que
 * alguien añada una columna sensible a `invoice_resolutions`, una lista negra la
 * publica sola y en silencio; ésta la deja fuera hasta que alguien decida
 * conscientemente incluirla.
 *
 * Deja fuera las TRES columnas de clave técnica, y cada una por su motivo:
 *
 *   · `technical_key` — la ClTec en claro. Quien la tiene recomputa el CUFE de
 *     cualquier documento emitido bajo esa resolución, que es exactamente la
 *     prueba de integridad que la DIAN confronta.
 *   · `technical_key_encrypted` — la misma clave sellada. Sin la llave maestra
 *     no se abre, pero publicar el ciphertext regala el material para atacarlo
 *     fuera de línea, sin límite de intentos y contra un formato conocido.
 *   · `technical_key_fingerprint` — SHA-256 pelado, SIN llave a propósito (ver
 *     su nota en `schema.prisma`). No revela la clave, pero es un índice ciego
 *     determinista: publicarlo permite correlacionar qué resoluciones de qué
 *     tenants comparten ClTec — justo lo que `findResolutionsSharingTechnicalKey`
 *     detecta como contaminación.
 *
 * ── QUÉ PROBLEMA REAL CIERRA ───────────────────────────────────────────────
 *
 * Los `INVOICE_INCLUDE` de facturación cargaban `resolution: true` a secas, así
 * que la ClTec viajaba al navegador en CADA respuesta que devolviera una
 * factura: `GET /store/invoicing`, `GET :id`, `PATCH :id/validate`,
 * `PATCH :id/send` y las notas crédito/débito. La ClTec es el 14º campo del
 * CUFE; quien la tiene puede recomputar los CUFE de ese rango.
 *
 * El emisor SÍ la necesita para hashear, y por eso no basta con borrarla de la
 * consulta: se carga aparte, en el punto donde se usa
 * (`revealResolutionTechnicalKey` en `invoice-flow.service.ts`), en vez de
 * arrastrarse en toda lectura de factura por si acaso.
 *
 * ── POR QUÉ VIVE AQUÍ ──────────────────────────────────────────────────────
 *
 * Por lo mismo que `assertTechnicalKeyShape`: hay varios servicios que leen
 * resoluciones junto con la factura —`invoicing.service.ts`,
 * `invoice-flow.service.ts`, `credit-notes.service.ts`— y una copia por archivo
 * se desincroniza el primer día. Un solo sitio, un solo criterio.
 *
 * NOTA: no cubre el prefill del asistente fiscal
 * (`common/services/fiscal-status.service.ts`), que revela la ClTec a
 * propósito y tras `*:settings:fiscal_status:read` — ahí el usuario está
 * verificando su propia clave, que es exactamente lo que hacía falta el
 * 14/08/2026. Esa exposición es una decisión, no un descuido.
 */
export const RESOLUTION_PUBLIC_SELECT = {
  id: true,
  organization_id: true,
  store_id: true,
  accounting_entity_id: true,
  document_type: true,
  resolution_number: true,
  resolution_date: true,
  prefix: true,
  range_from: true,
  range_to: true,
  current_number: true,
  valid_from: true,
  valid_to: true,
  is_active: true,
  created_at: true,
  updated_at: true,
} as const;

/**
 * Exige que la ClTec tenga la FORMA que emite la DIAN y devuelve el valor
 * normalizado que hay que persistir (`null` si no hay clave).
 *
 * ── POR QUÉ ESTA FUNCIÓN VIVE SUELTA Y NO DENTRO DE UN SERVICIO ─────────────
 *
 * Porque hay TRES carriles de escritura de una resolución, en tres dominios
 * distintos, y cada uno tiene su propio servicio:
 *
 *   1. `store/invoicing/resolutions/resolutions.service.ts`
 *   2. `organization/invoicing/invoice-resolutions/invoice-resolutions.service.ts`
 *   3. `superadmin/subscriptions/fiscal/subscription-fiscal.service.ts`
 *
 * Sólo el primero validaba la forma. Los otros dos guardaban `dto.technical_key`
 * crudo, así que la puerta seguía abierta de par en par: la misma clave mal
 * copiada que quema un consecutivo entraba por la consola de la organización o
 * por la de super admin sin que nadie la mirara.
 *
 * Tampoco basta con el DTO. Los tres carriles NO pasan por el mismo
 * `ValidationPipe` —la consola de super admin entra por `TenantContextRunner`, y
 * un llamador interno puede construir el DTO a mano—, así que lo que no exija la
 * capa de servicio no lo exige nadie.
 *
 * ── POR QUÉ LA FORMA Y NO SÓLO LA PRESENCIA ────────────────────────────────
 *
 * La ClTec es el 14º campo del CUFE y la ÚNICA entrada del hash que el XML no
 * transporta. La DIAN recomputa el CUFE con la clave que ella misma emitió, así
 * que es el primer sistema capaz de notar que la nuestra está mal — y lo
 * notifica RECHAZANDO el documento con el consecutivo autorizado ya consumido.
 * Un consecutivo gastado no se recupera ni se reutiliza.
 *
 * Pasó en producción el 14/08/2026 con una clave de 38 caracteres —todos
 * hexadecimales, sin espacios— que el `@MaxLength(255)` de entonces aceptó sin
 * mirar. Respuesta de la DIAN: «Valor del CUFE no está calculado
 * correctamente». Factura rechazada, número quemado, y un mensaje que no dice
 * cuál de los 15 campos falló — que es justo por qué el diagnóstico tardó.
 *
 * La AUSENCIA de clave no se juzga aquí: depende del tipo de documento y lo
 * decide `validateResolutionDraft` (`INVOICING_RESOLUTION_008`). Esta función
 * responde una sola pregunta: si hay clave, ¿tiene la forma correcta?
 *
 * @param raw   valor tal como llegó del DTO, del escáner OCR o de la consola.
 * @param details contexto extra para el error (id de resolución, prefijo…).
 *                NUNCA metas aquí el valor de la clave: viaja al cliente.
 */
export function assertTechnicalKeyShape(
  raw: string | null | undefined,
  details: Record<string, unknown> = {},
): string | null {
  const technical_key = normalizeTechnicalKey(raw);
  if (!technical_key) return null;
  if (isWellFormedTechnicalKey(technical_key)) return technical_key;

  const longitud = technical_key.length;
  const diagnostico =
    longitud === TECHNICAL_KEY_LENGTH
      ? `tiene los ${TECHNICAL_KEY_LENGTH} caracteres pero incluye alguno que no es hexadecimal (solo valen 0-9 y a-f: revisa las «o» por ceros y las «l» por unos)`
      : `tiene ${longitud} ${longitud === 1 ? 'carácter' : 'caracteres'} y la DIAN emite exactamente ${TECHNICAL_KEY_LENGTH}`;

  throw new VendixHttpException(
    ErrorCodes.INVOICING_RESOLUTION_011,
    `La clave técnica (ClTec) ${diagnostico}. Cópiala COMPLETA desde el PDF de la Autorización de Numeración ` +
      '(MUISCA → Numeración de facturación → Consultar autorización) o desde la respuesta del servicio ' +
      '«Rangos de Numeración» (GetNumberingRange) de la DIAN. Un solo carácter de más o de menos hace que el ' +
      'CUFE se calcule distinto del que la DIAN recomputa: rechaza la factura con «Valor del CUFE no está ' +
      'calculado correctamente» y el consecutivo autorizado que gastó no se recupera.',
    {
      // Nunca el valor: la ClTec es un secreto del rango y este detalle viaja al
      // cliente. La longitud es lo único que hace falta para corregirla.
      ...details,
      technical_key_length: longitud,
      expected_length: TECHNICAL_KEY_LENGTH,
    },
  );
}
