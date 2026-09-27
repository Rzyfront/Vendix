import { DIAN_ID_TYPES } from '../providers/dian-direct/constants/dian-document-types';

/**
 * IDENTIDAD EFECTIVA DEL ADQUIRIENTE — fuente única para validación y emisión.
 *
 * ## El incidente que cierra
 *
 * Óptica Panorama SAS (NIT 800214345-7, persona jurídica) recibió una factura
 * manual (`invoices.customer_id IS NULL`) de la tienda Pollo Árabe transmitida
 * a la DIAN como Cédula de Ciudadanía (`schemeName`/código `13`) + persona
 * natural (`AdditionalAccountID` `2`), sin DV, sin correo, y con la dirección
 * FISCAL de la propia tienda impresa como si fuera la del cliente.
 *
 * La causa: `invoice-flow.service.ts::send()` sólo leía
 * `document_type`/`verification_digit`/`email`/`phone`/`tax_regime`/
 * `tax_responsibilities`/`person_type` de la ficha viva del cliente
 * (`invoice.customer`, vía `toCustomerInvoiceData`) — que es `{}` cuando
 * `customer_id` es NULL — y NUNCA caía al snapshot que la propia factura ya
 * tiene persistido (`invoices.customer_document_type`,
 * `customer_verification_digit`, `customer_email`, `customer_phone`,
 * `customer_tax_regime`, `customer_fiscal_responsibilities`). Sin tipo
 * declarado, `DianDirectProvider.buildCustomerData` completaba con `'CC'` en
 * silencio y `translatePersonTypeToStructural` derivaba `'NATURAL'` — la
 * mentira exacta que salió firmada.
 *
 * ## La regla — UNA sola precedencia, en un solo lugar
 *
 * Ficha vinculada (`customer`, sólo se pasa cuando existe `customer_id`) manda
 * campo a campo; el snapshot de la factura (`snapshot`) respalda cada campo
 * ausente. Sin ficha vinculada, el snapshot es la única fuente. Esta función
 * se llama DOS veces desde `invoice-flow.service.ts` con los MISMOS dos
 * argumentos — una vez para lo que `CustomerFiscalIdentityValidator` juzga
 * (`buildAcquirerIdentityInput`), otra para lo que `send()` transmite — así
 * que validación y emisión judgan exactamente lo mismo.
 *
 * No decide dirección (eso vive en `acquirer-address.resolver.ts` +
 * `CustomerFiscalIdentityValidator.checkAddress`, con su propia cascada y su
 * propio bloqueo) ni el carril final_consumer/nominativo (eso es
 * `acquirer-rail.resolver.ts`, que corre en la CREACIÓN de la factura, antes
 * de que exista snapshot que resolver). Esta función sólo resuelve identidad
 * fiscal: tipo/número/DV de documento, tipo de persona, nombre, régimen,
 * responsabilidades, correo y teléfono.
 */

/** Campos `customer_*` tal como se persisten en `invoices` (el snapshot). */
export interface AcquirerIdentitySnapshot {
  customer_name?: string | null;
  customer_tax_id?: string | null;
  customer_document_type?: string | null;
  customer_verification_digit?: string | null;
  customer_tax_regime?: string | null;
  customer_fiscal_responsibilities?: unknown;
  customer_email?: string | null;
  customer_phone?: string | null;
}

/**
 * Ficha viva del cliente (`invoice.customer`, forma `CustomerForInvoice` de
 * `customer-invoice-data.adapter.ts`) — se pasa RAW, no adaptada, para
 * preservar `first_name`/`last_name` que `toCustomerInvoiceData` ya compone.
 */
export interface AcquirerIdentityCustomer {
  legal_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  document_type?: string | null;
  document_number?: string | null;
  verification_digit?: string | null;
  person_type?: string | null;
  tax_regime?: string | null;
  fiscal_responsibilities?: readonly string[] | null;
  email?: string | null;
  phone?: string | null;
  ciiu_code?: string | null;
  is_withholding_agent?: boolean | null;
}

export type ResolvedAcquirerPersonType = 'NATURAL' | 'JURIDICA';

export interface ResolvedAcquirerIdentity {
  /** Literal canónico ('NIT','CC',…), o el valor tal cual llegó si no matchea
   *  ningún alias/código conocido (para que el validador lo reporte como
   *  DOCUMENT_TYPE_UNKNOWN en vez de perderlo), o `null` si no vino nada. */
  document_type_literal: string | null;
  /** Código DIAN de dos dígitos ('31','13',…), o `null` si no se pudo derivar. */
  document_type_code: string | null;
  document_number: string | null;
  verification_digit: string | null;
  /** SIEMPRE resuelto (nunca null): explícito reconocible, o derivado del
   *  código de documento. Para emisión/PDF. */
  person_type: ResolvedAcquirerPersonType;
  /** El valor CRUDO de `person_type` tal como vino declarado (sin derivar),
   *  o `null` si no vino nada. Para que el validador siga pudiendo avisar
   *  sobre un valor irreconocible en vez de que este resolver se lo trague. */
  person_type_raw: string | null;
  /** Nombre para mostrar: razón social / nombre completo. */
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  tax_regime: string | null;
  tax_responsibilities: string[];
  ciiu_code: string | null;
  is_withholding_agent: boolean;
}

