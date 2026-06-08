/**
 * NIT normalization + DV-tolerant matching between a fiscal entity NIT and the
 * tax id extracted from a DIAN digital certificate.
 *
 * Background: a fiscal entity stores its NIT as the base number (e.g.
 * `902056589`) plus a separate verification digit / dígito de verificación
 * (`nit_dv`, e.g. `9`). DIAN "persona jurídica" signing certificates frequently
 * embed the NIT in the `serialNumber` subject attribute **with the DV appended**
 * (e.g. `9020565899`). A strict equality check therefore rejects a certificate
 * that genuinely belongs to the entity. This matcher accepts the match while
 * still blocking certificates issued for a different NIT.
 */

/** Strips every non-digit character; returns `''` when there is nothing left. */
export function normalizeNitDigits(value?: string | null): string {
  return String(value ?? '').replace(/\D/g, '');
}

/**
 * Returns true when the certificate tax id corresponds to the fiscal entity
 * NIT, tolerating the verification digit (DV) on either side.
 *
 * Accepted shapes (after digit-only normalization):
 * - `cert === base`                  → both without DV
 * - `cert === base + dv`             → cert embeds the known DV
 * - `cert === base + <one digit>`    → cert embeds an (unknown) trailing DV
 * - `base === cert + <one digit>`    → defensive reverse (stored value carried a DV)
 */
export function certificateNitMatches(params: {
  certificateTaxId?: string | null;
  nit?: string | null;
  dv?: string | null;
}): boolean {
  const cert = normalizeNitDigits(params.certificateTaxId);
  const base = normalizeNitDigits(params.nit);
  const dv = normalizeNitDigits(params.dv);

  if (!cert || !base) return false;
  if (cert === base) return true;
  if (dv && cert === base + dv) return true;
  if (cert.length === base.length + 1 && cert.startsWith(base)) return true;
  if (base.length === cert.length + 1 && base.startsWith(cert)) return true;
  return false;
}
