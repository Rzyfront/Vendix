/**
 * Traducción de nombres entre el vocabulario compartido de las secciones y el
 * de cada destino: el DTO de creación de factura y el JSON de configuración de
 * perfil.
 *
 * ## Por qué existe esta función y no un renombre
 *
 * Cuatro datos se llaman distinto en cada lado:
 *
 * | Dato | Factura (DTO) | Perfil (config) |
 * |------|---------------|-----------------|
 * | Tipo de documento | `invoice_type` | `dian.document_type` |
 * | Forma de pago | `payment_form` | `dian.payment_method_code` |
 * | Objeto del contrato AIU | `aiu_contract_object` | `aiu.contract_object` |
 * | Notas de cabecera | `notes` (texto) | `dian.header_notes` (lista) |
 *
 * Renombrar cualquiera de los dos lados es un cambio de contrato con el
 * backend, y el más barato de los dos —renombrar el del perfil— rompería la
 * lectura de los snapshots ya persistidos, que son inmutables a propósito
 * porque una factura emitida en marzo se armó con la configuración de marzo.
 *
 * Así que el vocabulario compartido es el de la FACTURA (el documento real es
 * el que manda) y cada página traduce al armar su payload. El coste se paga
 * aquí, en un archivo con nombre, en vez de repartirse por dos plantillas.
 *
 * ## La trampa que este archivo existe para evitar
 *
 * `notes` y `internal_note` NO son el mismo dato y no se mapean uno al otro:
 *
 *  - `notes` → `cbc:Note` del XML. Lo lee el adquiriente y lo lee la DIAN.
 *  - `internal_note` → no sale del negocio.
 *
 * Confundirlos publica en una factura electrónica el motivo interno de un
 * descuento, o el nombre de quien autorizó una tarifa distinta de la habitual.
 * Es un error que no falla al compilar, no falla al emitir, y sólo se descubre
 * cuando el cliente lee la factura.
 */

/** Los cuatro datos cuyo nombre divergía, en el vocabulario compartido. */
export interface CanonicalDocumentFields {
  /** Tipo de documento DIAN (`sales_invoice`, `export_invoice`…). */
  invoice_type?: string | null;
  /** Forma de pago: `'1'` contado, `'2'` crédito. */
  payment_form?: string | null;
  /** Medio de pago: código numérico DIAN. Mismo nombre en los dos destinos. */
  payment_means_code?: string | null;
  /** Notas que VIAJAN al XML como `cbc:Note`. */
  notes?: readonly string[] | null;
  /** Notas que NO salen del negocio. */
  internal_note?: string | null;
  /** Objeto del contrato, obligatorio para emitir un documento AIU. */
  aiu_contract_object?: string | null;
  /** Resolución preferida / elegida. */
  resolution_id?: number | null;
}

/** El trozo del DTO de creación de factura que cubren estos campos. */
export interface InvoiceFieldPayload {
  invoice_type?: string;
  payment_form?: string;
  payment_means_code?: string;
  notes?: string;
  aiu_contract_object?: string;
  resolution_id?: number;
}

/** El trozo del JSON de perfil que cubren estos campos. */
export interface ProfileFieldPayload {
  dian: {
    document_type?: string | null;
    payment_method_code?: string | null;
    payment_means_code?: string | null;
    header_notes?: readonly string[] | null;
    resolution_id?: number | null;
  };
  general: { internal_note?: string | null };
  aiu: { contract_object?: string | null } | null;
}

/** Vacío o sólo espacios → ausente. Un campo en blanco no es un valor. */
function text(value: string | null | undefined): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Vocabulario compartido → DTO de creación de factura.
 *
 * Las notas viajan como UNA cadena porque el DTO declara `notes?: string`: se
 * unen con salto de línea, que es como el constructor UBL las emite en un único
 * `cbc:Note`. Unirlas con coma haría que dos notas independientes se leyeran
 * como una sola frase.
 *
 * Los campos ausentes se OMITEN en vez de viajar como `null` o cadena vacía: el
 * backend valida con `forbidNonWhitelisted` y trata la ausencia como «no lo
 * cambies», mientras que una cadena vacía es un valor y sí se guarda.
 */
