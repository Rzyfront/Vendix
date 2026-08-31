import { ERROR_MESSAGES, DEFAULT_ERROR_MESSAGE } from './error-messages';

export interface ParsedApiError {
  errorCode: string | null;
  userMessage: string;
  devMessage: string | null;
  details: any;
  /**
   * Correlación best-effort para soporte, no una garantía.
   *
   * El filtro de excepciones del backend (`http-exception.filter.ts`) añade
   * `request_id` a TODOS los cuerpos de error con el propósito de que el
   * frontend pueda "quotearlo en el mismo toast" — el operador copiaba el
   * timestamp y el id de orden para que soporte encontrara su request. Es
   * presente en el body cuando corriste a través del AsyncLocalStorage, pero
   * el propio comentario del filtro lo advierte: es **best-effort, no una
   * garantía**. Un error sin id (red, auth, proxy, o un body que el backend no
   * envolvió) lo deja `undefined`; mostrarlo SOLO cuando existe.
   */
  request_id?: string;
}

/**
 * UN BLOQUEADOR DE LA PUERTA DE EMISIÓN.
 *
 * Espejo mínimo de `FiscalDocumentFinding` / `FiscalIdentityFinding`
 * (`apps/backend/src/domains/store/invoicing/validators/*`), que es lo que la
 * prevalidación fiscal deja en `details.blockers[]` al responder 412/422.
 *
 * Sólo se declaran los campos que la UI necesita para contestar las tres
 * preguntas del operador: QUÉ falta (`problem`), DÓNDE se corrige (`fix`) y a
 * QUÉ campo apunta (`field`). El resto viaja en `raw` sin interpretar, para que
 * añadir una clave en el backend no obligue a tocar este contrato.
 *
 * `code` y `category` se declaran `string` a propósito: en el backend son
 * uniones cerradas que crecen con cada regla nueva del Anexo Técnico, y
 * duplicarlas aquí crearía un segundo catálogo que se desactualiza en silencio.
 */
export interface ApiBlocker {
  code: string | null;
  /** Campo al que apunta (`technical_key`, `address.city_code`, `items.0.total`…). */
  field: string | null;
  /** QUÉ está mal ante la DIAN. Redactado por el backend, en español. */
  problem: string;
  /** DÓNDE se corrige. Puede faltar; nunca se inventa. */
  fix: string | null;
  severity: string | null;
  category: string | null;
  /** El objeto tal como vino, por si el consumidor necesita algo más. */
  raw: Record<string, unknown>;
}

/**
 * Lee `details.blockers[]` de un cuerpo de error, ya normalizado.
 *
 * PARA QUÉ EXISTE. La puerta de emisión calcula exactamente qué le falta al
 * documento y lo devuelve con `problem` y `fix` redactados; el frontend pintaba
 * en su lugar el texto enlatado del código («La factura no cumple las
 * validaciones. Revisa los datos.»), que no dice ni qué falta ni dónde se
 * arregla. Este lector es el punto único para recuperarlo, y se expone desde
 * `core/utils` —y no desde el módulo de facturación— porque lo consumen tanto
 * el modal de creación de factura como este mismo parser.
 *
 * Es TOLERANTE a propósito: un cuerpo sin `blockers`, con `blockers` que no es
 * arreglo, o con entradas sin `problem`, devuelve lista vacía en vez de lanzar.
 * Un error mientras se lee un error deja al usuario sin ninguna explicación.
 *
 * @param details El `details` del cuerpo de error (o el cuerpo entero).
 * @returns Los bloqueadores legibles, en el orden en que los mandó el backend.
 */
