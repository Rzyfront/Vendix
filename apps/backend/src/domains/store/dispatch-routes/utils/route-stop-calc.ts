/**
 * Pure calculation helpers for dispatch route stops.
 *
 * These functions mirror the stop-building and total-aggregation semantics that
 * `DispatchRoutesService.create()` performs inline, extracted as PURE functions
 * (no Prisma, no services, plain data in/out) so they can be reused and unit
 * tested without a database. The shapes intentionally match what `create()`
 * persists today.
 */

/** Minimal invoice shape needed to resolve prepaid status (legacy fallback). */
export interface RouteStopInvoiceInput {
  payment_date?: Date | string | null;
}

/**
 * Minimal order shape used to resolve the CURRENT payment status of a regular
 * order linked to the dispatch note. `remaining_balance` arrives as a Prisma
 * Decimal / string / number — always coerce with `Number()`.
 */
export interface RouteStopOrderInput {
  remaining_balance?: number | string | null;
}

/** Minimal dispatch-note shape consumed by the calculators. */
export interface RouteStopNoteInput {
  id: number;
  /** Decimal/string/number grand total of the dispatch note. */
  grand_total?: number | string | null;
  /**
   * Explicit collection flag declared by the dispatch note. When present it is
   * authoritative; when null/undefined the legacy invoice.payment_date fallback
   * is used.
   */
  needs_collection?: boolean | null;
  invoice?: RouteStopInvoiceInput | null;
  /**
   * Linked regular order. When present, its CURRENT `remaining_balance === 0`
   * marks the note as prepaid (already paid). Used by `resolveIsPrepaid` so the
   * prepaid status is DERIVED from the live payment state on read instead of
   * being frozen at stop-creation time.
   */
  order?: RouteStopOrderInput | null;
}

/** Per-stop sequence/flag input (mirrors CreateDispatchRouteStopDto subset). */
export interface RouteStopSequenceInput {
  dispatch_note_id: number;
  stop_sequence?: number | null;
  is_extra_route?: boolean | null;
}

/**
 * The stop-data object shape produced for `dispatch_route_stops.create`.
 * Matches the object literal built inside `DispatchRoutesService.create()`.
 */
export interface RouteStopData {
  dispatch_note_id: number;
  stop_sequence: number;
  is_extra_route: boolean;
  is_prepaid: boolean;
  collected_amount: number;
  anticipo_amount: number;
  change_amount: number;
  withholding_amount: number;
  credit_amount: number;
  notes: string | null;
}

/** Aggregated route totals derived from the resolved stops. */
export interface RouteTotals {
  total_to_collect: number;
  total_prepaid: number;
}

/**
 * Minimal persisted stop shape consumed by the reconciliation calculator.
 * Mirrors the columns persisted on `dispatch_route_stops` plus the linked
 * note's `grand_total`. Decimals arrive as Decimal/string/number — always
 * normalize with `Number()`.
 */
export interface ReconciliationStopInput {
  stop_sequence: number;
  dispatch_note_id: number | null;
  is_prepaid: boolean;
  /** Persisted result of the stop (null while pending). */
  result: 'delivered' | 'partial' | 'rejected' | 'released' | null;
  collected_amount?: number | string | null;
  anticipo_amount?: number | string | null;
  /** Grand total of the linked dispatch note (the COD amount to collect). */
  dispatch_note_grand_total?: number | string | null;
}

/** Persisted route totals reused verbatim when the route is already closed. */
export interface ReconciliationPersistedTotals {
  total_collected?: number | string | null;
  cash_variance?: number | string | null;
}

/** Per-stop reconciliation row exposed on the route response payload. */
export interface ReconciliationStop {
  stop_sequence: number;
  dispatch_note_id: number | null;
  is_prepaid: boolean;
  /** Amount expected to be collected for this stop (0 when prepaid). */
  expected: number;
  /** Amount actually collected (collected_amount + anticipo_amount). */
  collected: number;
  result: 'delivered' | 'partial' | 'rejected' | 'released' | null;
  /** True once the stop reached a terminal result (settled or released). */
  settled: boolean;
}

