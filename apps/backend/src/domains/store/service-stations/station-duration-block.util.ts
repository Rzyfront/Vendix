import { ErrorCodes, VendixHttpException } from '../../../common/errors';

/** Fields of a service that decide whether its duration must follow a station block. */
export interface DurationBlockProduct {
  service_duration_minutes?: number | null;
  rental_pricing_mode?: string | null;
}

export interface BlockStation {
  name: string;
  rental_block_minutes?: number | null;
}

/** Minimal read surface of the store-scoped prisma client used by the query wrappers. */
interface LinkReader {
  service_station_services: { findMany: (args: any) => Promise<any[]> };
}

const STATION_RATE = 'station_rate';

/**
 * Only `station_rate` services are priced per station block, so only they must
 * last a whole number of blocks. Anything without a positive duration or block
 * is not validated.
 */
export function findDurationBlockMismatch(
  product: DurationBlockProduct,
  stations: BlockStation[],
): { station: string; blockMinutes: number; durationMinutes: number } | null {
  const duration = product.service_duration_minutes;
  if (product.rental_pricing_mode !== STATION_RATE) return null;
  if (!duration || duration <= 0) return null;
  for (const station of stations) {
    const block = station.rental_block_minutes;
    if (block && block > 0 && duration % block !== 0) {
      return { station: station.name, blockMinutes: block, durationMinutes: duration };
    }
  }
  return null;
}

/** Pure check: throws STATION_017 naming the first station whose block does not divide the duration. */
export function assertDurationFitsBlocks(
  product: DurationBlockProduct,
  stations: BlockStation[],
): void {
  const mismatch = findDurationBlockMismatch(product, stations);
  if (!mismatch) return;
  throw new VendixHttpException(
    ErrorCodes.STATION_017,
    `La duración del servicio (${mismatch.durationMinutes} min) debe ser múltiplo del bloque de la estación «${mismatch.station}» (${mismatch.blockMinutes} min).`,
  );
}

/** A product against every station it is linked to (product save). */
export async function assertProductFitsLinkedStations(
  prisma: LinkReader,
  storeId: number,
  productId: number,
  product: DurationBlockProduct,
): Promise<void> {
  if (product.rental_pricing_mode !== STATION_RATE) return;
  const links = await prisma.service_station_services.findMany({
    where: { store_id: storeId, product_id: productId },
    select: { station: { select: { name: true, rental_block_minutes: true } } },
  });
  assertDurationFitsBlocks(
    product,
    (links ?? []).map((link) => link.station).filter(Boolean),
  );
}

/** A station against every station_rate service linked to it (block change). */
export async function assertStationFitsLinkedServices(
  prisma: LinkReader,
  storeId: number,
  station: { id: number; name: string; rental_block_minutes: number | null },
): Promise<void> {
  if (!station.rental_block_minutes) return;
  const links = await prisma.service_station_services.findMany({
    where: { store_id: storeId, station_id: station.id, product: { rental_pricing_mode: STATION_RATE } },
    select: { product: { select: { service_duration_minutes: true, rental_pricing_mode: true } } },
  });
  for (const link of links ?? []) {
    if (link.product) assertDurationFitsBlocks(link.product, [station]);
  }
}
