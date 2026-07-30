import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { storeIsRestaurant } from '@common/helpers/industry-capabilities.helper';
import { StockLevelManager } from './stock-level-manager.service';
import {
  SellableStockAllocator,
  StockAllocationSlice,
} from './sellable-stock-allocator.service';
import { SerialNumberEnforcementService } from '../../serial-numbers/serial-number-enforcement.service';
import { InventorySerialNumbersService } from '../../serial-numbers/inventory-serial-numbers.service';

/**
 * Options that drive a single delivery-commit run. The same contract is shared
 * by every caller (order-flow finished, POS payment, credit close-out, dispatch
 * note delivered) so stock deduction is uniform across all delivery paths.
 */
export interface CommitOpts {
  /**
   * Inventory movement recorded on `updateStock`:
   * - `'sale'`   → order-flow / POS / credit close (a retail/ecommerce sale).
   * - `'stock_out'` → dispatch-note delivery (physical goods already left).
   */
  movementType: 'sale' | 'stock_out';
  /**
   * When `true`, an insufficient-stock line throws `INV_STOCK_002` and aborts
   * the whole commit (order-flow / POS / credit). When `false`, the line is
   * deducted with a floor of 0 and only logged as an alert (dispatch delivery:
   * the merchandise already physically left, blocking would be pointless).
   */
  blockOnInsufficient: boolean;
  /**
   * When `true`, serial numbers of serialized lines are consumed as part of the
   * commit (order-flow / POS). Dispatch delivery passes `false` — the remisión
   * flow handles its own serial lifecycle (`markDispatchSerialsSold`).
   */
  consumeSerials: boolean;
  /** Human-readable reason persisted on the inventory transaction/movement. */
  reason: string;
  /** Acting user id; falls back to the request context user when omitted. */
  userId?: number;
  /**
   * Optional POS serial correlation payload (the raw `posItems` DTO array).
   * When present it is matched per order line (by product/variant, claim-once)
   * to resolve manual serial selection. Only meaningful with `consumeSerials`.
   */
  posSelection?: any;
}

export interface CommitResult {
  totalCost: number;
  committedItemCount: number;
}

interface PosSelection {
  serial_ids?: number[];
  serial_numbers?: string[];
}

/**
 * One normalized delivery line. Every caller maps its own source rows
 * (order_items or dispatch_note_items) into this shape before the per-line
 * engine runs, so the skip/reservation/validation/deduction logic is identical.
 */
interface CommitLine {
  product_id: number;
  product_variant_id?: number | null;
  /** Real stock units to deduct (already resolved: stock_units_consumed ?? quantity). */
  quantity: number;
  track_inventory: boolean;
  product_type: string | null;
  /** When set, the matching order_items row is flagged `inventory_committed`. */
  order_item_id?: number | null;
  inventory_committed?: boolean | null;
  inventory_consumed_at_fire?: boolean | null;
  skip_kds?: boolean | null;
  /** Location to deduct from when no active reservation is found (dispatch line). */
  location_id_override?: number | null;
  /** Resolved manual serial selection for this line (POS). */
  posSelection?: PosSelection;
}

/**
 * Canonical, per-line stock deduction for ANY order delivery / close-out path.
 *
 * This is the single source of truth for "deliver an order → deduct stock".
 * It orchestrates the existing `StockLevelManager` primitives (never
 * re-implements them) so all callers share one behavior:
 *
 *   1. skip lines that don't track inventory / are services
 *   2. skip idempotently (inventory_consumed_at_fire || inventory_committed)
 *   3. skip restaurant prepared items pending kitchen fire
 *   4. consume EVERY active reservation of the line (reserved-=q, available+=q)
 *   5. allocate the quantity across the store's SELLABLE locations
 *      (`SellableStockAllocator`), preferring the reserved ones
 *      - blockOnInsufficient → INV_STOCK_002 only when the TOTAL sellable
 *        availability falls short; never because the total is split
 *      - otherwise the uncovered remainder is deducted with floor 0
 *   6. optionally consume serials (per allocation slice on auto-FIFO)
 *   7. updateStock per slice (movement_type per opts) → the net deduction
 *   8. mark order_items.inventory_committed
 *
 * Then a defensive `releaseReservationsByReference('order', refId, 'consumed',
 * {decrementOnHand:false})` sweep clears any residual `active` reservations so
 * they cannot re-block product editing later.
 */
@Injectable()
export class OrderStockCommitService {
  private readonly logger = new Logger(OrderStockCommitService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly allocator: SellableStockAllocator,
    private readonly serialEnforcement: SerialNumberEnforcementService,
    private readonly serialNumbers: InventorySerialNumbersService,
  ) {}

