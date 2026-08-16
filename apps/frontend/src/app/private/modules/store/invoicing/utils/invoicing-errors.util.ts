import { AbstractControl } from '@angular/forms';

import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
  DEFAULT_ERROR_MESSAGE,
  ERROR_MESSAGES,
} from '../../../../../core/utils/error-messages';
import type { Invoice } from '../interfaces/invoice.interface';

/**
 * COMO SE LEE UN FALLO DE FACTURACION.
 *
 * El backend ya responde tipado: `error_code` + `message` de desarrollador +
 * `details`. El frontend NUNCA muestra ese `message` — `parseApiError` renderiza
 * `ERROR_MESSAGES[error_code]`, y un codigo sin copy cae al generico. Este
 * modulo concentra las tres lecturas que la facturacion necesita hacer de ese
 * cuerpo, para que ningun effect ni componente vuelva a improvisarlas:
 *
 *  1. `describeApiFailure`  — mensaje UX + codigo + details, en un objeto plano
 *     que puede viajar dentro de una accion NgRx.
 *  2. `readDianRejection`   — los motivos REALES del rechazo de la DIAN que
 *     `INVOICING_PROVIDER_004` trae en `details.dian_errors[]`. EN VIVO: sólo
 *     existe mientras dura el error de la peticion.
 *  2b. `readPersistedDianRejection` — esos MISMOS motivos, leidos de lo que el
 *     backend ya guardo en `invoices.provider_response`. Es el respaldo que
 *     hace que el rechazo sobreviva a una recarga.
 *  3. `applyBackendValidationErrors` — los `details.validationErrors` de
 *     `SYS_VALIDATION_001` puestos sobre el `FormControl` que les corresponde.
 */

// ─────────────────────────────────────────────────────────────
// 1. Fallo de API, normalizado
// ─────────────────────────────────────────────────────────────

/**
 * Fallo de API ya leido y plano (serializable), listo para viajar en una accion
 * NgRx y para que el componente decida que hacer con el.
 */
export interface ApiFailure {
  /** Mensaje que SI se muestra al usuario (copy en español de ERROR_MESSAGES). */
  message: string;
  /** `error_code` del backend, cuando el error viene tipado. */
  errorCode: string | null;
  /** `details` crudo: `validationErrors`, `dian_errors`, `missing_steps`, etc. */
  details: unknown;
}

/**
 * Cuantos motivos de validacion caben en un toast antes de volverse ilegible.
 * El resto no se pierde: se cuenta, y `applyBackendValidationErrors` los pinta
 * sobre su campo.
 */
const MAX_VALIDATION_MESSAGES_IN_TOAST = 2;

/**
 * Normaliza cualquier error de HTTP a `ApiFailure`.
 *
 * Tres fuentes, en orden de concrecion:
 *
 *  1. `details.validationErrors` — EL MOTIVO REAL. El `ValidationPipe` global
 *     de `main.ts` mete ahi los mensajes de class-validator y deja
 *     `message: 'Validation failed'` con `error_code: 'SYS_VALIDATION_001'`,
 *     cuyo copy es el generico «Los datos ingresados no son validos.». Preferir
 *     el copy sobre el detalle es exactamente como una resolucion con la clave
 *     tecnica de 38 caracteres se rechazo SIN decir que la clave estaba mocha:
 *     el backend ya lo habia redactado —con la longitud leida y donde encontrar
 *     la correcta— y el frontend lo tiraba a la basura. El usuario tuvo que
 *     abrir el network para enterarse.
 *  2. `error_code` — copy curado de `ERROR_MESSAGES`, jamas el mensaje de
 *     desarrollador.
 *  3. Sin `error_code` —error de red, 502, respuesta sin envolver—
 *     `extractApiErrorMessage`, que al menos sabe traducir el status HTTP.
 *
 * `details` viaja intacto en los tres casos: el toast dice lo primero que hay
 * que corregir y `applyBackendValidationErrors` reparte TODO sobre los campos.
 */
