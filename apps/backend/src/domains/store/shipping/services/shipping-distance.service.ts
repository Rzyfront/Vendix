import { Injectable, Logger, Optional } from '@nestjs/common';
import { RoutingService } from '../../../ecommerce/routing/routing.service';

/** Un tramo de la escala de km (`shipping_rates.distance_tiers`). */
export interface DistanceTier {
  from_km: number;
  /** `null` = tramo abierto (solo válido al final de la escala). */
  to_km: number | null;
  price: number;
}

export interface DistanceCoords {
  latitude: number;
  longitude: number;
}

/**
 * Resolver compartido del cobro por distancia (cotizador + confirmación).
 *
 * Contrato: la zona autoriza (cobertura), la distancia precio. Todo fallo
 * (sin coords, sin origen, escala corrupta, motor caído) degrada a precio de
 * zona (fail-open) y nunca rompe el checkout; solo la distancia fuera de
 * todos los rangos excluye la tarifa.
 */
@Injectable()
export class ShippingDistanceService {
  private readonly logger = new Logger(ShippingDistanceService.name);

  constructor(@Optional() private readonly routing?: RoutingService) {}

  /**
   * Matcher puro: primer tramo con `from_km <= d` y (`to_km == null` o
   * `d < to_km`). Los tramos se asumen ordenados (ver `parseTiers`).
   */
  static matchTier(
    tiers: DistanceTier[],
    distanceKm: number,
  ): DistanceTier | null {
    for (const tier of tiers) {
      if (
        distanceKm >= tier.from_km &&
        (tier.to_km == null || distanceKm < tier.to_km)
      ) {
        return tier;
      }
    }
    return null;
  }

  /**
   * Normaliza el JSON crudo de `distance_tiers` a tramos ordenados, o `null`
   * cuando no hay escala utilizable (ausente, vacía o corrupta → rige zona).
   */
  static parseTiers(raw: unknown): DistanceTier[] | null {
    if (!Array.isArray(raw) || raw.length === 0) return null;
    const tiers: DistanceTier[] = [];
    for (const item of raw) {
      const candidate = item as Partial<DistanceTier> | null;
      const from_km = Number(candidate?.from_km);
      const price = Number(candidate?.price);
      const toRaw = candidate?.to_km;
      const to_km = toRaw == null ? null : Number(toRaw);
      if (
        candidate == null ||
        !Number.isFinite(from_km) ||
        from_km < 0 ||
        !Number.isFinite(price) ||
        price < 0 ||
        (to_km != null && (!Number.isFinite(to_km) || to_km <= from_km))
      ) {
        return null;
      }
      tiers.push({ from_km, to_km, price });
    }
    tiers.sort((a, b) => a.from_km - b.from_km);
    return tiers;
  }

  /**
   * Normaliza coordenadas (Decimal de Prisma, string o number) con rangos
   * WGS84, o `null` cuando no son utilizables.
   */
  static toCoords(
    latitude: unknown,
    longitude: unknown,
  ): DistanceCoords | null {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (
      latitude == null ||
      longitude == null ||
      latitude === '' ||
      longitude === '' ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return null;
    }
    return { latitude: lat, longitude: lng };
  }

  /**
   * Distancia real por calles (km) entre el origen del método y el comprador,
   * vía `RoutingService` (Valhalla shortest + fallback OSRM + caché Redis).
   * `null` ante cualquier fallo: el llamador cobra zona.
   */
  async resolveDistanceKm(
    origin: DistanceCoords,
    buyer: DistanceCoords,
  ): Promise<number | null> {
    if (!this.routing) return null;
    try {
      const result = await this.routing.directions(
        `${origin.longitude},${origin.latitude};${buyer.longitude},${buyer.latitude}`,
      );
      if (!Number.isFinite(result?.distance_m) || result.distance_m < 0) {
        return null;
      }
      return result.distance_m / 1000;
    } catch (err) {
      this.logger.warn(
        `Ruteo origen→comprador falló, se cobra zona: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /**
   * Precio por distancia para UNA tarifa: `{ price }` cuando la escala aplica,
   * `{ excluded: true }` cuando la distancia cae fuera de todos los rangos
   * (la tarifa no se ofrece), `null` cuando rige el precio de zona.
   */
  resolveRatePrice(
    distanceTiers: unknown,
    distanceKm: number | null,
  ): { price: number } | { excluded: true } | null {
    const tiers = ShippingDistanceService.parseTiers(distanceTiers);
    if (!tiers || distanceKm == null || !Number.isFinite(distanceKm)) {
      return null;
    }
    const tier = ShippingDistanceService.matchTier(tiers, distanceKm);
    if (!tier) return { excluded: true };
    return { price: tier.price };
  }
}