  /**
   * Commit stock for an order being delivered/finished. Loads the order's
   * items + products + store industries on its own. Reservations are keyed by
   * `reserved_for_id = orderId` (reserved_for_type 'order').
   */
  async commitOrderDelivery(
    orderId: number,
    opts: CommitOpts,
    tx?: Prisma.TransactionClient,
  ): Promise<CommitResult> {
    const db: any = tx ?? this.prisma;

    const order = await db.orders.findUnique({
      where: { id: orderId },
      include: {
        stores: { select: { organization_id: true, industries: true } },
        order_items: {
          include: {
            products: {
              select: { id: true, track_inventory: true, product_type: true },
            },
            product_variants: { select: { id: true } },
          },
        },
      },
    });

    if (!order) {
      return { totalCost: 0, committedItemCount: 0 };
    }

    const isRestaurant = storeIsRestaurant((order as any).stores?.industries);
    const posMatcher = this.buildPosMatcher(opts.posSelection);

    let totalCost = 0;
    let committedItemCount = 0;

    for (const item of order.order_items || []) {
      if (!item.product_id) continue;

      const line: CommitLine = {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? undefined,
        // D4 multi-tarifa: deduct the real stock units when a price tier
        // resolved a pack size > 1, else the logical line quantity.
        quantity: item.stock_units_consumed ?? item.quantity,
        track_inventory: !!item.products?.track_inventory,
        product_type: item.products?.product_type ?? null,
        order_item_id: item.id,
        inventory_committed: item.inventory_committed,
        inventory_consumed_at_fire: item.inventory_consumed_at_fire,
        skip_kds: item.skip_kds,
        posSelection: opts.consumeSerials ? posMatcher(item) : undefined,
      };

      const res = await this.processLine(
        line,
        opts,
        orderId,
        isRestaurant,
        (order as any).store_id,
        tx,
      );
      totalCost += res.cost;
      if (res.committed) committedItemCount++;
    }

    // Defensive sweep: consume any residual active reservations for this order
    // WITHOUT touching on_hand (the per-line updateStock already deducted it).
    await this.stockLevelManager.releaseReservationsByReference(
      'order',
      orderId,
      'consumed',
      tx,
      { decrementOnHand: false },
    );

    return { totalCost, committedItemCount };
  }

  /**
   * Commit stock for a dispatch note being delivered. Maps
   * `dispatch_note_items` → lines. Reservations are keyed by
   * `sales_order_id ?? order_id ?? dispatch_note.id`. When the remisión links
   * to an order (`order_id`), the matching `order_items` are flagged
   * `inventory_committed` (same product/variant claim-once matching as POS).
   */
  async commitDispatchDelivery(
    dispatchNote: any,
    opts: CommitOpts,
    tx?: Prisma.TransactionClient,
  ): Promise<CommitResult> {
    const db: any = tx ?? this.prisma;

    let items = dispatchNote?.dispatch_note_items as any[] | undefined;
    if (!items) {
      const loaded = await db.dispatch_notes.findFirst({
        where: { id: dispatchNote.id },
        include: { dispatch_note_items: true },
      });
      items = loaded?.dispatch_note_items ?? [];
    }

    const reservationRefId: number =
      dispatchNote.sales_order_id ??
      dispatchNote.order_id ??
      dispatchNote.id;

    // Store industries (for the restaurant prepared-item skip).
    let isRestaurant = false;
    if (dispatchNote.store_id) {
      const store = await db.stores.findUnique({
        where: { id: dispatchNote.store_id },
        select: { industries: true },
      });
      isRestaurant = storeIsRestaurant(store?.industries);
    }

    // Batch-load product tracking/type for the skip logic.
    const productIds = Array.from(
      new Set(
        (items || [])
          .map((i) => i.product_id)
          .filter((id): id is number => id != null),
      ),
    );
    const products = productIds.length
      ? await db.products.findMany({
          where: { id: { in: productIds } },
          select: { id: true, track_inventory: true, product_type: true },
        })
      : [];
    const productMap = new Map<number, any>(products.map((p) => [p.id, p]));

    // Only order-linked remisiones have order_items to flag as committed.
    // (sales_order-linked remisiones settle their own sales_order_items; there
    // are no order_items rows to mark.)
    let orderItemMatcher: ((line: any) => any | undefined) | null = null;
    if (dispatchNote.order_id) {
      const order = await db.orders.findUnique({
        where: { id: dispatchNote.order_id },
        include: {
          order_items: {
            select: {
              id: true,
              product_id: true,
              product_variant_id: true,
              quantity: true,
              stock_units_consumed: true,
              inventory_committed: true,
              inventory_consumed_at_fire: true,
              skip_kds: true,
            },
          },
        },
      });
      orderItemMatcher = this.buildOrderItemMatcher(order?.order_items ?? []);
    }

    let totalCost = 0;
    let committedItemCount = 0;

    for (const item of items || []) {
      if (!item.product_id) continue;

      const product = productMap.get(item.product_id);
      const matched = orderItemMatcher ? orderItemMatcher(item) : undefined;

      const line: CommitLine = {
        product_id: item.product_id,
        product_variant_id: item.product_variant_id ?? undefined,
        quantity: item.dispatched_quantity,
        track_inventory: !!product?.track_inventory,
        product_type: product?.product_type ?? null,
        order_item_id: matched?.id ?? null,
        inventory_committed: matched?.inventory_committed,
        inventory_consumed_at_fire: matched?.inventory_consumed_at_fire,
        skip_kds: matched?.skip_kds,
        location_id_override:
          item.location_id ?? dispatchNote.dispatch_location_id ?? null,
      };

      const res = await this.processLine(
        line,
        opts,
        reservationRefId,
        isRestaurant,
        dispatchNote.store_id,
        tx,
      );
      totalCost += res.cost;
      if (res.committed) committedItemCount++;
    }

    // Defensive sweep of any residual active reservations for the order/SO ref.
    await this.stockLevelManager.releaseReservationsByReference(
      'order',
      reservationRefId,
      'consumed',
      tx,
      { decrementOnHand: false },
    );

    return { totalCost, committedItemCount };
  }