const DOCUMENT_TYPE_CODE_TO_LITERAL: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [literal, code] of Object.entries(DIAN_ID_TYPES)) {
    if (!map.has(code)) map.set(code, literal);
  }
  return map;
})();

/**
 * Normaliza un `document_type` que puede llegar en dos vocabularios: el
 * literal interno (`'NIT'`, `'CC'`, …) o el código DIAN de dos dígitos
 * (`'31'`, `'13'`). Devuelve AMBOS resueltos —o `null` en la parte que no se
 * pudo derivar— para que cada consumidor use el que necesita sin volver a
 * adivinar en qué vocabulario llegó el valor.
 */
export function normalizeAcquirerDocumentType(
  raw: string | null | undefined,
): { literal: string | null; code: string | null } {
  const value = (raw ?? '').trim().toUpperCase();
  if (!value) return { literal: null, code: null };

  if (Object.prototype.hasOwnProperty.call(DIAN_ID_TYPES, value)) {
    return { literal: value, code: DIAN_ID_TYPES[value] };
  }
  const literal_from_code = DOCUMENT_TYPE_CODE_TO_LITERAL.get(value);
  if (literal_from_code) {
    return { literal: literal_from_code, code: value };
  }
  // Ni alias conocido ni código DIAN: se conserva tal cual para que el
  // validador lo reporte como DOCUMENT_TYPE_UNKNOWN en vez de perderlo.
  return { literal: value, code: null };
}

/**
 * Persona derivada del CÓDIGO DIAN del documento (NIT/'31' ⇒ jurídica), salvo
 * que llegue un `person_type` explícito y reconocible. Réplica ÚNICA de una
 * regla que vivía triplicada y divergente: `CustomerFiscalIdentityValidator
 * .resolvePersonType` ya comparaba por código y estaba bien;
 * `DianDirectProvider.translatePersonTypeToStructural` y el selector inline de
 * `UblCommonBuilder.buildCustomerParty` comparaban por el LITERAL `'NIT'`, así
 * que un `document_type` que llegaba como código DIAN sin normalizar
 * (`'31'`) los hacía caer a `'NATURAL'` — la mitad exacta del incidente.
 */
export function resolveAcquirerPersonType(
  declared: string | null | undefined,
  document_type_code: string | null,
): {
  person_type: ResolvedAcquirerPersonType;
  declared_raw: string | null;
} {
  const value = (declared ?? '').trim();
  const normalized = value.toUpperCase();
  if (normalized === 'JURIDICA' || normalized === 'JURÍDICA' || normalized === '1') {
    return { person_type: 'JURIDICA', declared_raw: value || null };
  }
  if (normalized === 'NATURAL' || normalized === '2') {
    return { person_type: 'NATURAL', declared_raw: value || null };
  }
  const derived: ResolvedAcquirerPersonType =
    document_type_code === '31' ? 'JURIDICA' : 'NATURAL';
  return { person_type: derived, declared_raw: value || null };
}

/**
 * LA función. Ver el JSDoc de este archivo para la regla de precedencia y el
 * incidente que cierra.
 */
export function resolveAcquirerIdentity(params: {
  snapshot: AcquirerIdentitySnapshot;
  customer?: AcquirerIdentityCustomer | null;
}): ResolvedAcquirerIdentity {
  const { snapshot, customer } = params;

  const raw_document_type =
    customer?.document_type ?? snapshot.customer_document_type ?? null;
  const { literal: document_type_literal, code: document_type_code } =
    normalizeAcquirerDocumentType(raw_document_type);

  const document_number =
    (customer?.document_number ?? snapshot.customer_tax_id ?? null) || null;

  const verification_digit =
    (customer?.verification_digit ??
      snapshot.customer_verification_digit ??
      null) || null;

  const { person_type, declared_raw } = resolveAcquirerPersonType(
    customer?.person_type,
    document_type_code,
  );

  const legal_name = (customer?.legal_name ?? '').trim();
  const first_name = (customer?.first_name ?? '').trim() || null;
  const last_name = (customer?.last_name ?? '').trim() || null;
  const composed_from_customer =
    legal_name || (first_name || last_name
      ? `${first_name ?? ''} ${last_name ?? ''}`.trim()
      : '');
  const name =
    composed_from_customer || (snapshot.customer_name ?? '').trim() || null;

  const email = (customer?.email ?? snapshot.customer_email ?? null) || null;
  const phone = (customer?.phone ?? snapshot.customer_phone ?? null) || null;
  const tax_regime =
    (customer?.tax_regime ?? snapshot.customer_tax_regime ?? null) || null;

  const snapshot_responsibilities = Array.isArray(
    snapshot.customer_fiscal_responsibilities,
  )
    ? (snapshot.customer_fiscal_responsibilities as string[])
    : null;
  const tax_responsibilities = [
    ...(customer?.fiscal_responsibilities ?? snapshot_responsibilities ?? []),
  ];

  const ciiu_code = customer?.ciiu_code ?? null;
  const is_withholding_agent = customer?.is_withholding_agent ?? false;

  return {
    document_type_literal,
    document_type_code,
    document_number,
    verification_digit,
    person_type,
    person_type_raw: declared_raw,
    name,
    first_name,
    last_name,
    email,
    phone,
    tax_regime,
    tax_responsibilities,
    ciiu_code,
    is_withholding_agent,
  };
}