export function describeApiFailure(error: unknown): ApiFailure {
  const parsed = parseApiError(error);
  const validationMessages = extractValidationMessages(parsed.details);

  if (validationMessages.length > 0) {
    const shown = validationMessages.slice(0, MAX_VALIDATION_MESSAGES_IN_TOAST);
    const hidden = validationMessages.length - shown.length;
    return {
      message:
        shown.join(' · ') + (hidden > 0 ? ` (+${hidden} más)` : ''),
      errorCode: parsed.errorCode,
      details: parsed.details,
    };
  }

  return {
    message: parsed.errorCode ? parsed.userMessage : extractApiErrorMessage(error),
    errorCode: parsed.errorCode,
    details: parsed.details,
  };
}

// ─────────────────────────────────────────────────────────────
// 2. Rechazo de la DIAN (INVOICING_PROVIDER_004)
// ─────────────────────────────────────────────────────────────

/**
 * Un motivo de rechazo tal como lo publica la DIAN: el codigo de la regla
 * (`FAB10a`, `FAU01`…) y su texto. Espejo estructural de `DianRejectionReason`
 * en `invoice-flow.service.ts`; se declara aqui para no acoplar el frontend a
 * un tipo del backend.
 */
export interface DianRejectionReason {
  code?: string;
  message: string;
  severity?: string;
}

/** Lo que la DIAN dijo del documento, ya atado a la factura que lo produjo. */
export interface DianRejection {
  /** Factura sobre la que se produjo el rechazo (`details.invoice_id`). */
  invoiceId: number | null;
  /** Encabezado UX del codigo (`ERROR_MESSAGES[INVOICING_PROVIDER_004]`). */
  headline: string;
  reasons: DianRejectionReason[];
  statusCode?: string;
  statusDescription?: string;
  trackingId?: string;
}

/**
 * Extrae el rechazo de la DIAN de un fallo ya normalizado.
 *
 * ESTO ES LA DIFERENCIA ENTRE «error del proveedor» Y «Valor del CUFE no esta
 * calculado correctamente». El backend deja de proposito la regla violada en
 * `details.dian_errors[]` para que la UI la enumere; si el frontend solo pinta
 * el copy del codigo, el comerciante no tiene nada que corregir.
 *
 * Devuelve `null` cuando el error no es un rechazo de la DIAN o cuando no trajo
 * ni un motivo legible: un panel vacio no vale la pena.
 */
export function readDianRejection(failure: ApiFailure): DianRejection | null {
  if (failure.errorCode !== 'INVOICING_PROVIDER_004') {
    return null;
  }
  const details = asRecord(failure.details);
  if (!details) {
    return null;
  }

  const reasons = normalizeDianReasons(details['dian_errors']);

  const statusDescription = readString(details['dian_status_description']);
  if (reasons.length === 0 && !statusDescription) {
    return null;
  }

  return {
    invoiceId: typeof details['invoice_id'] === 'number' ? details['invoice_id'] : null,
    headline: failure.message,
    reasons,
    statusCode: readString(details['dian_status_code']) ?? undefined,
    statusDescription: statusDescription ?? undefined,
    trackingId: readString(details['tracking_id']) ?? undefined,
  };
}

/**
 * Encabezado del panel de rechazo. Sale del MISMO catalogo del que sale el del
 * error en vivo (`parseApiError` -> `ERROR_MESSAGES[error_code]`), asi que las
 * dos fuentes se leen identicas: cambiar el copy en un sitio las cambia en los
 * dos, que es justo lo que evita que el panel persistido se desvie del vivo.
 */
const DIAN_REJECTION_HEADLINE =
  ERROR_MESSAGES['INVOICING_PROVIDER_004'] ?? DEFAULT_ERROR_MESSAGE;

