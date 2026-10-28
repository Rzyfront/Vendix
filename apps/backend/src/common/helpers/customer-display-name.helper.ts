/**
 * Display name of a customer, tolerant to JURIDICA (legal entity) customers.
 *
 * A JURIDICA customer only carries `legal_name` (razón social); its
 * `first_name`/`last_name` stay NULL. Snapshots built from
 * `first_name + last_name` alone (dispatch notes, route stops, prints) ended
 * up empty for those customers. Mirrors the frontend
 * `shared/utils/customer-display-name.util.ts` resolution order:
 *   1. `legal_name`
 *   2. `first_name` + `last_name`
 *   3. `fallback` (empty string by default)
 */
export interface CustomerNameSource {
  legal_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export function customerDisplayName(
  customer: CustomerNameSource | null | undefined,
  fallback = '',
): string {
  if (!customer) return fallback;

  const legalName = customer.legal_name?.trim();
  if (legalName) return legalName;

  const fullName = [customer.first_name, customer.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(' ');

  return fullName || fallback;
}

/**
 * Snapshot `customer_name` with a live fallback: notes created before the
 * snapshot learned `legal_name` persisted an empty name for JURIDICA
 * customers, so reads resolve it from the linked customer when blank.
 */
export function resolveCustomerSnapshotName(
  snapshot: string | null | undefined,
  customer: CustomerNameSource | null | undefined,
): string {
  return snapshot?.trim() || customerDisplayName(customer);
}