  // ─── PER-LINE ENGINE ────────────────────────────────────────

  private async processLine(
    line: CommitLine,
    opts: CommitOpts,
    reservationRefId: number,
    isRestaurant: boolean,
    storeId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{ cost: number; committed: boolean }> {
    const db: any = tx ?? this.prisma;
    const variant = line.product_variant_id ?? undefined;

    // 1. Skip untracked / service lines.
    if (!line.track_inventory || line.product_type === 'service') {
      return { cost: 0, committed: false };
    }
    // 2. Idempotency: already consumed (at fire) or already committed.
    if (
      line.inventory_consumed_at_fire === true ||
      line.inventory_committed === true
    ) {
      return { cost: 0, committed: false };
    }
    // 3. Restaurant prepared items pending kitchen fire consume ingredients at
    //    fire, not the plate here.
    if (isRestaurant && line.product_type === 'prepared' && !line.skip_kds) {
      return { cost: 0, committed: false };
    }

    const qty = line.quantity;
    if (!qty || qty <= 0) {
      return { cost: 0, committed: false };
    }

    // 4. Atomic idempotency CLAIM — the single mutation that serializes this
    //    line's deduction against a concurrent double-submit (double-click /
    //    network retry). The read-check above (step 2) is only a cheap
    //    fast-path: under READ COMMITTED two concurrent tx both read
    //    inventory_committed=false and would both deduct. This conditional
    //    UPDATE is the source of truth — the winner flips the flag (count=1),
    //    the loser blocks on the row-lock, re-evaluates the WHERE (now
    //    inventory_committed=true) and gets count=0 → skips WITHOUT releasing
    //    the reservation or deducting. When a tx is present (order-flow finish /
    //    POS), the claim lives inside the finish $transaction, so a later throw
    //    (INV_STOCK_002 / serials) rolls the claim back. When absent (dispatch,
    //    non-blocking, no serials) the conditional UPDATE serializes on its own
    //    and there is no post-claim throw to undo. Lines with no order_item_id
    //    (pure standalone remisión) keep their listener-side idempotency guard.
    if (line.order_item_id != null) {
      const claimed = await db.order_items.updateMany({
        where: { id: line.order_item_id, inventory_committed: false },
        data: {
          inventory_committed: true,
          inventory_committed_at: new Date(),
        },
      });
      if (claimed.count === 0) {
        return { cost: 0, committed: false };
      }
    }

    // Find EVERY active reservation for this order/SO reference. Read WITHOUT
    // store scope (mirrors order-flow) so a cross-store reservation is still
    // found; tx (request context) already carries the right scope.
    //
    // QUI-559: a line may hold more than one reservation when its quantity was
    // reserved across several locations. Reading only the first one made the
    // commit believe the line lived in a single location and refuse the sale.
    const reservationReader: any = tx ?? this.prisma.withoutScope();
    const reservations = await reservationReader.stock_reservations.findMany({
      where: {
        product_id: line.product_id,
        product_variant_id: variant ?? null,
        reserved_for_type: 'order',
        reserved_for_id: reservationRefId,
        status: 'active',
      },
      select: { location_id: true },
    });

    const reservedLocationIds: number[] = Array.from(
      new Set(reservations.map((r: any) => r.location_id as number)),
    );

    // Consume the reservations first (reserved-=q, available+=q, on_hand
    // intact) so availability is restored before allocation / deduction.
    for (const locId of reservedLocationIds) {
      await this.stockLevelManager.releaseReservation(
        line.product_id,
        variant,
        locId,
        'order',
        reservationRefId,
        tx,
      );
    }

    // Locations the caller is already committed to, honoured before any other:
    // the released reservations, then the line's own dispatch location.
    const preferredLocationIds = [
      ...reservedLocationIds,
      ...(line.location_id_override != null
        ? [line.location_id_override]
        : []),
    ];

    // Spread the line across the store's sellable locations. Blocking is now
    // driven by the TOTAL sellable availability, never by how that total
    // happens to be distributed between warehouses.
    const allocation = await this.allocator.allocateForLine(
      storeId,
      line.product_id,
      variant,
      qty,
      preferredLocationIds,
      tx,
    );

    let slices: StockAllocationSlice[] = allocation.slices;

    if (allocation.shortfall > 0) {
      if (opts.blockOnInsufficient) {
        throw new VendixHttpException(
          ErrorCodes.INV_STOCK_002,
          `No se puede entregar: stock insuficiente para el producto (disponible ${allocation.available}, requerido ${qty})`,
          {
            product_id: line.product_id,
            product_variant_id: variant ?? null,
            requested: qty,
            available: allocation.available,
            location_id: slices[0]?.location_id ?? null,
            order_reference: reservationRefId,
          },
        );
      }
      // Dispatch delivery: goods already left physically — deduct the
      // remainder from the intended location (floor 0) and raise an alert
      // instead of blocking.
      const fallbackLocationId =
        line.location_id_override ??
        reservedLocationIds[0] ??
        slices[0]?.location_id ??
        (await this.stockLevelManager.getDefaultLocationForProduct(
          line.product_id,
          variant,
        ));
      this.logger.warn(
        `[commit] Stock insuficiente al entregar (no bloqueante) — product ${line.product_id}` +
          `${variant ? ` variant ${variant}` : ''} disponible ${allocation.available} requerido ${qty} ` +
          `loc ${fallbackLocationId} ref ${reservationRefId}; se deduce con piso 0.`,
      );
      slices = this.allocator.absorbShortfall(allocation, fallbackLocationId);
    }

    if (opts.consumeSerials) {
      await this.consumeSerialsForLine(
        line.product_id,
        variant,
        qty,
        line.order_item_id ?? null,
        slices,
        line.posSelection,
        tx,
      );
    }

    // One `updateStock` per slice: the primitive (and therefore costing,
    // movement rows and denormalized sync) is untouched — only the number of
    // calls changes with the number of locations the line draws from.
    let cost = 0;
    for (const slice of slices) {
      const stockUpdate = await this.stockLevelManager.updateStock(
        {
          product_id: line.product_id,
          variant_id: variant,
          location_id: slice.location_id,
          quantity_change: -slice.quantity,
          movement_type: opts.movementType,
          validate_availability: opts.blockOnInsufficient,
          reason: opts.reason,
          user_id: opts.userId ?? RequestContextService.getUserId() ?? undefined,
          order_item_id: line.order_item_id ?? undefined,
          create_movement: true,
        },
        tx,
      );
      cost += Number(stockUpdate.cost_snapshot?.total_cost || 0);
    }

    // inventory_committed was already set by the atomic claim above; no final
    // write needed here.
    return {
      cost,
      committed: true,
    };
  }

  // ─── SERIALS ────────────────────────────────────────────────

  /**
   * Consume the serials for ONE delivery line of a serialized product,
   * replicating the (superset) POS logic: manual POS selection (serial_ids +
   * free-text serial_numbers) takes precedence, otherwise FIFO auto-selection
   * from the sellable pool at the location. No-op for non-serialized products.
   *
   * Runs BEFORE the stock deduction so an insufficient-serials condition throws
   * `SERIAL_REQUIRED_001` before any stock moves.
   */
  private async consumeSerialsForLine(
    product_id: number,
    variant_id: number | undefined,
    quantity: number,
    order_item_id: number | null,
    slices: StockAllocationSlice[],
    posSelection: PosSelection | undefined,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!(await this.serialEnforcement.isSerialized(product_id, tx))) {
      return;
    }

    const primaryLocationId = slices[0]?.location_id;
    let serialIds: number[] = [];
    const hasManual =
      (posSelection?.serial_ids?.length ?? 0) > 0 ||
      (posSelection?.serial_numbers?.length ?? 0) > 0;

    if (hasManual) {
      // Manual selection identifies the exact serials for the WHOLE line, so
      // it is resolved once — the operator's choice already carries its own
      // location. Free-text creation lands on the primary slice.
      const fromFreeText =
        await this.serialEnforcement.resolveOrCreateFromFreeText(
          product_id,
          primaryLocationId,
          posSelection?.serial_numbers ?? [],
          tx,
          variant_id,
        );
      serialIds = Array.from(
        new Set([...(posSelection?.serial_ids ?? []), ...fromFreeText]),
      );
      await this.serialEnforcement.requireConfirmedSerials(
        product_id,
        quantity,
        serialIds,
        tx,
      );
    } else {
      // Auto FIFO: draw from each slice's own pool, so a serialized line whose
      // stock is split across locations consumes the serials that actually sit
      // in each of them (QUI-559) instead of demanding all of them from one.
      const picked: number[] = [];
      let availableTotal = 0;
      for (const slice of slices) {
        const available = await this.serialNumbers.listAvailable(
          product_id,
          slice.location_id,
          variant_id,
          tx,
        );
        availableTotal += available.length;
        picked.push(
          ...available.slice(0, slice.quantity).map((s: any) => s.id),
        );
      }
      if (picked.length < quantity) {
        throw new VendixHttpException(
          ErrorCodes.SERIAL_REQUIRED_001,
          `No hay suficientes seriales disponibles (${availableTotal}/${quantity}) para el producto serializado`,
          {
            product_id,
            product_variant_id: variant_id ?? null,
            location_id: primaryLocationId ?? null,
            requested_qty: quantity,
            available_serials: availableTotal,
          },
        );
      }
      serialIds = picked.slice(0, quantity);
    }

    const soldSerialNumbers: string[] = [];
    for (const serial_id of serialIds) {
      const sold = await this.serialNumbers.transition(serial_id, 'sold', tx);
      if (order_item_id != null) {
        await this.serialNumbers.linkToDocument(
          serial_id,
          'order_item',
          order_item_id,
          tx,
        );
      }
      if (sold?.serial_number) soldSerialNumbers.push(sold.serial_number);
    }

    // Immutable snapshot (CSV of serial_number strings) on the line.
    if (order_item_id != null) {
      const writeDb: any = tx ?? this.prisma;
      await writeDb.order_items.updateMany({
        where: { id: order_item_id },
        data: { serial_numbers_snapshot: soldSerialNumbers.join(', ') },
      });
    }
  }