/**
 * EL MISMO RECHAZO, LEIDO DE LO QUE QUEDO GUARDADO.
 *
 * POR QUE EXISTE. `readDianRejection` sólo sabe leer el error TRANSITORIO de la
 * peticion que produjo el rechazo, y ese error vive en el store hasta que el
 * reducer lo limpia — cuatro veces, `loadInvoice` incluido. Recargar la pagina,
 * o abrir una factura rechazada de ayer, dejaba el badge «Rechazado por la
 * DIAN» sin UNA sola regla: el «Valor del CUFE no esta calculado
 * correctamente» del incidente real seguia escrito en la fila y nadie lo veia.
 * El backend ya persiste esa evidencia en `invoices.provider_response` y la
 * devuelve entera en `GET :id`; esto es sólo leerla.
 *
 * SOLO SOBRE UN RECHAZO. `provider_response` se escribe TAMBIEN al aceptar
 * (`success: true`, sin motivos), al expedir en contingencia y cuando la
 * respuesta llega sin CUFE. Ninguno de esos es un rechazo, y este panel afirma
 * literalmente que «la DIAN rechazo el documento»:
 *
 *   · contingencia -> `transmission_status: 'contingency'`, `dian_status:
 *     'pending'`. El documento es VALIDO y esta entregado; ya tiene su propio
 *     aviso con el plazo de 48 h. Pintarlo como rechazo seria mentir.
 *   · `error`      -> la transmision no llego a la DIAN, que es lo que dice la
 *     celda de estado fiscal («no es un rechazo: el documento no fue
 *     juzgado»). Contradecirla desde el panel de al lado seria peor que callar.
 *
 * Por eso el disparador son los estados de RECHAZO de la propia fila, los tres
 * que el backend escribe juntos en esa rama (`status`, `dian_status`,
 * `transmission_status`): basta con que uno lo declare.
 *
 * Devuelve `null` cuando no hay nada legible que mostrar — un panel vacio no
 * vale la pena, igual que en el camino en vivo.
 */
export function readPersistedDianRejection(
  invoice: Invoice | null | undefined,
): DianRejection | null {
  if (!invoice || !wasRejectedByDian(invoice)) {
    return null;
  }

  // Se declara tipado (`InvoiceProviderResponse`) para documentar el contrato,
  // pero se LEE como JSON de un tercero: la columna es un `Json?` sin validar y
  // en la base conviven filas con otra forma entera (`{ date, status,
  // tracking_id }`, del seed). Un `.message` sobre eso no existe.
  const evidence = asRecord(invoice.provider_response);
  if (!evidence) {
    return null;
  }

  const data = asRecord(evidence['provider_data']);
  const reasons = normalizeDianReasons(data?.['dian_errors']);
  const statusCode = readString(data?.['dian_status_code']);
  const statusDescription = readString(data?.['dian_status_description']);
  // `message` del proveedor: en un rechazo del proveedor DIAN ya trae los
  // motivos concatenados, asi que solo se usa como encabezado cuando NO hay
  // viñetas — de lo contrario diria dos veces lo mismo.
  const providerMessage = readString(evidence['message']);

  if (reasons.length === 0 && !statusDescription && !providerMessage) {
    return null;
  }

  return {
    invoiceId: invoice.id,
    // Con viñetas, el encabezado es el copy curado —el mismo del camino en
    // vivo—. Sin ellas, el mensaje del proveedor es lo unico que queda y vale
    // mas que una frase generica. `statusDescription` NUNCA sube acá: ya se
    // pinta en su propia linea («Estado DIAN: …») y repetirlo seria decir dos
    // veces lo mismo en el mismo recuadro.
    headline: reasons.length
      ? DIAN_REJECTION_HEADLINE
      : (providerMessage ?? DIAN_REJECTION_HEADLINE),
    reasons,
    statusCode: statusCode ?? undefined,
    statusDescription: statusDescription ?? undefined,
    trackingId: readString(evidence['tracking_id']) ?? undefined,
  };
}

/**
 * La fila declara que la DIAN RECHAZO el documento.
 *
 * Los tres estados se escriben JUNTOS en la rama de rechazo del backend, asi
 * que en la practica coinciden; se leen los tres porque el detalle tambien se
 * pinta con la fila de la lista y una respuesta vieja podria traer sólo alguno.
 */
function wasRejectedByDian(invoice: Invoice): boolean {
  return (
    invoice.status === 'rejected' ||
    invoice.dian_status === 'rejected' ||
    invoice.transmission_status === 'rejected'
  );
}

/**
 * Normaliza una lista cruda de `dian_errors[]`, venga del `details` de la
 * excepcion o de `provider_response`. UNA sola lectura para las dos fuentes:
 * lo que se filtre acá se filtra en las dos, y lo que se pinte se pinta igual.
 */