/** Structured reconciliation summary for a dispatch route. */
export interface RouteReconciliation {
  /** Sum of grand_total for NON-prepaid stops (the COD target). */
  total_to_collect: number;
  /** Sum of collected_amount + anticipo_amount for NON-prepaid stops. */
  total_collected: number;
  /** Sum of grand_total for prepaid stops. */
  total_prepaid: number;
  /** collected - to_collect (negative = faltante, positive = sobrante). */
  variance: number;
  /** Outstanding COD amount on non-prepaid stops not yet settled. */
  pending_collection: number;
  /** Whether `variance` was sourced from the persisted close totals. */
  is_closed: boolean;
  /** Per-stop breakdown. */
  by_stop: ReconciliationStop[];
}

/** Terminal stop results: the stop is considered settled/closed. */
const SETTLED_RESULTS: ReadonlySet<string> = new Set([
  'delivered',
  'partial',
  'rejected',
  'released',
]);

/**
 * Build the structured reconciliation summary for a route.
 *
 * Pure function: persisted stops in, plain summary out. Reuses the COD rule
 * (`is_prepaid` excludes a stop from collection) consistently with
 * `computeRouteTotals` / `resolveIsPrepaid` so projection and persistence agree.
 *
 * - `expected`/`total_to_collect` derive from grand_total of non-prepaid stops.
 * - `collected`/`total_collected` mirror `close()`'s definition
 *   (collected_amount + anticipo_amount) for non-prepaid stops.
 * - For a CLOSED route, `total_collected` and `variance` are taken from the
 *   persisted close totals when available; otherwise they are projected.
 * - `pending_collection` is the expected amount of non-prepaid stops that have
 *   not reached a terminal result yet.
 */
export function buildRouteReconciliation(
  stops: ReconciliationStopInput[],
  options: {
    is_closed: boolean;
    persisted?: ReconciliationPersistedTotals | null;
  },
): RouteReconciliation {
  const by_stop: ReconciliationStop[] = stops.map((stop) => {
    const grand_total = Number(stop.dispatch_note_grand_total || 0);
    const collected =
      Number(stop.collected_amount || 0) + Number(stop.anticipo_amount || 0);
    return {
      stop_sequence: stop.stop_sequence,
      dispatch_note_id: stop.dispatch_note_id,
      is_prepaid: stop.is_prepaid,
      expected: stop.is_prepaid ? 0 : grand_total,
      collected,
      result: stop.result,
      settled: stop.result != null && SETTLED_RESULTS.has(stop.result),
    };
  });

  const nonPrepaid = by_stop.filter((s) => !s.is_prepaid);

  const total_to_collect = nonPrepaid.reduce((sum, s) => sum + s.expected, 0);
  const total_prepaid = stops
    .filter((s) => s.is_prepaid)
    .reduce((sum, s) => sum + Number(s.dispatch_note_grand_total || 0), 0);

  const projected_collected = nonPrepaid.reduce(
    (sum, s) => sum + s.collected,
    0,
  );

  const pending_collection = nonPrepaid
    .filter((s) => !s.settled)
    .reduce((sum, s) => sum + Math.max(0, s.expected - s.collected), 0);

  const hasPersisted =
    options.is_closed && options.persisted != null;

  const total_collected = hasPersisted
    ? Number(options.persisted?.total_collected ?? projected_collected)
    : projected_collected;

  const variance =
    hasPersisted && options.persisted?.cash_variance != null
      ? Number(options.persisted.cash_variance)
      : total_collected - total_to_collect;

  return {
    total_to_collect,
    total_collected,
    total_prepaid,
    variance,
    pending_collection,
    is_closed: options.is_closed,
    by_stop,
  };
}

