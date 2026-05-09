import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { transfer_status_enum } from '@prisma/client';
import { StorePrismaService } from 'src/prisma/services/store-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { StockLevelManager } from '../../../inventory/shared/services/stock-level-manager.service';

interface OrderShippedEvent {
  order_id: number;
  store_id: number;
  organization_id: number;
  user_id?: number | null;
}

/**
 * Source-order type used by ecommerce auto-fulfillment to mark the
 * `stock_transfers` row that mirrors a shipped order. Acts as the namespace
 * for the `(source_order_type, source_order_id)` idempotency key.
 */
const SOURCE_ORDER_TYPE_ECOMMERCE_DISPATCH = 'ecommerce_order_dispatch';

/**
 * Auto-fulfillment listener for ORGANIZATION-scope ecommerce orders
 * (Plan §4.3, P3.4 + P4.2).
 *
 * Flow when an order transitions to `'shipped'`:
 *
 *   1. Detect operating_scope = ORGANIZATION via `OperatingScopeService`.
 *   2. Resolve the org's central warehouse (origin) and the fulfilling
 *      store's default location (destination). Skip when either is missing.
 *   3. Idempotency guard: skip if a stock_transfer was already created for
 *      this order, identified by
 *        `(source_order_type='ecommerce_order_dispatch', source_order_id=<id>)`
 *      Prevents double-creation if the event fires twice.
 *   4. Build the transfer items from order_items where the original
 *      reservation was placed at central (matching `stock_reservations`
 *      rows for this order at the central location).
 *   5. Run the lifecycle inside a single tx (transactional integrity):
 *        a. CREATE transfer (`status=pending`, no stock change).
 *        b. APPROVE — `status=approved`, set `approved_at`,
 *           `approved_by_user_id` (no stock change).
 *        c. DISPATCH — `status=in_transit`, set `dispatched_at`,
 *           `dispatched_by_user_id`. Call
 *           `StockLevelManager.updateStock` at central with
 *           `quantity_change = -qty`. Single decrement at central.
 *        d. COMPLETE — `status=received`. Call
 *           `StockLevelManager.updateStock` at the store default location
 *           with `quantity_change = +qty`. Single increment at store.
 *        e. CONSUME ORIGINAL RESERVATION via
 *           `releaseReservationsByReference('order', orderId, 'consumed', tx,
 *           { decrementOnHand: false })` — central qty_on_hand was already
 *           decremented in (c); this only flips qty_reserved → 0 for the
 *           order.
 *
 * Audit math at central (per item, qty=N) — single decrement guarantee:
 *
 *   Before  (after checkout reservation): on_hand=H, reserved=R+N, available=H-R-N
 *   (c) dispatch: updateStock(-N) → on_hand=H-N, reserved=R+N, available=H-R-2N (transient)
 *   (e) consume:  releaseReservationsByReference (decrementOnHand=false)
 *                   → on_hand stays H-N, reserved=R, available=H-N-R
 *   Net change:   on_hand: -N (exactly once), reserved: 0 (the order's slice is gone)
 *
 * Audit math at fulfilling store (per item, qty=N):
 *   Before:  on_hand=S,  reserved=Rs,  available=S-Rs
 *   (d) complete: updateStock(+N) → on_hand=S+N, reserved=Rs, available=S+N-Rs
 *   Net change:   on_hand: +N (exactly once)
 */
@Injectable()
export class OrderAutoFulfillmentListener {
  private readonly logger = new Logger(OrderAutoFulfillmentListener.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly stockLevelManager: StockLevelManager,
  ) {}

