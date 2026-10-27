import { lodging_housekeeping_status_enum } from '@prisma/client';

export type HousekeepingStatus = lodging_housekeeping_status_enum;

/**
 * Hospitality Suite (H5.1) — housekeeping states a room cannot be sold or
 * assigned in. Availability, the rack, room moves and check-in read this
 * list, so taking a room out of service removes it from the sale at once.
 */
export const UNSELLABLE_HOUSEKEEPING_STATUSES: readonly HousekeepingStatus[] = [
  'out_of_order',
  'out_of_service',
];

export function isSellableHousekeeping(status: string): boolean {
  return !UNSELLABLE_HOUSEKEEPING_STATUSES.includes(status as HousekeepingStatus);
}

/**
 * Allowed housekeeping moves. A dirty room is cleaned before it can be
 * inspected; any room can be taken out of service, and it comes back dirty
 * (to clean after the repair) or clean.
 */
export const HOUSEKEEPING_TRANSITIONS: Readonly<
  Record<HousekeepingStatus, readonly HousekeepingStatus[]>
> = {
  dirty: ['clean', 'out_of_order', 'out_of_service'],
  clean: ['inspected', 'dirty', 'out_of_order', 'out_of_service'],
  inspected: ['dirty', 'out_of_order', 'out_of_service'],
  out_of_order: ['dirty', 'clean', 'out_of_service'],
  out_of_service: ['dirty', 'clean', 'out_of_order'],
};

export function canChangeHousekeeping(
  from: HousekeepingStatus,
  to: HousekeepingStatus,
): boolean {
  return HOUSEKEEPING_TRANSITIONS[from]?.includes(to) ?? false;
}

export const HOUSEKEEPING_STATUS_LABELS: Readonly<Record<HousekeepingStatus, string>> = {
  clean: 'Limpia',
  dirty: 'Sucia',
  inspected: 'Inspeccionada',
  out_of_order: 'Fuera de servicio',
  // Not "Bloqueada": a dated block (H5.3) is a different thing, seen on the rack.
  out_of_service: 'No disponible',
};

/**
 * Separation of duties: the housekeeper cleans, the head housekeeper
 * inspects (H5.2), and taking a room out of the sale is for whoever manages
 * the housekeeping or the room inventory (H5.3). Any one listed permission
 * allows the move; statuses without an entry only need `housekeeping:operate`.
 */
export const HOUSEKEEPING_STATUS_PERMISSIONS: Readonly<
  Partial<Record<HousekeepingStatus, readonly string[]>>
> = {
  inspected: ['store:lodging:housekeeping:assign'],
  out_of_order: ['store:lodging:housekeeping:assign', 'store:lodging:inventory:write'],
  out_of_service: ['store:lodging:housekeeping:assign', 'store:lodging:inventory:write'],
};