  // ─── MATCHERS (claim-once by product/variant) ───────────────

  /**
   * Build a claim-once matcher over the raw POS DTO lines. Each posItem is
   * consumed at most once so duplicate product lines map deterministically
   * (identical semantics to PaymentsService.findPosSelectionForItem).
   */
  private buildPosMatcher(
    posSelection: any,
  ): (orderItem: any) => PosSelection | undefined {
    const posItems: any[] = Array.isArray(posSelection) ? posSelection : [];
    const claimed = new Set<number>();
    return (orderItem: any): PosSelection | undefined => {
      if (!posItems.length) return undefined;
      for (let i = 0; i < posItems.length; i++) {
        if (claimed.has(i)) continue;
        const dto = posItems[i];
        const sameProduct = dto.product_id === orderItem.product_id;
        const sameVariant =
          (dto.product_variant_id ?? null) ===
          (orderItem.product_variant_id ?? null);
        if (sameProduct && sameVariant) {
          claimed.add(i);
          return {
            serial_ids: dto.serial_ids,
            serial_numbers: dto.serial_numbers,
          };
        }
      }
      return undefined;
    };
  }

  /**
   * Build a claim-once matcher over an order's order_items, keyed by
   * product/variant, so each dispatch line maps to at most one order line.
   */
  private buildOrderItemMatcher(
    orderItems: any[],
  ): (dispatchItem: any) => any | undefined {
    const claimed = new Set<number>();
    return (dispatchItem: any): any | undefined => {
      for (let i = 0; i < orderItems.length; i++) {
        if (claimed.has(i)) continue;
        const oi = orderItems[i];
        const sameProduct = oi.product_id === dispatchItem.product_id;
        const sameVariant =
          (oi.product_variant_id ?? null) ===
          (dispatchItem.product_variant_id ?? null);
        if (sameProduct && sameVariant) {
          claimed.add(i);
          return oi;
        }
      }
      return undefined;
    };
  }
}
