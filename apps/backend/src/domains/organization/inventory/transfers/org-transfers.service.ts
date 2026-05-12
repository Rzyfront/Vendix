import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { transfer_status_enum } from '@prisma/client';

import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { OperatingScopeService } from '@common/services/operating-scope.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StockLevelManager } from '../../../store/inventory/shared/services/stock-level-manager.service';

import { OrgTransferQueryDto } from './dto/org-transfer-query.dto';
import { CreateOrgTransferDto } from './dto/create-org-transfer.dto';
import { CompleteOrgTransferDto } from './dto/complete-org-transfer.dto';
import { CancelOrgTransferDto } from './dto/cancel-org-transfer.dto';
import { DispatchOrgTransferDto } from './dto/dispatch-org-transfer.dto';

/**
 * Org-native stock-transfers service (Plan P2.4 + P4.2 — full lifecycle).
 *
 * --- Lifecycle (after P4 M3 enum migration) ---------------------------------
 *
 *   pending → approved → in_transit → received
 *                                    └──→ cancelled (terminal)
 *
 * Each transition uses dedicated columns instead of the previous
 * discriminator-based logic:
 *
 *   | Logical    | enum value    | Side effects                                  |
 *   |------------|---------------|-----------------------------------------------|
 *   | pending    | `pending`     | none                                          |
 *   | approved   | `approved`    | sets `approved_at`, `approved_by_user_id`     |
 *   | in_transit | `in_transit`  | decrements origin; sets `dispatched_at`,      |
 *   |            |               |   `dispatched_by_user_id`                     |
 *   | received   | `received`    | increments destination per `quantity_received`|
 *   | cancelled  | `cancelled`   | sets `cancelled_at`, `cancelled_by_user_id`,  |
 *   |            |               |   `cancellation_reason`. If was in_transit,   |
 *   |            |               |   returns origin stock                        |
 *
 * --- Backward compat with legacy enum values --------------------------------
 *
 * M3a kept legacy values `draft` and `completed` in `transfer_status_enum` to
 * avoid breaking historical rows (they will be dropped in a follow-up
 * migration once data is fully migrated).
 *
 * Read path (response payloads):
 *   - `'draft'`     → mapped to `'pending'` (or `'approved'` if
 *                     `approved_by_user_id IS NOT NULL`)
 *   - `'completed'` → mapped to `'received'`
 *
 * Write path (state guards):
 *   - We do NOT accept `'draft'` or `'completed'` as the *new* status of any
 *     write. New writes only set `pending|approved|in_transit|received|cancelled`.
 *   - We DO accept `'draft'`/`'completed'` as a valid *transition source* for
 *     legacy rows that pre-date M3 (e.g. approving a `'draft'` row, cancelling
 *     a `'draft'` row, treating a `'completed'` row as terminal). This keeps
 *     legacy data progressable through the new lifecycle without forcing a
 *     bulk data backfill.
 *
 * --- Stock semantics (TWO-STEP, §13#1 of the plan) -----------------------
 *
 *   - `create()`   → no stock change.
 *   - `approve()`  → no stock change. Marks `approved_at` + actor.
 *   - `dispatch()` → decrements origin stock and moves transfer to
 *                    `in_transit`. Marks `dispatched_at` + actor.
 *   - `complete()` → increments destination stock per `quantity_received`
 *                    and (when fully received) emits the accounting event.
 *   - `cancel()`   → if `in_transit`, returns origin stock; otherwise
 *                    just terminates the row. Marks `cancelled_at` + actor +
 *                    `cancellation_reason` (dedicated column, no notes hack).
 */
@Injectable()
export class OrgTransfersService {
  /**
   * Logical states a transfer can be approved/dispatched/cancelled FROM.
   * Includes legacy `'draft'` for pre-M3 rows.
   */
  private static readonly PENDING_LIKE: transfer_status_enum[] = [
    transfer_status_enum.pending,
    transfer_status_enum.draft,
  ];
  /**
   * Terminal states. Legacy `'completed'` is treated as terminal (== received).
   */
  private static readonly TERMINAL_STATES: transfer_status_enum[] = [
    transfer_status_enum.received,
    transfer_status_enum.completed,
    transfer_status_enum.cancelled,
  ];

