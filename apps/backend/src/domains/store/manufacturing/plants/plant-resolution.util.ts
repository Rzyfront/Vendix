/**
 * QUI-1013 — plant lookups shared by Planta (manufacturing orders) and the
 * production engine (`ProductionOrdersService.complete`, sale-linked orders).
 *
 * They take the Prisma client to use (scoped service or transaction) instead of
 * a DI service so the production module can call them without importing the
 * manufacturing module.
 */

/** Minimal client shape: a scoped service, the base client or a transaction. */
export interface PlantReader {
  manufacturing_plants: {
    findFirst(args: {
      where: Record<string, unknown>;
      orderBy?: Record<string, 'asc' | 'desc'>;
      select: Record<string, true>;
    }): Promise<Record<string, unknown> | null>;
  };
}

export interface PlantLocations {
  input_location_id: number | null;
  output_location_id: number | null;
}

/**
 * The store's main plant: the active plant with the lowest id (the one the
 * migration created from the old single plant configuration). `null` when the
 * store has no active plant.
 */
export async function findMainPlantId(
  db: PlantReader,
  store_id: number,
): Promise<number | null> {
  const row = await db.manufacturing_plants.findFirst({
    where: { store_id, is_active: true },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return row ? (row.id as number) : null;
}

/**
 * Input/output locations of the order's plant. An inactive plant still answers:
 * the order was made there. `null` when the order has no plant.
 */
export async function findPlantLocations(
  db: PlantReader,
  plant_id: number | null | undefined,
): Promise<PlantLocations | null> {
  if (plant_id == null) return null;
  const row = await db.manufacturing_plants.findFirst({
    where: { id: plant_id },
    select: { input_location_id: true, output_location_id: true },
  });
  if (!row) return null;
  return {
    input_location_id: (row.input_location_id as number | null) ?? null,
    output_location_id: (row.output_location_id as number | null) ?? null,
  };
}