function normalizeDianReasons(raw: unknown): DianRejectionReason[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.reduce<DianRejectionReason[]>((acc, entry) => {
    const row = asRecord(entry);
    if (!row) return acc;
    const message = readReasonText(row['message']);
    // Un motivo sin texto no le dice nada a nadie; el codigo solo no basta.
    if (!message) return acc;
    const reason: DianRejectionReason = { message };
    const code = readString(row['code']);
    if (code) reason.code = code;
    const severity = readString(row['severity']);
    if (severity) reason.severity = severity;
    acc.push(reason);
    return acc;
  }, []);
}

/**
 * Texto de un motivo, DESCARTANDO EL RUIDO.
 *
 * `extractErrors` (backend, `dian-response-parser.service.ts`) barre el XML con
 * dos expresiones regulares, y la segunda se lleva CADA `<cbc:Description>` del
 * documento — no todas son reglas. En el incidente real eso metio un motivo
 * cuyo `message` era literalmente `"0"`. Una viñeta que solo dice «0» no le
 * dice nada al comerciante y ensucia la unica lista que si le dice que
 * corregir, asi que un texto sin una sola letra se descarta igual que uno
 * vacio.
 */
function readReasonText(value: unknown): string | null {
  const text = readString(value);
  return text && /\p{L}/u.test(text) ? text : null;
}

/**
 * Motivos que efectivamente rechazan el documento. La DIAN mezcla advertencias
 * con errores en la misma lista, y una nota al margen no es la causa del
 * rechazo: si hay bloqueantes, el resumen habla de ellos.
 */
export function blockingReasons(rejection: DianRejection): DianRejectionReason[] {
  const blocking = rejection.reasons.filter((r) => r.severity !== 'warning');
  return blocking.length > 0 ? blocking : rejection.reasons;
}

/** Una linea legible de un motivo: `FAB10a: Valor del CUFE…`. */
export function formatReason(reason: DianRejectionReason): string {
  return reason.code ? `${reason.code}: ${reason.message}` : reason.message;
}

// ─────────────────────────────────────────────────────────────
// 3. Errores de validacion por campo (SYS_VALIDATION_001)
// ─────────────────────────────────────────────────────────────

/**
 * Clave del error que se pone en el `FormControl` con el mensaje del backend.
 * Se aisla en una constante porque el componente la usa para limpiarla al
 * editar sin borrar los errores de los validadores del formulario.
 */
export const BACKEND_ERROR_KEY = 'backendValidation';

export interface AppliedValidationErrors {
  /** `path del control -> mensaje exacto del backend`, para pintarlo en el campo. */
  fieldErrors: Record<string, string>;
  /** Controles marcados, para poder limpiarlos cuando el usuario los edite. */
  touchedControls: { path: string; control: AbstractControl }[];
  /** Mensajes que no se pudieron amarrar a ningun control del formulario. */
  unmatched: string[];
}

/**
 * FORMA REAL DE `details.validationErrors` (verificada en el backend, no
 * supuesta): `AllExceptionsFilter` guarda ahi el `rawMessage` del
 * `BadRequestException` que produce el `exceptionFactory` global de `main.ts`,
 * y ese factory devuelve `flattenValidationMessages(errors)` — un **arreglo de
 * strings**, no de objetos. Dos formas conviven:
 *
 *  - plano:    `"customer_name must be longer than or equal to 2 characters"`
 *              (class-validator antepone el nombre de la propiedad)
 *  - anidado:  `"items.0.unit_price: unit_price must not be less than 0"`
 *              (`flattenValidationMessages` prefija la ruta cuando el error
 *              vive dentro de un arreglo)
 *  - whitelist: `"property inline_product should not exist"`
 *
 * El caso masivo (`CUST_BULK_VALIDATION`) si trae objetos, pero no lo produce
 * ningun endpoint de facturacion, asi que aqui solo se lee a la defensiva.
 */
