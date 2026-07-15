import { TestBed } from '@angular/core/testing';

import {
  GeoStop,
  HaversineNearestNeighborStrategy,
  LatLng,
  RouteOptimizerService,
} from './route-optimizer.service';

/**
 * Fixed set of 4 stops laid out on a straight east-bound line at increasing
 * longitude. Fed to the optimizer in a scrambled order so the nearest-neighbor
 * walk from the origin must actively reorder them into ascending distance.
 */
const ORIGIN: LatLng = { lat: 0, lng: 0 };

const STOP_A: GeoStop = { stopId: 1, sequence: 1, lat: 0, lng: 0.1 };
const STOP_B: GeoStop = { stopId: 2, sequence: 2, lat: 0, lng: 0.2 };
const STOP_C: GeoStop = { stopId: 3, sequence: 3, lat: 0, lng: 0.3 };
const STOP_D: GeoStop = { stopId: 4, sequence: 4, lat: 0, lng: 0.4 };

// Scrambled input order: C, A, D, B.
const SCRAMBLED_STOPS: GeoStop[] = [STOP_C, STOP_A, STOP_D, STOP_B];

/** Sums the leg distances of visiting `stops` in the given order from `origin`. */
function totalDistanceForOrder(
  strategy: HaversineNearestNeighborStrategy,
  origin: LatLng,
  stops: GeoStop[],
): number {
  let total = 0;
  let current: LatLng = origin;
  for (const stop of stops) {
    total += strategy.haversine(current, stop);
    current = stop;
  }
  return total;
}

describe('HaversineNearestNeighborStrategy', () => {
  let strategy: HaversineNearestNeighborStrategy;

  beforeEach(() => {
    strategy = new HaversineNearestNeighborStrategy();
  });

  it('orders the scrambled stops by nearest neighbor from the origin', () => {
    const result = strategy.optimize(ORIGIN, SCRAMBLED_STOPS);

    expect(result.orderedStops.map((s) => s.stopId)).toEqual([1, 2, 3, 4]);
    // Returns the original object references, not copies.
    expect(result.orderedStops[0]).toBe(STOP_A);
    expect(result.orderedStops[3]).toBe(STOP_D);
  });

  it('produces a positive total no worse than the input order', () => {
    const result = strategy.optimize(ORIGIN, SCRAMBLED_STOPS);
    const inputOrderTotal = totalDistanceForOrder(
      strategy,
      ORIGIN,
      SCRAMBLED_STOPS,
    );

    expect(result.totalDistanceKm).toBeGreaterThan(0);
    expect(result.totalDistanceKm).toBeLessThanOrEqual(inputOrderTotal);
  });

  it('does not mutate the input stops array', () => {
    const input = [...SCRAMBLED_STOPS];
    strategy.optimize(ORIGIN, input);
    expect(input).toEqual([STOP_C, STOP_A, STOP_D, STOP_B]);
  });

  it('returns an empty route for 0 stops', () => {
    const result = strategy.optimize(ORIGIN, []);
    expect(result.orderedStops).toEqual([]);
    expect(result.totalDistanceKm).toBe(0);
  });

  it('handles a single stop with an origin (distance = origin -> stop)', () => {
    const result = strategy.optimize(ORIGIN, [STOP_A]);
    expect(result.orderedStops).toEqual([STOP_A]);
    expect(result.totalDistanceKm).toBeCloseTo(
      strategy.haversine(ORIGIN, STOP_A),
      6,
    );
    expect(result.totalDistanceKm).toBeGreaterThan(0);
  });

  it('handles a single stop without an origin (distance = 0)', () => {
    const result = strategy.optimize(null, [STOP_A]);
    expect(result.orderedStops).toEqual([STOP_A]);
    expect(result.totalDistanceKm).toBe(0);
  });

  it('anchors on the first stop when origin is null (first leg not counted)', () => {
    const result = strategy.optimize(null, SCRAMBLED_STOPS);
    // Walk starts at STOP_C (first element); nearest to C is B (0.2) then A/D.
    expect(result.orderedStops[0]).toBe(STOP_C);
    expect(result.orderedStops.length).toBe(4);
    expect(result.totalDistanceKm).toBeGreaterThan(0);
    // Distance excludes the arrival at the anchor stop.
    const anchoredTotal = totalDistanceForOrder(
      strategy,
      STOP_C,
      result.orderedStops.slice(1),
    );
    expect(result.totalDistanceKm).toBeCloseTo(anchoredTotal, 6);
  });

  it('computes symmetric haversine distances', () => {
    expect(strategy.haversine(STOP_A, STOP_D)).toBeCloseTo(
      strategy.haversine(STOP_D, STOP_A),
      9,
    );
    expect(strategy.haversine(STOP_A, STOP_A)).toBe(0);
  });
});

describe('RouteOptimizerService', () => {
  let service: RouteOptimizerService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(RouteOptimizerService);
  });

  it('delegates to the default strategy and returns the optimized order', () => {
    const result = service.optimize(ORIGIN, SCRAMBLED_STOPS);
    expect(result.orderedStops.map((s) => s.stopId)).toEqual([1, 2, 3, 4]);
    expect(result.totalDistanceKm).toBeGreaterThan(0);
  });
});