export function toInvoicePayload(
  fields: CanonicalDocumentFields,
): InvoiceFieldPayload {
  const payload: InvoiceFieldPayload = {};

  const invoice_type = text(fields.invoice_type);
  if (invoice_type) payload.invoice_type = invoice_type;

  const payment_form = text(fields.payment_form);
  if (payment_form) payload.payment_form = payment_form;

  const payment_means_code = text(fields.payment_means_code);
  if (payment_means_code) payload.payment_means_code = payment_means_code;

  const notes = (fields.notes ?? [])
    .map((note) => text(note))
    .filter((note): note is string => !!note);
  if (notes.length > 0) payload.notes = notes.join('\n');

  const contract_object = text(fields.aiu_contract_object);
  if (contract_object) payload.aiu_contract_object = contract_object;

  if (typeof fields.resolution_id === 'number' && fields.resolution_id > 0) {
    payload.resolution_id = fields.resolution_id;
  }

  // `internal_note` NO se mapea: la factura lo guarda por otra vía y, sobre
  // todo, NUNCA a `notes`. Ver el docblock de este archivo.
  return payload;
}

/**
 * Vocabulario compartido → JSON de configuración de perfil.
 *
 * Aquí los campos ausentes viajan como `null` y no se omiten, porque el
 * snapshot del perfil es un documento completo: la ausencia de una clave y su
 * presencia en `null` significan lo mismo al leerlo, pero el validador del
 * contrato compara formas y un snapshot con claves faltantes se lee como una
 * versión de configuración distinta.
 *
 * `aiu` queda en `null` cuando no hay objeto de contrato: un perfil que no es
 * AIU no lleva bloque AIU, y el backend descarta el que llegue.
 */
export function toProfileConfig(
  fields: CanonicalDocumentFields,
): ProfileFieldPayload {
  const notes = (fields.notes ?? [])
    .map((note) => text(note))
    .filter((note): note is string => !!note);
  const contract_object = text(fields.aiu_contract_object);

  return {
    dian: {
      document_type: text(fields.invoice_type) ?? null,
      payment_method_code: text(fields.payment_form) ?? null,
      payment_means_code: text(fields.payment_means_code) ?? null,
      header_notes: notes.length > 0 ? notes : null,
      resolution_id:
        typeof fields.resolution_id === 'number' && fields.resolution_id > 0
          ? fields.resolution_id
          : null,
    },
    general: { internal_note: text(fields.internal_note) ?? null },
    aiu: contract_object ? { contract_object } : null,
  };
}

/**
 * JSON de perfil → vocabulario compartido. Es la dirección que usa la PRECARGA:
 * elegir un perfil en «Nueva factura» tiene que poder llenar los mismos
 * controles que el editor de perfiles llenó.
 *
 * Sin esta inversa, la precarga volvería a traducir a mano en la página, que es
 * exactamente el sitio donde el par `notes`/`internal_note` se confunde.
 */
export function fromProfileConfig(
  config: ProfileFieldPayload,
): CanonicalDocumentFields {
  return {
    invoice_type: config.dian?.document_type ?? null,
    payment_form: config.dian?.payment_method_code ?? null,
    payment_means_code: config.dian?.payment_means_code ?? null,
    notes: config.dian?.header_notes ?? null,
    internal_note: config.general?.internal_note ?? null,
    aiu_contract_object: config.aiu?.contract_object ?? null,
    resolution_id: config.dian?.resolution_id ?? null,
  };
}

/**
 * DTO de factura → vocabulario compartido. Es la dirección que usa la EDICIÓN
 * de un borrador: los controles se llenan desde lo que el backend devolvió.
 *
 * `notes` vuelve a ser lista partiendo por salto de línea, la inversa exacta de
 * lo que hace `toInvoicePayload`. Partir por coma o por punto y coma trocearía
 * una nota que legítimamente los contenga.
 */
export function fromInvoicePayload(
  payload: InvoiceFieldPayload,
): CanonicalDocumentFields {
  const notes = (payload.notes ?? '')
    .split('\n')
    .map((note) => text(note))
    .filter((note): note is string => !!note);

  return {
    invoice_type: payload.invoice_type ?? null,
    payment_form: payload.payment_form ?? null,
    payment_means_code: payload.payment_means_code ?? null,
    notes: notes.length > 0 ? notes : null,
    internal_note: null,
    aiu_contract_object: payload.aiu_contract_object ?? null,
    resolution_id: payload.resolution_id ?? null,
  };
}