  @OnEvent('order.shipped')
  async handleOrderShipped(event: OrderShippedEvent): Promise<void> {
    try {
      const scope = await this.operatingScope.getOperatingScope(
        event.organization_id,
      );
      if (scope !== 'ORGANIZATION') {
        // STORE scope: existing per-store flow handles inventory at 'finished'.
        return;
      }

      const central = await this.operatingScope.findCentralWarehouse(
        event.organization_id,
      );
      if (!central) {
        this.logger.warn(
          `[order.shipped] Order #${event.order_id}: ORG scope but no central warehouse — skipping auto-fulfillment`,
        );
        return;
      }

      // Resolve fulfilling store's default location (destination).
      const fulfillingStore = await this.prisma.withoutScope().stores.findFirst({
        where: { id: event.store_id, organization_id: event.organization_id },
        select: { id: true, default_location_id: true, store_code: true },
      });

      if (!fulfillingStore) {
        this.logger.warn(
          `[order.shipped] Order #${event.order_id}: store ${event.store_id} not found in org ${event.organization_id}`,
        );
        return;
      }

      let storeDefaultLocationId = fulfillingStore.default_location_id;
      if (!storeDefaultLocationId) {
        // Fall back to first non-central location belonging to this store.
        const fallback = await this.prisma
          .withoutScope()
          .inventory_locations.findFirst({
            where: {
              organization_id: event.organization_id,
              store_id: event.store_id,
              is_central_warehouse: false,
              is_active: true,
            },
            orderBy: { id: 'asc' },
            select: { id: true },
          });
        storeDefaultLocationId = fallback?.id ?? null;
      }

      if (!storeDefaultLocationId) {
        this.logger.warn(
          `[order.shipped] Order #${event.order_id}: no default/active location for store ${event.store_id} — skipping auto-fulfillment`,
        );
        return;
      }

      // Idempotency: avoid double-create if event fires twice.
      // Native lookup via `(source_order_type, source_order_id)` columns —
      // replaces the legacy notes-marker dedupe key.
      const existing = await this.prisma
        .withoutScope()
        .stock_transfers.findFirst({
          where: {
            organization_id: event.organization_id,
            source_order_type: SOURCE_ORDER_TYPE_ECOMMERCE_DISPATCH,
            source_order_id: event.order_id,
          },
          select: { id: true, transfer_number: true, status: true },
        });

      if (existing) {
        this.logger.log(
          `[order.shipped] Order #${event.order_id}: transfer ${existing.transfer_number} (status=${existing.status}) already exists — skipping`,
        );
        return;
      }

      // Build transfer items from active reservations at the central
      // warehouse for this order. This guarantees we only move the slice the
      // checkout actually reserved (services / non-tracked products are
      // skipped naturally because they have no reservation row).
      const reservations = await this.prisma
        .withoutScope()
        .stock_reservations.findMany({
          where: {
            reserved_for_type: 'order',
            reserved_for_id: event.order_id,
            location_id: central.id,
            status: 'active',
          },
          select: {
            product_id: true,
            product_variant_id: true,
            quantity: true,
          },
        });

      if (reservations.length === 0) {
        this.logger.log(
          `[order.shipped] Order #${event.order_id}: no active reservations at central — nothing to fulfill`,
        );
        return;
      }

      // Aggregate by (product, variant) — multiple reservation rows for the
      // same product collapse into a single transfer line.
      const items = new Map<
        string,
        {
          product_id: number;
          product_variant_id: number | null;
          quantity: number;
        }
      >();
      for (const r of reservations) {
        const key = `${r.product_id}-${r.product_variant_id ?? 'null'}`;
        const existingItem = items.get(key);
        if (existingItem) {
          existingItem.quantity += r.quantity;
        } else {
          items.set(key, {
            product_id: r.product_id,
            product_variant_id: r.product_variant_id,
            quantity: r.quantity,
          });
        }
      }

      const transferItems = Array.from(items.values());

      const transfer = await this.prisma.$transaction(async (tx: any) => {
        // 1. CREATE transfer (no stock change). Native columns:
        //    `status='pending'`, `source_order_type`, `source_order_id`.
        const transferNumber = await this.generateTransferNumber(
          tx,
          event.organization_id,
        );

        const created = await tx.stock_transfers.create({
          data: {
            organization_id: event.organization_id,
            transfer_number: transferNumber,
            from_location_id: central.id,
            to_location_id: storeDefaultLocationId,
            status: transfer_status_enum.pending,
            source_order_type: SOURCE_ORDER_TYPE_ECOMMERCE_DISPATCH,
            source_order_id: event.order_id,
            transfer_date: new Date(),
            notes: `Auto-generated for ecommerce order #${event.order_id}`,
            created_by_user_id: event.user_id ?? null,
            stock_transfer_items: {
              create: transferItems.map((it) => ({
                product_id: it.product_id,
                product_variant_id: it.product_variant_id,
                quantity: it.quantity,
              })),
            },
          },
          include: { stock_transfer_items: true },
        });

        // 2. APPROVE — `status=approved`, set `approved_at` + actor.
        //    No stock change.
        await tx.stock_transfers.update({
          where: { id: created.id },
          data: {
            status: transfer_status_enum.approved,
            approved_at: new Date(),
            approved_by_user_id: event.user_id ?? null,
          },
        });

        // 3. DISPATCH — `status=in_transit`, set `dispatched_at` + actor.
        //    Single decrement at central via updateStock.
        for (const item of created.stock_transfer_items) {
          await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: central.id,
              quantity_change: -item.quantity,
              movement_type: 'transfer',
              reason: `Transfer ${created.transfer_number} dispatched (auto-fulfillment order #${event.order_id})`,
              user_id: event.user_id ?? undefined,
              create_movement: true,
              from_location_id: central.id,
              to_location_id: storeDefaultLocationId,
            },
            tx,
          );
        }

        await tx.stock_transfers.update({
          where: { id: created.id },
          data: {
            status: transfer_status_enum.in_transit,
            dispatched_at: new Date(),
            dispatched_by_user_id: event.user_id ?? null,
          },
        });

        // 4. COMPLETE — `status=received`. Single increment at fulfilling
        //    store.
        for (const item of created.stock_transfer_items) {
          await tx.stock_transfer_items.update({
            where: { id: item.id },
            data: { quantity_received: item.quantity },
          });

          await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: storeDefaultLocationId,
              quantity_change: item.quantity,
              movement_type: 'transfer',
              reason: `Transfer ${created.transfer_number} received (auto-fulfillment order #${event.order_id})`,
              user_id: event.user_id ?? undefined,
              create_movement: true,
              from_location_id: central.id,
              to_location_id: storeDefaultLocationId,
            },
            tx,
          );
        }

