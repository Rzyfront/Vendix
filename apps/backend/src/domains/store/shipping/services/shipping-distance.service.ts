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
  /** Logger para los métodos `static` (no pueden usar `this.logger`). */
  private static readonly staticLogger = new Logger(
    ShippingDistanceService.name,
  );

  /**
   * Bbox aproximado de Colombia, usado SOLO para detectar lat/lng invertido
   * (heurística geográfica, no un límite de cobertura de negocio).
   */
  private static readonly COLOMBIA_BBOX = {
    minLat: -4.3,
    maxLat: 13.5,
    minLng: -82,
    maxLng: -66.8,
  };

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
   * Normaliza coordenadas (Decimal de Prisma, string o number): valida rango
   * WGS84, detecta y corrige lat/lng invertido, y redondea a 6 decimales
   * (~0.1 m). Es el ÚNICO punto de normalización de coordenadas — lo usan
   * tanto el cotizador (`ShippingCalculatorService`) como la confirmación
   * (`CheckoutService.resolveConfirmShippingCost`), para origen y destino
   * por igual, así que un mismo punto siempre produce las mismas coords (y
   * por lo tanto la misma llave de caché de `RoutingService`) sin importar
   * si viene del float completo de la cotización o del `Decimal(10,8)`
   * redondeado del snapshot de confirmación.
   *
   * `label` es solo para el mensaje de warn cuando se detecta un swap (p.ej.
   * `"origin"` / `"buyer"`) — no afecta el resultado.
   *
   * @returns `null` cuando no son utilizables.
   */
  static toCoords(
    latitude: unknown,
    longitude: unknown,
    label?: string,
  ): DistanceCoords | null {
    if (
      latitude == null ||
      longitude == null ||
      latitude === '' ||
      longitude === ''
    ) {
      return null;
    }
    let lat = Number(latitude);
    let lng = Number(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    // lat/lng invertido: en Colombia, lat≈4.7 y lng≈-74.1 escritos al revés
    // (lat≈-74.1, lng≈4.7) siguen cayendo cada uno dentro del rango WGS84
    // individual (-90..90 / -180..180), así que la validación de rango NO lo
    // detecta. La señal es geográfica: el par ORIGINAL cae fuera del bbox de
    // Colombia mientras el INTERCAMBIADO sí cae dentro. Esto también cubre
    // el caso |lat| > 90 (literalmente inválido como latitud): el bbox de
    // Colombia es mucho más angosto que el rango WGS84, así que un valor
    // fuera de rango solo "corrige" si el intercambio aterriza en Colombia;
    // si no, sigue cayendo en el `return null` de más abajo.
    if (
      !ShippingDistanceService.isWithinColombiaBbox(lat, lng) &&
      ShippingDistanceService.isWithinColombiaBbox(lng, lat)
    ) {
      ShippingDistanceService.staticLogger.warn(
        `lat/lng invertido detectado${label ? ` (${label})` : ''}: ` +
          `(${lat}, ${lng}) fuera del bbox de Colombia, (${lng}, ${lat}) sí — se corrige intercambiando`,
      );
      [lat, lng] = [lng, lat];
    }

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return null;
    }
    return {
      latitude: ShippingDistanceService.round6(lat),
      longitude: ShippingDistanceService.round6(lng),
    };
  }

  /** `true` cuando `(lat, lng)` cae dentro del bbox aproximado de Colombia. */
  private static isWithinColombiaBbox(lat: number, lng: number): boolean {
    const b = ShippingDistanceService.COLOMBIA_BBOX;
    return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
  }

  /** Redondea a 6 decimales (~0.1 m de precisión GPS). */
  private static round6(value: number): number {
    return Math.round(value * 1e6) / 1e6;
  }

  /**
   * Distancia real por calles (km) entre el origen del método y el comprador,
   * vía `RoutingService` (Valhalla costing `auto` estándar + fallback OSRM
   * (primera ruta) + caché Redis).
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