export function readApiBlockers(details: unknown): ApiBlocker[] {
  const source = asRecord(details);
  const raw = source?.['blockers'];
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.reduce<ApiBlocker[]>((acc, entry) => {
    const row = asRecord(entry);
    if (!row) return acc;
    // Sin `problem` no hay nada que contarle al usuario: una fila que sólo
    // trae un código es ruido con forma de diagnóstico.
    const problem = readNonEmptyString(row['problem']);
    if (!problem) return acc;

    acc.push({
      code: readNonEmptyString(row['code']),
      field: readNonEmptyString(row['field']),
      problem,
      fix: readNonEmptyString(row['fix']),
      severity: readNonEmptyString(row['severity']),
      category: readNonEmptyString(row['category']),
      raw: row,
    });
    return acc;
  }, []);
}

/**
 * Palabras y signos que sólo aparecen en prosa española.
 *
 * SIRVEN DE ADUANA, no de traductor. `VendixHttpException` pone en `message` el
 * `detail` que le pasaron —redactado en español para quien opera— o, cuando no
 * le pasaron ninguno, el `devMessage` del catálogo, que es inglés técnico
 * («Invoice declares a tax_rate_id that does not exist…»). Los dos llegan por
 * el mismo campo y son indistinguibles por estructura, así que se distinguen
 * por idioma: el inglés técnico no cruza, y cae al copy enlatado.
 *
 * Se comparan con espacios alrededor para no confundir subcadenas («…y en…» vs
 * «…tenant…»).
 */
const SPANISH_MARKERS = [
  ' la ', ' el ', ' los ', ' las ', ' de ', ' del ', ' que ', ' no ',
  ' se ', ' en ', ' un ', ' una ', ' con ', ' para ', ' por ', ' al ',
  ' es ', ' son ', ' su ', ' sus ', ' debe ', ' este ', ' esta ', ' sin ',
];

/** Longitud mínima para que un texto sea una frase y no un identificador. */
const MIN_PRESENTABLE_LENGTH = 16;

/**
 * ¿Este texto del backend se le puede enseñar tal cual al usuario?
 *
 * Exige tres cosas: que sea una frase (longitud y espacios), que esté en
 * español (ver {@link SPANISH_MARKERS}) y que no sea uno de los rótulos
 * internos que el filtro de excepciones fabrica cuando no hay nada mejor
 * («Validation failed», «Request failed»…). Esos últimos no explican nada y
 * taparían un copy enlatado que sí lo hace.
 */
