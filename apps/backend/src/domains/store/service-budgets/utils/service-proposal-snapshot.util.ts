import { createHash } from 'crypto';

/**
 * JSON canónico (claves ordenadas, arreglos estables). DEBE ser idéntico al
 * verificador `verifyProposalSnapshot` de
 * ecommerce/service-sessions/service-session-access.service.ts: el hash que se
 * guarda al crear la propuesta se recalcula allá para mostrarla al cliente.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export interface ProposalSnapshotInput {
  items: Array<Record<string, unknown>>;
  subtotal: string;
  tax: string;
  discount: string;
  currency: string;
  total: string;
  /** `expires_at` en ISO, igual que lo serializa el verificador. */
  expires_at: string;
  budget_snapshot: Record<string, unknown>;
}

/**
 * sha256 del snapshot que `decideWithToken` exige (`snapshot_hash`) y que el
 * progreso público recalcula antes de mostrar la propuesta. Montos con 2
 * decimales (`toFixed(2)`) igual que el verificador.
 */
export function buildProposalSnapshotHash(input: ProposalSnapshotInput): string {
  const storedLines = { items: input.items, budget_snapshot: input.budget_snapshot };
  return createHash('sha256')
    .update(
      canonicalJson({
        lines: input.items,
        subtotal: input.subtotal,
        tax: input.tax,
        discount: input.discount,
        currency: input.currency,
        total: input.total,
        expires_at: input.expires_at,
        budget_snapshot: storedLines,
      }),
    )
    .digest('hex');
}