/**
 * Resolve whether a dispatch note is prepaid (i.e. does NOT need collection).
 *
 * DERIVED on read from the CURRENT payment state — never from a frozen boolean
 * persisted on the stop. This is the root-cause fix for the bug where a paid
 * order kept `is_prepaid=false` (frozen at stop creation) and got charged again
 * in route.
 *
 * Rule (safe default = COD):
 *   1. `needs_collection === true` → COD, NOT prepaid (explicit operator intent
 *      wins over everything else).
 *   2. Regular order with `remaining_balance === 0` → prepaid (already paid).
 *   3. Regular order with `remaining_balance > 0` → COD, NOT prepaid.
 *   4. Paid invoice (`invoice.payment_date` present) → prepaid (sales-order /
 *      legacy path; sales_orders have no remaining_balance, so the invoice is
 *      authoritative there).
 *   5. Otherwise (no order balance signal, no paid invoice) → COD, NOT prepaid.
 *
 * `remaining_balance` arrives as Prisma Decimal / string / number — coerced via
 * `Number()`.
 */
export function resolveIsPrepaid(note: {
  needs_collection?: boolean | null;
  invoice?: { payment_date?: Date | string | null } | null;
  order?: { remaining_balance?: number | string | null } | null;
}): boolean {
  // (1) Explicit COD wins: even if the note somehow looks paid, the operator
  // asked for cash-on-route collection.
  if (note.needs_collection === true) return false;

  // (2)/(3) Regular order: the live remaining_balance is authoritative. A zero
  // balance means the order is fully paid → prepaid; a positive balance means
  // there is cash to collect on delivery → COD.
  if (note.order != null && note.order.remaining_balance != null) {
    return Number(note.order.remaining_balance) === 0;
  }

  // (4) Sales-order / legacy path: only a paid invoice classifies as prepaid.
  return !!(note.invoice && note.invoice.payment_date);
}

/**
 * Build the `stops_data` array persisted by the route create flow.
 *
 * @param stops Ordered list of stop sequence/flag inputs (from the DTO).
 * @param notesById Lookup of dispatch notes by id (already fetched/scoped).
 * @returns Array of stop-data objects, with `is_prepaid` resolved per note.
 */
export function buildStopsData(
  stops: RouteStopSequenceInput[],
  notesById: ReadonlyMap<number, RouteStopNoteInput>,
): RouteStopData[] {
  return stops.map((stop, idx) => {
    const note = notesById.get(stop.dispatch_note_id);
    const is_prepaid = note ? resolveIsPrepaid(note) : false;
    return {
      dispatch_note_id: stop.dispatch_note_id,
      stop_sequence: stop.stop_sequence ?? idx + 1,
      is_extra_route: stop.is_extra_route ?? false,
      is_prepaid,
      // Prepaid stops do NOT contribute to total_to_collect
      collected_amount: 0,
      anticipo_amount: 0,
      change_amount: 0,
      withholding_amount: 0,
      credit_amount: 0,
      notes: null,
    };
  });
}

/**
 * Compute route totals from resolved stop data.
 *
 * - `total_to_collect`: sum of `grand_total` for stops where `is_prepaid === false`.
 * - `total_prepaid`: sum of `grand_total` for stops where `is_prepaid === true`.
 *
 * Mirrors the reduce logic in `DispatchRoutesService.create()`.
 */
export function computeRouteTotals(
  stopsData: RouteStopData[],
  notesById: ReadonlyMap<number, RouteStopNoteInput>,
): RouteTotals {
  const sumGrandTotal = (predicate: (stop: RouteStopData) => boolean): number =>
    stopsData
      .filter(predicate)
      .reduce(
        (sum, stop) =>
          sum + Number(notesById.get(stop.dispatch_note_id)?.grand_total || 0),
        0,
      );

  return {
    total_to_collect: sumGrandTotal((s) => !s.is_prepaid),
    total_prepaid: sumGrandTotal((s) => s.is_prepaid),
  };
}

/**
 * Aggregated route totals for live UI updates (NOT just close-time).
 *
 * Mirrors the sum logic in `RouteFlowService.close()` so that the per-stop
 * settle flow can keep the parent `dispatch_routes.total_*` columns in sync
 * after every `settle`/`release` call. This powers the live "Recaudado" /
 * "A cobrar" header on the detail page during the route.
 */
