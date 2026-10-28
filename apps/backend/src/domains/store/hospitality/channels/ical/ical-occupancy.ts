/**
 * Hospitality Suite (H6.1/H6.2) — rooms of one type taken per night,
 * including nights sold without a room yet (every sale is born unassigned).
 *
 * Each unassigned night takes one free room of its type: active, sellable,
 * without an assigned night and without a block that night. Free rooms are
 * handed out in the given order (code, id), so a room's feed is stable from
 * one poll to the next and Airbnb never sells a room an unassigned guest
 * needs. Unassigned nights left without a free room are the overflow: the
 * type is oversold that night.
 */

export interface TypeOccupancyInput {
  /** Sellable rooms of the type, in a stable order. */
  unit_ids: number[];
  /** Active nights of the type; `unit_id` null = not assigned yet. */
  nights: { night: string; unit_id: number | null; reservation?: string }[];
  /** Nights the type's rooms are blocked (any reason), `YYYY-MM-DD`. */
  blocked: { night: string; unit_id: number }[];
}

export interface NightOccupancy {
  /** Rooms the unassigned nights take, picked from the free ones. */
  taken: number[];
  /** Unassigned nights left without a free room. */
  overflow: number;
  /** Reservations holding an unassigned night. */
  unassigned_reservations: string[];
}

export function allocateUnassignedNights(
  input: TypeOccupancyInput,
): Map<string, NightOccupancy> {
  const busy = new Map<string, Set<number>>();
  const markBusy = (night: string, unit_id: number) => {
    const set = busy.get(night) ?? new Set<number>();
    set.add(unit_id);
    busy.set(night, set);
  };
  const unassigned = new Map<string, string[]>();
  for (const n of input.nights) {
    if (n.unit_id === null) {
      unassigned.set(n.night, [...(unassigned.get(n.night) ?? []), n.reservation ?? '']);
    } else {
      markBusy(n.night, n.unit_id);
    }
  }
  for (const b of input.blocked) markBusy(b.night, b.unit_id);

  const result = new Map<string, NightOccupancy>();
  for (const [night, reservations] of unassigned) {
    const taken = input.unit_ids
      .filter((id) => !busy.get(night)?.has(id))
      .slice(0, reservations.length);
    result.set(night, {
      taken,
      overflow: reservations.length - taken.length,
      unassigned_reservations: [...new Set(reservations.filter(Boolean))],
    });
  }
  return result;
}
