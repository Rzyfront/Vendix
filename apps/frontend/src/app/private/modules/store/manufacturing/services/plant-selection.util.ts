/**
 * QUI-1013 — pure rules for choosing a plant (order form, production session).
 * Kept free of Angular so they are tested directly.
 */

export interface PlantRef {
  id: number;
  name: string;
  is_active: boolean;
  is_main?: boolean;
}

const SESSION_STORAGE_PREFIX = 'vendix_manufacturing_plant_session';

/** localStorage key of the last plant used in the production session of a store. */
export function plantSessionStorageKey(storeId: number | null): string | null {
  return storeId == null ? null : `${SESSION_STORAGE_PREFIX}:${storeId}`;
}

export function activePlants<T extends PlantRef>(plants: readonly T[]): T[] {
  return plants.filter((p) => p.is_active).sort((a, b) => a.id - b.id);
}

/** The main plant: the one flagged by the API, else the first active by id. */
export function mainPlantId(plants: readonly PlantRef[]): number | null {
  const active = activePlants(plants);
  return (active.find((p) => p.is_main) ?? active[0])?.id ?? null;
}

function parseId(raw: string | null | undefined): number | null {
  if (raw == null || raw === '') return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Plant whose orders the production session shows.
 * - 0 or 1 active plant → `null`: no filter, the whole store as before.
 * - several → the `?plant_id=` of the URL, else the last one used on this
 *   device, else the main plant; an id that is not an active plant is ignored.
 */
export function resolveSessionPlantId(
  plants: readonly PlantRef[],
  fromQuery: string | null,
  fromStorage: string | null,
): number | null {
  const active = activePlants(plants);
  if (active.length <= 1) return null;
  const valid = (id: number | null) => (id != null && active.some((p) => p.id === id) ? id : null);
  return valid(parseId(fromQuery)) ?? valid(parseId(fromStorage)) ?? mainPlantId(active);
}

/** A new order with exactly one active plant gets it without asking. */
export function autoOrderPlantId(plants: readonly PlantRef[]): number | null {
  const active = activePlants(plants);
  return active.length === 1 ? active[0].id : null;
}

/** With several active plants the order form must ask which one. */
export function isOrderPlantRequired(plants: readonly PlantRef[]): boolean {
  return activePlants(plants).length > 1;
}

/**
 * Options of the order plant selector: the active plants, plus the order's
 * current plant when it was deactivated later (so editing does not lose it).
 */
export function orderPlantOptions(
  plants: readonly PlantRef[],
  currentPlantId: number | null,
): Array<{ value: number; label: string }> {
  const options = activePlants(plants).map((p) => ({ value: p.id, label: p.name }));
  if (currentPlantId != null && !options.some((o) => o.value === currentPlantId)) {
    const current = plants.find((p) => p.id === currentPlantId);
    if (current) options.push({ value: current.id, label: `${current.name} (inactiva)` });
  }
  return options;
}

/**
 * `plant_id` the order form sends: on create, the chosen plant (none lets the
 * API assign the only active one); on edit, only a changed plant, so an order
 * of a plant deactivated later can still be edited without moving it.
 */
export function orderPlantIdToSend(
  selected: number | null,
  original: number | null,
  editing: boolean,
): number | undefined {
  if (selected == null) return undefined;
  if (editing && selected === original) return undefined;
  return selected;
}