export interface RouteLiveTotals {
  total_collected: number;
  total_changes: number;
  total_withholdings: number;
  total_credit: number;
  total_prepaid: number;
  /** Sum of grand_total of non-prepaid stops (the COD target). */
  total_to_collect: number;
}

/**
 * Minimal stop shape carrying the linked dispatch_note's payment signals,
 * consumed by {@link deriveStopIsPrepaid}. The note must be loaded with
 * `needs_collection`, `invoice.payment_date` and `order.remaining_balance`.
 *
 * `payment_date` / `remaining_balance` are typed loosely (`unknown`) so callers
 * can pass Prisma `Decimal` / `Date` columns directly without coupling this
 * pure module to the Prisma client types. `resolveIsPrepaid` coerces them via
 * `Number()` / truthiness.
 */
export interface DerivableStopInput {
  dispatch_note?: {
    needs_collection?: boolean | null;
    invoice?: { payment_date?: unknown } | null;
    order?: { remaining_balance?: unknown } | null;
  } | null;
}

/**
 * Derive the CURRENT `is_prepaid` value for a route stop from the live payment
 * state of its linked dispatch_note / order — NOT from the persisted
 * `dispatch_route_stops.is_prepaid` boolean (which is frozen at stop creation).
 *
 * Single source of truth for every read path (route response, totals, close
 * cash filter, settle event gate, PDF). When the note is missing (defensive),
 * falls back to `false` (COD) so nothing is silently treated as prepaid.
 */
export function deriveStopIsPrepaid(stop: DerivableStopInput): boolean {
  const note = stop.dispatch_note;
  if (!note) return false;
  return resolveIsPrepaid({
    needs_collection: note.needs_collection,
    invoice: note.invoice
      ? { payment_date: note.invoice.payment_date as Date | string | null }
      : null,
    order: note.order
      ? { remaining_balance: note.order.remaining_balance as number | string | null }
      : null,
  });
}

/**
 * Compute live aggregated totals from a list of stops.
 *
 * - Prepaid stops contribute their grand_total to `total_prepaid` and to
 *   nothing else (they don't add to `total_to_collect`, `total_collected`, etc.).
 * - `total_collected` = sum(collected_amount + anticipo_amount) over non-prepaid.
 * - `total_credit` / `total_withholdings` / `total_changes` mirror `close()`.
 * - `total_to_collect` = sum(grand_total) over non-prepaid stops.
 *
 * Pure function: stops in, totals out. No Prisma. Safe to call from any layer.
 */
export function aggregateRouteTotals<
  T extends {
    is_prepaid: boolean;
    collected_amount?: number | string | null;
    anticipo_amount?: number | string | null;
    change_amount?: number | string | null;
    withholding_amount?: number | string | null;
    credit_amount?: number | string | null;
    dispatch_note_grand_total?: number | string | null;
  },
>(stops: ReadonlyArray<T>): RouteLiveTotals {
  const sum = (
    pred: (s: T) => boolean,
    pick: (s: T) => number | string | null | undefined,
  ): number =>
    stops.filter(pred).reduce((acc, s) => acc + Number(pick(s) || 0), 0);

  const total_prepaid = sum(
    (s) => s.is_prepaid,
    (s) => s.dispatch_note_grand_total,
  );
  const total_to_collect = sum(
    (s) => !s.is_prepaid,
    (s) => s.dispatch_note_grand_total,
  );
  const total_collected = sum(
    (s) => !s.is_prepaid,
    (s) => Number(s.collected_amount || 0) + Number(s.anticipo_amount || 0),
  );
  const total_changes = sum((s) => !s.is_prepaid, (s) => s.change_amount);
  const total_withholdings = sum(
    (s) => !s.is_prepaid,
    (s) => s.withholding_amount,
  );
  const total_credit = sum((s) => !s.is_prepaid, (s) => s.credit_amount);

  return {
    total_collected,
    total_changes,
    total_withholdings,
    total_credit,
    total_prepaid,
    total_to_collect,
  };
}
