export interface MovementDirectionInput {
  from_location_id?: number | null;
  to_location_id?: number | null;
  movement_type?: string;
}

/** Types that can only represent an outbound movement in legacy rows. */
const OUTBOUND_ONLY_TYPES = new Set<string>([
  'stock_out',
  'sale',
  'damage',
  'expiration',
  'consumption',
]);

/**
 * Determines whether a movement adds stock to the affected location.
 * Location legs take precedence; legacy rows without a source leg use type.
 */
export function isInboundMovement(
  movement: MovementDirectionInput | null | undefined,
): boolean {
  const from = movement?.from_location_id ?? null;
  const to = movement?.to_location_id ?? null;

  if (from != null && to == null) return false;
  if (from != null && to != null) return true;

  return !OUTBOUND_ONLY_TYPES.has(movement?.movement_type ?? '');
}
