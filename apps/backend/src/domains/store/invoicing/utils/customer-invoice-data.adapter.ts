import { ProviderInvoiceData } from '../providers/invoice-provider.interface';

/**
 * Minimal shape of a customer row needed to produce the
 * `ProviderInvoiceData.customer_*` fields consumed by the DIAN provider.
 *
 * Built to match what `INVOICE_INCLUDE` (invoice-flow.service.ts) selects from
 * `users` plus the related `addresses` relation — the adapter does NOT fetch
 * anything itself; it only maps what the calling site already loaded.
 *
 * The shape is deliberately loose on `addresses` because the only contract is
 * "give me back the primary address" — the provider normalizes whatever it
 * receives through `normalizeAddress(...)` against the field names below.
 *
 * `fiscal_responsibilities` is an array of RUT codes ('O-13', 'O-15', 'R-99-PN'
 * …). `verification_digit` is the separated NIT DV; it lives in its own column
 * since Step 1 so the UBL builder can emit `<cbc:ID>NIT-DV</cbc:ID>` per Anexo
 * 19 without re-deriving it from a concatenated string.
 */
/**
 * El `select` de Prisma que produce EXACTAMENTE un {@link CustomerForInvoice}.
 *
 * Vive junto al tipo que describe, y no junto a la consulta que lo usa, porque
 * ya lo usan DOS consultas: la que carga la factura para emitir
 * (`INVOICE_INCLUDE` en `invoice-flow.service.ts`) y la que proyecta un
 * borrador para validarlo antes de numerar
 * (`InvoicingService.buildDraftProjection`). Cuando cada una llevaba su propia
 * lista, la segunda cargaba cuatro campos —id, nombre, apellido, correo— y la
 * puerta de identidad juzgaba a un adquiriente sin documento, sin régimen y sin
 * responsabilidades fiscales: aprobaba borradores que la emisión rechaza.
 *
 * `addresses` trae SÓLO la principal: es la única que el adaptador copia a
 * `customer_address`, y pedir más sería alcance desperdiciado en cada `send()`.
 */
export const CUSTOMER_FOR_INVOICE_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  legal_name: true,
  email: true,
  phone: true,
  document_type: true,
  document_number: true,
  verification_digit: true,
  tax_regime: true,
  person_type: true,
  fiscal_responsibilities: true,
  ciiu_code: true,
  is_withholding_agent: true,
  addresses: { take: 1, orderBy: { is_primary: 'desc' } },
} as const;

export interface CustomerForInvoice {
  id: number;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  person_type: string | null;
  tax_regime: string | null;
  fiscal_responsibilities: string[];
  ciiu_code: string | null;
  is_withholding_agent: boolean;
  email: string | null;
  phone: string | null;
  addresses: CustomerForInvoiceAddress[];
}

export interface CustomerForInvoiceAddress {
  address_line1?: string;
  address_line2?: string | null;
  city?: string;
  state_province?: string | null;
  country_code?: string;
  postal_code?: string | null;
  municipality_code?: string | null;
  phone_number?: string | null;
  is_primary?: boolean;
}

/**
 * Structural Pick of `ProviderInvoiceData` restricted to the customer-prefixed
 * fields. The adapter's return type is built from this so:
 *
 *   1. Renaming a `customer_*` field on the provider interface causes a
 *      compile error HERE (the seam) instead of inside `send()` — the adapter
 *      is the only file that needs to react.
 *   2. Callers can spread the result into a `ProviderInvoiceData` literal
 *      without TypeScript widening the optionals back to `undefined`.
 */
export type ProviderCustomerFields = Pick<
  ProviderInvoiceData,
  | 'customer_name'
  | 'customer_tax_id'
  | 'customer_email'
  | 'customer_phone'
  | 'customer_document_type'
  | 'customer_verification_digit'
  | 'customer_person_type'
  | 'customer_regime'
  | 'customer_tax_responsibilities'
  | 'customer_ciiu_code'
  | 'customer_is_withholding_agent'
  | 'customer_address'
>;

/**
 * Maps a customer row (from the `users` table + primary address) into the
 * `ProviderInvoiceData.customer_*` shape that `dian-direct.provider.ts`
 * consumes.
 *
 * The mapping is intentionally a 1:1 between customer columns and provider
 * fields — no business logic, no DIAN schemeID conversion here. That belongs
 * to `UblCommonBuilder.buildCustomerParty` (the Anexo 19 site) where DIAN rules
 * already live. This adapter is the SHAPE seam, not the policy seam.
 *
 * `document_type` is forwarded as the literal enum string ('NIT', 'CC', …);
 * the provider keeps the literal so `@schemeName` can carry the canonical name
 * and only translates to the DIAN scheme code via `DIAN_ID_TYPES` inside the
 * UBL builder. `person_type` is also forwarded as the new enum string
 * ('NATURAL' | 'JURIDICA'); the existing `translatePersonTypeToStructural` on
 * the provider converts it into the `cbc:AdditionalAccountID` legacy code.
 *
 * `customer_address` resolves from `addresses[0]` (the primary one — caller is
 * expected to `orderBy: { is_primary: 'desc' }` and `take: 1` to keep this
 * selection cheap and consistent with the rest of the codebase).
 */
export function toCustomerInvoiceData(
  c: CustomerForInvoice,
): ProviderCustomerFields {
  // `customer_name` follows the RUT convention: legal_name for a JURIDICA,
  // concatenation of personal names otherwise. Falls back to whichever is
  // populated when `person_type` is null — the UBL builder derives a structural
  // selector from the document type for that case.
  const trimmed_first = c.first_name?.trim() ?? '';
  const trimmed_last = c.last_name?.trim() ?? '';
  const composed_name =
    c.legal_name?.trim() ||
    `${trimmed_first} ${trimmed_last}`.trim() ||
    null;

  return {
    customer_name: composed_name ?? undefined,
    customer_tax_id: c.document_number ?? undefined,
    customer_email: c.email ?? undefined,
    customer_phone: c.phone ?? undefined,
    customer_document_type: c.document_type ?? undefined,
    customer_verification_digit: c.verification_digit ?? undefined,
    // Keep `person_type` as the new enum string ('NATURAL' | 'JURIDICA');
    // `DianDirectProvider.translatePersonTypeToStructural` translates to the
    // legacy '1'/'2' code consumed by the UBL builder.
    customer_person_type: c.person_type ?? undefined,
    customer_regime: c.tax_regime ?? undefined,
    customer_tax_responsibilities: c.fiscal_responsibilities ?? [],
    customer_ciiu_code: c.ciiu_code ?? null,
    customer_is_withholding_agent: c.is_withholding_agent ?? false,
    customer_address: c.addresses?.[0] ?? undefined,
  };
}