  constructor(
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly operatingScope: OperatingScopeService,
    private readonly stockLevelManager: StockLevelManager,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new BadRequestException('Organization context required');
    }
    return orgId;
  }

  private requireUserId(): number {
    const userId = RequestContextService.getUserId();
    if (!userId) {
      throw new BadRequestException('Authenticated user context required');
    }
    return userId;
  }

  // ------------------------------------------------------------------
  // Reads
  // ------------------------------------------------------------------

  async findAll(query: OrgTransferQueryDto) {
    const organization_id = this.requireOrgId();
    const scoped = await this.orgPrisma.getScopedWhere({
      organization_id,
      store_id_filter: query.store_id ?? null,
    });

    const where: any = {
      ...(query.status != null
        ? { status: this.normalizeStatusFilter(query.status) }
        : {}),
      ...(query.from_location_id != null
        ? { from_location_id: query.from_location_id }
        : {}),
      ...(query.to_location_id != null
        ? { to_location_id: query.to_location_id }
        : {}),
    };

    if (query.transfer_date_from || query.transfer_date_to) {
      where.transfer_date = {};
      if (query.transfer_date_from)
        where.transfer_date.gte = query.transfer_date_from;
      if (query.transfer_date_to)
        where.transfer_date.lte = query.transfer_date_to;
    }

    if (query.search) {
      where.OR = [
        { transfer_number: { contains: query.search } },
        { notes: { contains: query.search } },
      ];
    }

    if (query.product_id) {
      where.stock_transfer_items = {
        some: { product_id: query.product_id },
      };
    }

    // Store breakdown: either side of the transfer touches the requested store.
    if (scoped.store_id != null) {
      const storeFilter = [
        { from_location: { store_id: scoped.store_id } },
        { to_location: { store_id: scoped.store_id } },
      ];
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: storeFilter }];
        delete where.OR;
      } else {
        where.OR = storeFilter;
      }
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 25;
    const skip = (page - 1) * limit;
    const sortBy = query.sort_by ?? 'transfer_date';
    const sortOrder = query.sort_order ?? 'desc';

    const [data, total] = await Promise.all([
      this.orgPrisma.stock_transfers.findMany({
        where,
        include: {
          from_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          to_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          stock_transfer_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
        orderBy: { [sortBy]: sortOrder } as any,
        skip,
        take: limit,
      }),
      this.orgPrisma.stock_transfers.count({ where }),
    ]);

    return {
      data: data.map((t: any) => this.mapResponse(t)),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / Math.max(limit, 1)),
      },
    };
  }

  async findOne(id: number) {
    const organization_id = this.requireOrgId();
    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
      include: {
        from_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        to_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        stock_transfer_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
      },
    });

    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    return this.mapResponse(transfer);
  }

  /**
   * Aggregate counters for the org-admin dashboard.
   * Counters use the new enum values; legacy rows are folded into their
   * logical equivalents (`draft → pending`, `completed → received`) so the
   * dashboard never shows stale enum names.
   */
  async getStats() {
    const [
      total,
      pendingNew,
      pendingLegacy,
      approved,
      in_transit,
      receivedNew,
      receivedLegacy,
      cancelled,
    ] = await Promise.all([
      this.orgPrisma.stock_transfers.count(),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.pending },
      }),
      this.orgPrisma.stock_transfers.count({
        where: {
          status: transfer_status_enum.draft,
          approved_by_user_id: null,
        },
      }),
      this.orgPrisma.stock_transfers.count({
        where: {
          OR: [
            { status: transfer_status_enum.approved },
            {
              status: transfer_status_enum.draft,
              approved_by_user_id: { not: null },
            },
          ],
        },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.in_transit },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.received },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.completed },
      }),
      this.orgPrisma.stock_transfers.count({
        where: { status: transfer_status_enum.cancelled },
      }),
    ]);

    return {
      total,
      pending: pendingNew + pendingLegacy,
      approved,
      in_transit,
      received: receivedNew + receivedLegacy,
      cancelled,
    };
  }

  // ------------------------------------------------------------------
  // Writes — full lifecycle
  // ------------------------------------------------------------------

  /**
   * Create a transfer in the `pending` state (P4 M3 enum value, default).
   * No stock is moved.
   */
  async create(dto: CreateOrgTransferDto) {
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'At least one transfer item is required',
      );
    }

    if (dto.from_location_id === dto.to_location_id) {
      throw new BadRequestException(
        'Source and destination locations must be different',
      );
    }

    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    // Validate location ownership / central-warehouse policy.
    const fromLocation = await this.operatingScope.enforceLocationAccess(
      organization_id,
      dto.from_location_id,
      { allowCentral: true },
    );
    const toLocation = await this.operatingScope.enforceLocationAccess(
      organization_id,
      dto.to_location_id,
      { allowCentral: true },
    );

    // Cross-store guard. Only matters when both locations resolve to a
    // store_id; central warehouses (store_id null) are intra-org by design.
    if (
      fromLocation.store_id != null &&
      toLocation.store_id != null &&
      fromLocation.store_id !== toLocation.store_id
    ) {
      await this.operatingScope.assertCrossStoreTransferAllowed(
        organization_id,
        fromLocation.store_id,
        toLocation.store_id,
      );
    }

    return this.orgPrisma.$transaction(async (tx: any) => {
      const transfer_number = await this.generateTransferNumber(tx);

      const created = await tx.stock_transfers.create({
        data: {
          organization_id,
          transfer_number,
          from_location_id: dto.from_location_id,
          to_location_id: dto.to_location_id,
          status: transfer_status_enum.pending,
          transfer_date: new Date(),
          expected_date: dto.expected_date,
          notes: dto.notes,
          created_by_user_id: user_id,
          stock_transfer_items: {
            create: dto.items.map((item) => ({
              product_id: item.product_id,
              product_variant_id: item.product_variant_id,
              quantity: item.quantity,
              notes: item.notes,
            })),
          },
        },
        include: {
          from_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          to_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          stock_transfer_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
      });

      return this.mapResponse(created);
    });
  }

  /**
   * `pending → approved` transition.
   *
   * No stock is moved (TWO-STEP approve+dispatch, §13#1).
   * Sets dedicated columns: `status='approved'`, `approved_at`, `approved_by_user_id`.
   * Backward compat: legacy rows with `status='draft'` are accepted as the
   * source state.
   */
  async approve(id: number) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
    });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    if (
      !OrgTransfersService.PENDING_LIKE.includes(transfer.status as any)
    ) {
      throw new BadRequestException(
        `Cannot approve transfer in status '${transfer.status}'`,
      );
    }

    if (transfer.approved_by_user_id != null) {
      throw new ConflictException('Transfer is already approved');
    }

    const updated = await this.orgPrisma.stock_transfers.update({
      where: { id },
      data: {
        status: transfer_status_enum.approved,
        approved_at: new Date(),
        approved_by_user_id: user_id,
      },
      include: {
        from_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        to_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        stock_transfer_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
      },
    });

    return this.mapResponse(updated);
  }

  /**
   * `approved → in_transit` transition.
   *
   * Decrements origin stock for every item.
   * Sets `dispatched_at`, `dispatched_by_user_id`.
   * Backward compat: a legacy row in `'draft'` with `approved_by_user_id IS
   * NOT NULL` is treated as logically `approved` and accepted as the source
   * state.
   */
  async dispatch(id: number, dto?: DispatchOrgTransferDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
      include: { stock_transfer_items: true },
    });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    const isApproved =
      transfer.status === transfer_status_enum.approved ||
      (transfer.status === transfer_status_enum.draft &&
        transfer.approved_by_user_id != null);

    if (!isApproved) {
      throw new BadRequestException(
        `Cannot dispatch transfer in status '${transfer.status}'. ` +
          `Transfer must be approved first.`,
      );
    }

    return this.orgPrisma.$transaction(async (tx: any) => {
      // Validate stock availability up front so we fail before any partial
      // mutation.
      for (const item of transfer.stock_transfer_items) {
        const stock_level = await tx.stock_levels.findFirst({
          where: {
            product_id: item.product_id,
            product_variant_id: item.product_variant_id ?? null,
            location_id: transfer.from_location_id,
          },
        });

        if (
          !stock_level ||
          stock_level.quantity_available < item.quantity
        ) {
          throw new BadRequestException(
            `Insufficient stock for product ${item.product_id} at source location`,
          );
        }
      }

      // Decrement origin stock per item using StockLevelManager so that
      // movements + transactions + valuation snapshots stay consistent.
      for (const item of transfer.stock_transfer_items) {
        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: transfer.from_location_id,
            quantity_change: -item.quantity,
            movement_type: 'transfer',
            reason: `Transfer ${transfer.transfer_number} dispatched`,
            user_id,
            create_movement: true,
            from_location_id: transfer.from_location_id,
            to_location_id: transfer.to_location_id,
          },
          tx,
        );
      }

      const mergedNotes = this.mergeNotes(transfer.notes, dto?.notes);

      const updated = await tx.stock_transfers.update({
        where: { id },
        data: {
          status: transfer_status_enum.in_transit,
          dispatched_at: new Date(),
          dispatched_by_user_id: user_id,
          ...(mergedNotes !== transfer.notes ? { notes: mergedNotes } : {}),
        },
        include: {
          from_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          to_location: {
            select: { id: true, name: true, code: true, store_id: true },
          },
          stock_transfer_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
      });

      return this.mapResponse(updated);
    });
  }

  /**
   * `in_transit → received` transition (full or partial).
   *
   * Increments destination stock per `quantity_received`. When every item
   * has been fully received the transfer is moved to `received` and the
   * accounting event is emitted; otherwise it stays `in_transit`.
   */
  async complete(id: number, dto: CompleteOrgTransferDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException(
        'At least one received item is required',
      );
    }

    const result = await this.orgPrisma.$transaction(async (tx: any) => {
      const transfer = await tx.stock_transfers.findFirst({
        where: { id, organization_id },
        include: { stock_transfer_items: true },
      });
      if (!transfer) {
        throw new NotFoundException(`Transfer ${id} not found`);
      }

      if (transfer.status !== transfer_status_enum.in_transit) {
        throw new BadRequestException(
          `Cannot complete transfer in status '${transfer.status}'. ` +
            `Transfer must be in_transit first.`,
        );
      }

      const itemsById = new Map(
        transfer.stock_transfer_items.map((it: any) => [it.id, it]),
      );

      for (const received of dto.items) {
        const item = itemsById.get(received.stock_transfer_item_id) as
          | { id: number; quantity: number; quantity_received: number }
          | undefined;
        if (!item) {
          throw new BadRequestException(
            `Item ${received.stock_transfer_item_id} does not belong to transfer ${id}`,
          );
        }

        const remaining = item.quantity - item.quantity_received;
        if (received.quantity_received > remaining) {
          throw new BadRequestException(
            `quantity_received (${received.quantity_received}) for item ${item.id} exceeds remaining ${remaining}`,
          );
        }
      }

      // Persist quantity_received and increment destination stock.
      for (const received of dto.items) {
        if (received.quantity_received <= 0) continue;
        const item = itemsById.get(received.stock_transfer_item_id) as any;

        const newReceived =
          item.quantity_received + received.quantity_received;
        await tx.stock_transfer_items.update({
          where: { id: item.id },
          data: { quantity_received: newReceived },
        });

        await this.stockLevelManager.updateStock(
          {
            product_id: item.product_id,
            variant_id: item.product_variant_id ?? undefined,
            location_id: transfer.to_location_id,
            quantity_change: received.quantity_received,
            movement_type: 'transfer',
            reason: `Transfer ${transfer.transfer_number} received`,
            user_id,
            create_movement: true,
            from_location_id: transfer.from_location_id,
            to_location_id: transfer.to_location_id,
          },
          tx,
        );
      }

      // Recompute receipt status from the latest item rows.
      const refreshed = await tx.stock_transfer_items.findMany({
        where: { stock_transfer_id: id },
      });
      const allReceived = refreshed.every(
        (it: any) => it.quantity_received >= it.quantity,
      );

      const mergedNotes = this.mergeNotes(transfer.notes, dto.notes);

      return tx.stock_transfers.update({
        where: { id },
        data: {
          status: allReceived
            ? transfer_status_enum.received
            : transfer_status_enum.in_transit,
          completed_date: allReceived ? new Date() : null,
          ...(mergedNotes !== transfer.notes ? { notes: mergedNotes } : {}),
        },
        include: {
          from_location: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
            },
          },
          to_location: {
            select: {
              id: true,
              name: true,
              code: true,
              store_id: true,
            },
          },
          stock_transfer_items: {
            include: {
              products: { select: { id: true, name: true, sku: true } },
              product_variants: {
                select: { id: true, name: true, sku: true },
              },
            },
          },
        },
      });
    });

    // Emit accounting event only when fully received.
    if (result.status === transfer_status_enum.received) {
      const total_cost = await this.calculateTransferTotalCost(
        result.stock_transfer_items,
        result.from_location_id,
      );
      this.eventEmitter.emit('stock_transfer.completed', {
        transfer_id: result.id,
        transfer_number: result.transfer_number,
        organization_id: result.organization_id,
        store_id:
          result.from_location?.store_id === result.to_location?.store_id
            ? result.from_location?.store_id
            : undefined,
        from_store_id: result.from_location?.store_id ?? undefined,
        to_store_id: result.to_location?.store_id ?? undefined,
        from_location_id: result.from_location_id,
        to_location_id: result.to_location_id,
        total_cost,
        user_id,
      });
    }

    return this.mapResponse(result);
  }

  /**
   * Cancel a transfer.
   *
   * - `pending`/`approved` (or legacy `draft`) → just mark `cancelled`.
   * - `in_transit` → return stock to origin and mark `cancelled`.
   * - `received`/`completed`/`cancelled` (terminal) → not allowed.
   *
   * Sets dedicated columns: `cancelled_at`, `cancelled_by_user_id`,
   * `cancellation_reason`. The reason is stored in the dedicated column —
   * we no longer append to `notes`.
   */
  async cancel(id: number, dto: CancelOrgTransferDto) {
    const organization_id = this.requireOrgId();
    const user_id = this.requireUserId();

    const transfer = await this.orgPrisma.stock_transfers.findFirst({
      where: { id, organization_id },
      include: { stock_transfer_items: true },
    });
    if (!transfer) {
      throw new NotFoundException(`Transfer ${id} not found`);
    }

    if (
      OrgTransfersService.TERMINAL_STATES.includes(transfer.status as any)
    ) {
      throw new BadRequestException(
        `Cannot cancel transfer in status '${transfer.status}'`,
      );
    }

    if (transfer.status === transfer_status_enum.in_transit) {
      const updated = await this.orgPrisma.$transaction(async (tx: any) => {
        // Return any unreceived quantity back to origin.
        for (const item of transfer.stock_transfer_items) {
          const outstanding = item.quantity - item.quantity_received;
          if (outstanding <= 0) continue;
          await this.stockLevelManager.updateStock(
            {
              product_id: item.product_id,
              variant_id: item.product_variant_id ?? undefined,
              location_id: transfer.from_location_id,
              quantity_change: outstanding,
              movement_type: 'transfer',
              reason:
                dto?.reason ??
                `Transfer ${transfer.transfer_number} cancelled — return to origin`,
              user_id,
              create_movement: true,
              from_location_id: transfer.from_location_id,
              to_location_id: transfer.to_location_id,
            },
            tx,
          );
        }

        return tx.stock_transfers.update({
          where: { id },
          data: {
            status: transfer_status_enum.cancelled,
            cancelled_at: new Date(),
            cancelled_by_user_id: user_id,
            cancellation_reason: dto?.reason ?? null,
          },
          include: {
            from_location: {
              select: {
                id: true,
                name: true,
                code: true,
                store_id: true,
              },
            },
            to_location: {
              select: {
                id: true,
                name: true,
                code: true,
                store_id: true,
              },
            },
            stock_transfer_items: {
              include: {
                products: { select: { id: true, name: true, sku: true } },
                product_variants: {
                  select: { id: true, name: true, sku: true },
                },
              },
            },
          },
        });
      });

      return this.mapResponse(updated);
    }

    // pending / approved / legacy draft → just terminate, no stock movement.
    const updated = await this.orgPrisma.stock_transfers.update({
      where: { id },
      data: {
        status: transfer_status_enum.cancelled,
        cancelled_at: new Date(),
        cancelled_by_user_id: user_id,
        cancellation_reason: dto?.reason ?? null,
      },
      include: {
        from_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        to_location: {
          select: { id: true, name: true, code: true, store_id: true },
        },
        stock_transfer_items: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
            product_variants: {
              select: { id: true, name: true, sku: true },
            },
          },
        },
      },
    });

    return this.mapResponse(updated);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /**
   * Maps a legacy enum filter value to the equivalent set of physical values
   * for backward compat with old clients (e.g. UI tabs that still send
   * `'draft'` or `'completed'`).
   */
  private normalizeStatusFilter(
    status: string,
  ):
    | transfer_status_enum
    | { in: transfer_status_enum[] } {
    switch (status) {
      // Legacy alias for the old "draft" tab — maps to current `pending`
      // plus any legacy rows that are still physically `draft`.
      case 'draft':
        return {
          in: [transfer_status_enum.pending, transfer_status_enum.draft],
        };
      // Legacy alias for the old "completed" tab — maps to current
      // `received` plus any legacy rows that are still physically
      // `completed`.
      case 'completed':
        return {
          in: [transfer_status_enum.received, transfer_status_enum.completed],
        };
      default:
        return status as transfer_status_enum;
    }
  }

  /**
   * Folds a row's physical enum value into the canonical logical state
   * exposed in API responses. Keeps the public contract stable while
   * legacy rows linger.
   */
  private toLogicalStatus(row: {
    status: transfer_status_enum;
    approved_by_user_id?: number | null;
  }): transfer_status_enum {
    if (row.status === transfer_status_enum.draft) {
      return row.approved_by_user_id != null
        ? transfer_status_enum.approved
        : transfer_status_enum.pending;
    }
    if (row.status === transfer_status_enum.completed) {
      return transfer_status_enum.received;
    }
    return row.status;
  }

  private mapResponse<T extends { status: transfer_status_enum }>(row: T): T {
    return { ...row, status: this.toLogicalStatus(row as any) };
  }

  private mergeNotes(
    existing: string | null | undefined,
    addition: string | null | undefined,
  ): string | null {
    if (!addition) return existing ?? null;
    if (!existing) return addition;
    return `${existing}\n${addition}`;
  }

  private async calculateTransferTotalCost(
    items: any[],
    fromLocationId: number,
  ): Promise<number> {
    let total = 0;
    for (const item of items) {
      const qty = Number(item.quantity_received || 0);
      if (qty <= 0) continue;

      const stockLevel = await this.orgPrisma.stock_levels.findFirst({
        where: {
          product_id: item.product_id,
          product_variant_id: item.product_variant_id ?? null,
          location_id: fromLocationId,
        },
        select: {
          cost_per_unit: true,
          products: { select: { cost_price: true } },
          product_variants: { select: { cost_price: true } },
        },
      });

      const unitCost =
        Number(stockLevel?.cost_per_unit || 0) ||
        Number(stockLevel?.product_variants?.cost_price || 0) ||
        Number(stockLevel?.products?.cost_price || 0);
      total += qty * unitCost;
    }
    return total;
  }

  /**
   * Generate the next sequential transfer number with the same shape used
   * by the store-domain service: `TRF-YYYYMMDD-NNNN` (per org because the
   * unique key is `(organization_id, transfer_number)`).
   */
  private async generateTransferNumber(tx: any): Promise<string> {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    const prefix = `TRF-${year}${month}${day}`;

    const lastTransfer = await tx.stock_transfers.findFirst({
      where: { transfer_number: { startsWith: prefix } },
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
