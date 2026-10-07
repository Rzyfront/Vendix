import type { KitchenMode } from '../settings/interfaces/store-settings.interface';

export type { KitchenMode };

/**
 * Normaliza el valor crudo de `restaurant.kitchen_mode`. Devuelve 'physical'
 * SOLO si el valor es exactamente 'physical'; cualquier otra cosa (ausente,
 * null, basura) es 'virtual'. Nunca physical por defecto.
 */
export function normalizeKitchenMode(raw: unknown): KitchenMode {
  return raw === 'physical' ? 'physical' : 'virtual';
}

/**
 * Lee `store_settings.settings.restaurant.kitchen_mode` de la tienda.
 * `client` puede ser un `tx` o un servicio prisma con scope. Usa `findFirst`
 * (no `findUnique`) por la regla de scoped unique operations.
 */
export async function resolveKitchenMode(
  client: any,
  store_id: number,
): Promise<KitchenMode> {
  const row = await client.store_settings.findFirst({
    where: { store_id },
    select: { settings: true },
  });
  return normalizeKitchenMode((row?.settings as any)?.restaurant?.kitchen_mode);
}
