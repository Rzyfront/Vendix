import { PrismaClient } from '@prisma/client';
import { getPrismaClient } from './shared/client';

export interface SeedSystemShippingMethodsResult {
  methodsCreated: number;
  methodsSkipped: number;
}

/**
 * DEPENDENCIES: This seed function has no dependencies.
 * Can be run independently at any time.
 *
 * Creates system-wide shipping methods available to all stores.
 * Stores activate them via the admin "Activar" button, which copies
 * the system method into the store's namespace along with any
 * pre-configured zones and rates.
 *
 * Mirrors the production state at `vendix.online` so fresh local
 * environments (`vendix.com`) have the same starting point.
 */
export async function seedSystemShippingMethods(
  prisma?: PrismaClient,
): Promise<SeedSystemShippingMethodsResult> {
  const client = prisma || getPrismaClient();

  // Stable identifiers (lowercase, snake_case). The `name` is what shows
  // up in the admin UI as the method label; `code` is an optional
  // short tag for internal use.
  const systemMethods = [
    {
      name: 'Entrega Rápida Local',
      code: 'own_fleet_local',
      type: 'own_fleet' as const,
      description:
        'Entrega local usando flota propia. Ideal para zonas metropolitanas y entregas dentro de la misma ciudad.',
      min_days: 0,
      max_days: 1,
      transit_time_minutes: 240, // ~4h same-day
      display_order: 0,
    },
    {
      name: 'Envío Nacional',
      code: 'national_shipping',
      type: 'carrier' as const,
      description:
        'Envío a nivel nacional mediante transportadora. Tiempo de entrega según la distancia al destino.',
      min_days: 2,
      max_days: 15,
      transit_time_minutes: 0, // depends on destination
      display_order: 1,
    },
    {
      name: 'Recoger En Tienda',
      code: 'pickup_in_store',
      type: 'pickup' as const,
      description:
        'El cliente recoge su pedido directamente en la tienda. Sin costo de envío.',
      min_days: 0,
      max_days: 1,
      transit_time_minutes: 0, // instant pickup
      display_order: 2,
    },
  ];

  let methodsCreated = 0;
  let methodsSkipped = 0;

  for (const method of systemMethods) {
    // Idempotency: skip if a system method with the same name already exists.
    // We match on `name` (stable label) and `store_id IS NULL` (system-wide).
    const existing = await client.shipping_methods.findFirst({
      where: {
        name: method.name,
        store_id: null,
      },
      select: { id: true },
    });

    if (existing) {
      methodsSkipped++;
      continue;
    }

    await client.shipping_methods.create({
      data: {
        ...method,
        is_active: true,
        is_system: true,
        store_id: null,
      },
    });
    methodsCreated++;
  }

  return {
    methodsCreated,
    methodsSkipped,
  };
}
