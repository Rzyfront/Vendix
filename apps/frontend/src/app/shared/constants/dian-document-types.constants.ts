/**
 * Mapping of Vendix internal document-type codes → DIAN Annex 19 schemeID.
 *
 * The UBL `cbc:ID/@schemeID` attribute MUST carry the DIAN-issued code from
 * `DIAN_ID_TYPES` (the canonical table lives in the backend provider). The DOM-side
 * identifier (CC, NIT, TI, …) travels in `@schemeName`. The verification digit
 * (DV) NEVER goes in `@schemeID` — that is the most common rejection cause and
 * is checked here to keep this file aligned with the backend contract.
 *
 * Reference: Anexo Técnico 19 — "Numeración de los documentos de identificación
 * en el XML de la factura electrónica" (Resolución DIAN 000012 de 2021).
 *
 * NOTE: This constant is the front-end mirror of
 * `apps/backend/src/domains/store/invoicing/providers/dian-direct/constants/dian-document-types.ts:DIAN_ID_TYPES`.
 * Codes are duplicated to keep the front-end bundle free of HTTP roundtrips for
 * what is essentially static data. Drift here is caught by Step 7's UBL builder
 * tests (they assert against the union of both files).
 */

/**
 * @param key One of the 10 internal codes defined in `DOCUMENT_TYPE_CODES`
 *            (CC, CE, NIT, TI, RC, PA, PEP, PPT, DIE, NUIP).
 * @returns The two-digit DIAN scheme code, or `undefined` when the code is
 *          unknown (signal to fall back to "no schemeID" in UBL emission).
 */
export const DIAN_DOCUMENT_TYPE_SCHEME_IDS: Record<string, string> = {
  CC: '13',
  CE: '22',
  NIT: '31',
  TI: '12',
  RC: '11',
  PA: '21',
  PEP: '47',
  PPT: '48',
  DIE: '42',
  NUIP: '91',
};

/**
 * Resolve the DIAN scheme code for an internal document-type code. Use this
 * instead of direct map access so callers always get a string back (or empty
 * string) and can build `<cbc:ID>` without runtime checks.
 */
export function getDianSchemeIdForDocumentType(code: string | null | undefined): string {
  if (!code) return '';
  return DIAN_DOCUMENT_TYPE_SCHEME_IDS[code.toUpperCase()] ?? '';
}

/** True only for the NIT branch (the only code with an explicit DV field). */
export function isNitCode(code: string | null | undefined): boolean {
  return code?.toUpperCase() === 'NIT';
}