        await tx.stock_transfers.update({
          where: { id: created.id },
          data: {
            status: transfer_status_enum.received,
            completed_date: new Date(),
          },
        });

        // 5. CONSUME the order's original reservation at central — flip
        //    `status='consumed'` and clear `qty_reserved`. CRITICAL:
        //    `decrementOnHand: false` because step 3 already decremented
        //    `qty_on_hand` via updateStock. Without this flag we would
        //    double-decrement central inventory.
        await this.stockLevelManager.releaseReservationsByReference(
          'order',
          event.order_id,
          'consumed',
          tx,
          { decrementOnHand: false },
        );

        return created;
      });

      this.logger.log(
        `[order.shipped] Order #${event.order_id}: auto-fulfilled via transfer ${transfer.transfer_number} (central #${central.id} → store #${event.store_id} location #${storeDefaultLocationId})`,
      );
    } catch (error) {
      this.logger.error(
        `[order.shipped] Auto-fulfillment failed for order #${event.order_id}: ${error.message}`,
        error.stack,
      );
      // Do not rethrow — the order is already in 'shipped' state. Surface
      // via logs / monitoring; manual intervention recovers from this.
    }
  }

  /**
   * Generates `TRF-YYYYMMDD-NNNN` per organization, mirroring the
   * convention used by `StockTransfersService` and `OrgTransfersService`.
   */
  private async generateTransferNumber(
    tx: any,
    organization_id: number,
  ): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix = `TRF-${year}${month}${day}`;

    const lastTransfer = await tx.stock_transfers.findFirst({
      where: { organization_id, transfer_number: { startsWith: prefix } },
      orderBy: { transfer_number: 'desc' },
    });

    let sequence = 1;
    if (lastTransfer) {
      const parts = lastTransfer.transfer_number.split('-');
      const last = parseInt(parts[2], 10);
      if (Number.isFinite(last)) sequence = last + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
  }
}