export function extractValidationMessages(details: unknown): string[] {
  const record = asRecord(details);
  const raw = record?.['validationErrors'];
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.reduce<string[]>((acc, entry) => {
    if (typeof entry === 'string' && entry.trim()) {
      acc.push(entry.trim());
      return acc;
    }
    // Defensivo: shape estructurado (`{ property, constraints }`).
    const row = asRecord(entry);
    if (!row) return acc;
    const property = readString(row['property']);
    const constraints = asRecord(row['constraints']);
    const text = constraints
      ? Object.values(constraints).filter((v) => typeof v === 'string').join(' ')
      : null;
    if (text) {
      acc.push(property ? `${property}: ${text}` : text);
    }
    return acc;
  }, []);
}

/** Ruta punteada valida de un control (`items.0.unit_price`). */
const CONTROL_PATH = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/;

/**
 * Deduce a que control apunta un mensaje del `ValidationPipe`.
 *
 * 1. `"<ruta>: <texto>"` cuando la ruta existe en el formulario (caso anidado).
 * 2. `"property <campo> should not exist"` (`forbidNonWhitelisted`).
 * 3. El primer token, que es como class-validator nombra la propiedad.
 */
function resolveMessagePath(form: AbstractControl, message: string): string | null {
  const separator = message.indexOf(': ');
  if (separator > 0) {
    const prefix = message.slice(0, separator);
    if (CONTROL_PATH.test(prefix) && form.get(prefix)) {
      return prefix;
    }
  }

  const tokens = message.trim().split(/\s+/);
  if (tokens.length === 0 || !tokens[0]) {
    return null;
  }
  const candidate =
    tokens[0] === 'property' && tokens.length > 1 ? tokens[1] : tokens[0];
  return CONTROL_PATH.test(candidate) && form.get(candidate) ? candidate : null;
}

/** Texto que se muestra en el campo, sin el prefijo de ruta redundante. */
function messageBody(message: string, path: string | null): string {
  if (path && message.startsWith(`${path}: `)) {
    return message.slice(path.length + 2);
  }
  return message;
}

/**
 * Pone cada error del backend sobre el `FormControl` que le corresponde, para
 * que el usuario vea QUE campo esta mal EN el campo y no en un toast generico.
 *
 * El error se guarda bajo `BACKEND_ERROR_KEY` para no pisar los errores de los
 * validadores locales, y el control se marca como `touched` porque los
 * componentes compartidos solo pintan el estado de error cuando lo esta.
 *
 * Lo que no se amarra a ningun control se devuelve en `unmatched`: perder un
 * motivo de rechazo por no saber donde ponerlo es exactamente el fallo
 * silencioso que este modulo existe para evitar.
 */
export function applyBackendValidationErrors(
  form: AbstractControl,
  details: unknown,
): AppliedValidationErrors {
  const applied: AppliedValidationErrors = {
    fieldErrors: {},
    touchedControls: [],
    unmatched: [],
  };

  for (const message of extractValidationMessages(details)) {
    const path = resolveMessagePath(form, message);
    const control = path ? form.get(path) : null;
    if (!path || !control) {
      applied.unmatched.push(message);
      continue;
    }

    const text = messageBody(message, path);
    // Varios constraints sobre el mismo campo se acumulan en una sola linea.
    applied.fieldErrors[path] = applied.fieldErrors[path]
      ? `${applied.fieldErrors[path]} ${text}`
      : text;
    control.setErrors({
      ...(control.errors ?? {}),
      [BACKEND_ERROR_KEY]: applied.fieldErrors[path],
    });
    control.markAsTouched();
    if (!applied.touchedControls.some((entry) => entry.path === path)) {
      applied.touchedControls.push({ path, control });
    }
  }

  return applied;
}

/**
 * Quita SOLO el error del backend de un control, conservando los de los
 * validadores locales. Sin esto el formulario queda invalido para siempre y el
 * boton de guardar no vuelve a habilitarse nunca.
 */
export function clearBackendError(control: AbstractControl): void {
  const errors = control.errors;
  if (!errors || !(BACKEND_ERROR_KEY in errors)) {
    return;
  }
  const { [BACKEND_ERROR_KEY]: _removed, ...rest } = errors;
  control.setErrors(Object.keys(rest).length > 0 ? rest : null);
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
