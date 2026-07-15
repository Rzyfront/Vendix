import { Injectable } from '@angular/core';

/**
 * Route optimization for the dispatch (planillas de rutas) map.
 *
 * Phase 1 (this file) is a pure, dependency-free heuristic: nearest-neighbor
 * over the haversine (straight-line) distance between stops. It is intentionally
 * hidden behind {@link RouteOptimizerStrategy} so a Phase 2 OSRM implementation
 * (real road distances / turn-by-turn) can be swapped in without touching the UI.
 *
 * All calculation logic here is pure: no signals, no HTTP, no side effects. The
 * input stop objects are never mutated and are returned by reference in the new
 * order so callers keep whatever extra data they attached to each stop.
 */

/** Geographic point in decimal degrees. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A route stop with a resolvable geographic position.
 *
 * `stopId` and `sequence` mirror the dispatch stop identity so callers can map
 * the optimized order back onto their own records. Consumers may pass richer
 * objects (structural typing preserves the extra fields); the strategy returns
 * the very same object references in the reordered list.
 */
export interface GeoStop extends LatLng {
  stopId: number;
  sequence: number;
}

/** Result of an optimization pass. */
export interface OptimizedRoute {
  /** Stops in the suggested visiting order (original object references). */
  orderedStops: GeoStop[];
  /** Sum of the leg distances of the suggested order, in kilometers. */
  totalDistanceKm: number;
}

/**
 * Strategy contract for ordering stops into a suggested route.
 *
 * Implementations must be pure with respect to the inputs (no mutation of
 * `origin` or `stops`, no external side effects).
 */
export interface RouteOptimizerStrategy {
  /**
   * @param origin Starting point of the route. When `null`, the first element
   *   of `stops` is used as the starting point and contributes no leg distance.
   * @param stops  Stops to visit (any order). Not mutated.
   * @returns The reordered stops plus the accumulated leg distance in km.
   */
  optimize(origin: LatLng | null, stops: GeoStop[]): OptimizedRoute;
}

/** Mean Earth radius in kilometers used by the haversine formula. */
const EARTH_RADIUS_KM = 6371;

/**
 * Phase 1 strategy: greedy nearest-neighbor over haversine distance.
 *
 * Starting from `origin` (or the first stop when `origin` is `null`), it
 * repeatedly walks to the closest not-yet-visited stop, accumulating the
 * straight-line distance of each leg. This is a fast O(n^2) heuristic; it does
 * not guarantee the global optimum but produces a sensible short route for the
 * small stop counts a dispatch sheet contains.
 */
export class HaversineNearestNeighborStrategy implements RouteOptimizerStrategy {
  optimize(origin: LatLng | null, stops: GeoStop[]): OptimizedRoute {
    // Edge: no stops.
    if (stops.length === 0) {
      return { orderedStops: [], totalDistanceKm: 0 };
    }

    // Edge: single stop. Distance is origin -> stop when an origin exists,
    // otherwise 0 (the lone stop is itself the start).
    if (stops.length === 1) {
      const only = stops[0];
      return {
        orderedStops: [only],
        totalDistanceKm: origin ? this.haversine(origin, only) : 0,
      };
    }

    const remaining: GeoStop[] = [...stops];
    const orderedStops: GeoStop[] = [];
    let totalDistanceKm = 0;
    let current: LatLng;

    if (origin) {
      current = origin;
    } else {
      // No origin: anchor on the first stop; its arrival leg is not counted.
      const first = remaining.shift() as GeoStop;
      orderedStops.push(first);
      current = first;
    }

    while (remaining.length > 0) {
      let nearestIndex = 0;
      let nearestDistanceKm = this.haversine(current, remaining[0]);

      for (let i = 1; i < remaining.length; i++) {
        const distanceKm = this.haversine(current, remaining[i]);
        if (distanceKm < nearestDistanceKm) {
          nearestDistanceKm = distanceKm;
          nearestIndex = i;
        }
      }

      const nearest = remaining.splice(nearestIndex, 1)[0];
      orderedStops.push(nearest);
      totalDistanceKm += nearestDistanceKm;
      current = nearest;
    }

    return { orderedStops, totalDistanceKm };
  }

  /**
   * Great-circle distance between two points, in kilometers (haversine).
   * Pure function — depends only on its arguments.
   */
  haversine(a: LatLng, b: LatLng): number {
    const dLat = this.toRadians(b.lat - a.lat);
    const dLng = this.toRadians(b.lng - a.lng);
    const lat1 = this.toRadians(a.lat);
    const lat2 = this.toRadians(b.lat);

    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    // Clamp to [0, 1] to guard against floating-point drift feeding Math.asin.
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  private toRadians(degrees: number): number {
    return (degrees * Math.PI) / 180;
  }
}

/**
 * Injectable facade the UI consumes. It delegates to the configured
 * {@link RouteOptimizerStrategy}; the default is the Phase 1 haversine
 * nearest-neighbor heuristic.
 *
 * Phase 2 injection point — to move to real road distances via OSRM, swap the
 * default strategy here (and only here). The `optimize` contract stays
 * identical so no consumer changes:
 *
 * ```ts
 * // private readonly strategy: RouteOptimizerStrategy = new OsrmStrategy(this.http);
 * ```
 */
@Injectable({ providedIn: 'root' })
export class RouteOptimizerService {
  private readonly strategy: RouteOptimizerStrategy =
    new HaversineNearestNeighborStrategy();

  /**
   * Suggest a short visiting order for `stops`, optionally anchored at `origin`.
   * Delegates to the active strategy; see {@link RouteOptimizerStrategy.optimize}.
   */
  optimize(origin: LatLng | null, stops: GeoStop[]): OptimizedRoute {
    return this.strategy.optimize(origin, stops);
  }
}
