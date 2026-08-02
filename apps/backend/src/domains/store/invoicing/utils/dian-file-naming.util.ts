/**
 * File naming for the documents delivered to DIAN inside a ZIP batch.
 *
 * ⚠️ NOT VERIFIED AGAINST AN OFFICIAL SOURCE. The DIAN technical annex (v1.9)
 * is distributed as a PDF whose text could not be extracted, and the format
 * returned by public searches (`face_f…xml` / `mft_f…zip`) belongs to
 * Resolución 19 de 2016 — the previous FTP-based model, not the current
 * pre-validation model used here.
 *
 * The shape below follows the convention documented for pre-validation:
 *   XML: <tag><nit(10)><consecutive(8, hex)>.xml   e.g. fv90207573800000000a.xml
 *   ZIP: z<nit(10)><consecutive(8, hex)>.zip
 *
 * It replaces the previous literals (`test_set.zip`, `SETP990000050.xml`), which
 * were invented by us and are a candidate cause of batches that DIAN acknowledges
 * with a ZipKey but never classifies.
 *
 * TO VERIFY: download the valid-examples ZIP from the habilitación portal
 * (catalogo-vpfe-hab.dian.gov.co) and compare the names produced here, one by
 * one, against the official ones. This module is the only place to change.
 */

/** Document tags DIAN uses to classify each XML inside the batch. */
export const DIAN_FILE_TAGS = {
  invoice: 'fv',
  credit_note: 'nc',
  debit_note: 'nd',
} as const;

export type DianDocumentKind = keyof typeof DIAN_FILE_TAGS;

/** NIT padded to the 10 digits the naming convention expects, DV excluded. */
function normalizeNit(nit: string): string {
  return nit.replace(/\D/g, '').slice(0, 10).padStart(10, '0');
}

/** Consecutive rendered as 8 lowercase hex digits, right-aligned with zeros. */
function normalizeConsecutive(consecutive: number | string): string {
  const numeric =
    typeof consecutive === 'number' ? consecutive : parseInt(consecutive, 10);
  const safe = Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  return safe.toString(16).toLowerCase().slice(-8).padStart(8, '0');
}

/**
 * Name of a single document XML inside the batch.
 * `consecutive` is the document number WITHOUT the resolution prefix.
 */
export function buildDianXmlFileName(
  kind: DianDocumentKind,
  nit: string,
  consecutive: number | string,
): string {
  return `${DIAN_FILE_TAGS[kind]}${normalizeNit(nit)}${normalizeConsecutive(consecutive)}.xml`;
}

/**
 * Name of the ZIP container. `consecutive` should be the first document of the
 * batch, so the container is traceable back to its contents.
 */
export function buildDianZipFileName(
  nit: string,
  consecutive: number | string,
): string {
  return `z${normalizeNit(nit)}${normalizeConsecutive(consecutive)}.zip`;
}