export function isPresentableApiMessage(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (text.length < MIN_PRESENTABLE_LENGTH || !text.includes(' ')) return false;

  const lower = ` ${text.toLowerCase()} `;
  if (
    lower.includes('validation failed') ||
    lower.includes('request failed') ||
    lower.includes('internal server error') ||
    lower.includes('bad request')
  ) {
    return false;
  }

  // Acentos, eñe y signos de apertura son prueba directa de español.
  if (/[áéíóúñü¿¡]/i.test(text)) return true;

  return SPANISH_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Parsea una respuesta de error de API y retorna un mensaje UX seguro.
 *
 * ## GANA EL MENSAJE MÁS ESPECÍFICO
 *
 * El copy enlatado de `ERROR_MESSAGES[error_code]` es útil cuando el servidor
 * no dice nada mejor, y dañino cuando sí lo dice. La puerta de prevalidación
 * fiscal calcula qué campo falta y dónde se corrige, lo devuelve en `message` y
 * en `details.blockers[]`, y el usuario seguía leyendo «La factura no cumple
 * las validaciones. Revisa los datos.» — que es el mismo defecto que el enlatado
 * pretendía evitar. El orden ahora es:
 *
 *   1. `details.blockers[0].problem` (+ su `fix`) — el diagnóstico por campo.
 *   2. `message` del backend, SI pasa la aduana de {@link isPresentableApiMessage}.
 *   3. `ERROR_MESSAGES[error_code]` — el copy curado.
 *   4. `DEFAULT_ERROR_MESSAGE`.
 *
 * ## LO QUE NO CAMBIA
 *
 * La FIRMA y los cuatro campos del retorno son los mismos: media aplicación
 * consume esta función y ninguno de sus llamadores necesita tocarse.
 * `devMessage` sigue siendo el `message` crudo del backend —para el log— aunque
 * ahora, cuando es presentable, también alimente `userMessage`.
 *
 * `details.validationErrors` NO entra en esta cadena a propósito: son los textos
 * de class-validator, mayoritariamente en inglés y redactados para quien
 * programa. Quien los quiera —facturación lo hace en `describeApiFailure`, y
 * clientes en `customer-error.translator`— los lee de `details`, que sigue
 * viajando entero.
 */
export function parseApiError(error: any): ParsedApiError {
  const body = error?.error ?? error;
  const errorCode = body?.error_code ?? null;
  const devMessage = body?.message ?? null;
  const details = body?.details ?? null;

  const cannedMessage = errorCode
    ? (ERROR_MESSAGES[errorCode] ?? DEFAULT_ERROR_MESSAGE)
    : DEFAULT_ERROR_MESSAGE;

  return {
    errorCode,
    userMessage: resolveUserMessage(devMessage, details, cannedMessage),
    devMessage,
    details,
    request_id: readNonEmptyString(body?.request_id) ?? undefined,
  };
}

/**
 * Añade la línea de referencia de soporte a un mensaje de error listo para
 * toast, cuando el error trae `request_id`.
 *
 * Es BEST-EFFORT, no una garantía: el backend envuelve `request_id` en los
 * cuerpos de error que atraviesan el AsyncLocalStorage del filtro, y el propio
 * filtro lo documenta como correlación, no como promesa. Por eso la función
 * NO inventa un id ni cambia el copy: si no hay `request_id` (error de red,
 * auth, proxy, o un body que el backend no envolvió), devuelve el mensaje tal
 * cual. Consumidores de toasts de error (los que esta épica introduce ya
 * empiezan con `parseApiError` → `toastService.error`) la usan para que el
 * operador pueda "quotear el id" sin tener que copiar timestamp + id de orden.
 */
export function withApiErrorReference(
  message: string,
  requestId?: string | null,
): string {
  const id = requestId?.trim();
  return id ? `${message} · Código de referencia: ${id}` : message;
}

/**
 * Lee el `request_id` de un error crudo, de forma best-effort. El backend lo
 * envuelve en `body.request_id`; según cómo haya viajado puede estar directo,
 * en `error.error.request_id`, o el servicio lo descartó del todo. Devuelve
 * `null` cuando no está — nunca inventa un id.
 */
export function readApiErrorRequestId(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const e = error as Record<string, unknown>;
  const body = (e['error'] as Record<string, unknown>) ?? null;
  return readNonEmptyString(body?.['request_id']) ?? readNonEmptyString(e['request_id']);
}

/** Aplica el orden documentado en {@link parseApiError}. */
function resolveUserMessage(
  devMessage: unknown,
  details: unknown,
  cannedMessage: string,
): string {
  const [firstBlocker] = readApiBlockers(details);
  if (firstBlocker) {
    return firstBlocker.fix
      ? `${firstBlocker.problem} ${firstBlocker.fix}`
      : firstBlocker.problem;
  }

  // CP-POS-CREAR-EDITAR-COBRAR-001 — F.2 · Round 2 MAJOR.
  // `payOrder` (order-flow.service.ts) returns a single surface code
  // `ORD_FLOW_PAYMENT_FAILED_001` and stuffs the typed cause into
  // `details.cause_code` (e.g. `INV_STOCK_002`, `SERIAL_REQUIRED_001`,
  // `ORDER_HAS_PENDING_KITCHEN_ITEMS`). When the canned message for the
  // surface code is a generic "el cobro falló", the operator is left
  // wondering WHICH business gate fired. We look up the canned
  // message for `details.cause_code` as a tiebreaker so the cashier
  // sees the real reason without the surface translation being lost.
  const causeCode = readNonEmptyString(asRecord(details)?.['cause_code']);
  if (causeCode) {
    const causeMessage = ERROR_MESSAGES[causeCode];
    if (causeMessage) {
      return causeMessage;
    }
  }

  if (isPresentableApiMessage(devMessage)) {
    return devMessage.trim();
  }

  return cannedMessage;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
