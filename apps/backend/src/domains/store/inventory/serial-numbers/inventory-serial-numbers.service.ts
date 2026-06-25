import { Injectable } from '@nestjs/common';
import {
  Prisma,
  serial_status_enum,
  sales_document_item_type_enum,
} from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreateInventorySerialNumberDto,
  GetSerialNumbersDto,
  BulkBackfillSerialNumbersDto,
  PatchSerialNumberDto,
  SummarySerialNumbersDto,
} from '../dto/create-inventory-serial-number.dto';

/**
 * QUI-431 — Serial-number pool service (rewritten against the real schema).
 *
 * `inventory_serial_numbers` is the pool of individually tracked units. A row
 * is created `in_stock` on receipt, transitions through the serial lifecycle
 * (`in_stock → reserved → sold`, `sold → returned`, etc.), and is linked to a
 * concrete sales/dispatch document line via the polymorphic junction
 * `sales_document_serials`.
 *
 * Scope: both models are RELATIONAL-scoped in StorePrismaService (via
 * inventory_locations.store_id). Consequently every pool row MUST carry a
 * non-null `location_id`, otherwise it is invisible to the scoped client.
 *
 * Transaction composition: every mutating method accepts an optional `tx`
 * (Prisma.TransactionClient). When provided, the operation joins the caller's
 * transaction so serial transitions commit atomically with the stock change
 * driven by StockLevelManager (which shares the same `tx`).
 */
@Injectable()
export class InventorySerialNumbersService {
  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Resolve the Prisma client to use: the caller-provided transaction client
   * or the scoped store client. The scoped client applies tenant filters on
   * reads/updates and passes `create` through untouched for relational models
   * (no store_id column to inject), which is exactly what we want here.
   */
  private client(tx?: Prisma.TransactionClient): any {
    return tx ?? (this.prisma as any);
  }

  // ===========================================================================
  // Reads
  // ===========================================================================

  /**
   * Paginated listing with filters by product, variant, batch, location,
   * status, and a free-text search over serial_number / product name+sku.
   * Returns the standard raw shape consumed by ResponseService.paginated().
   */
  async list(
    filters: GetSerialNumbersDto,
    tx?: Prisma.TransactionClient,
  ): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const prisma = this.client(tx);
    const page = filters.page && filters.page > 0 ? filters.page : 1;
    const limit = filters.limit && filters.limit > 0 ? filters.limit : 25;

    const where: Prisma.inventory_serial_numbersWhereInput = {};
    if (filters.product_id) where.product_id = filters.product_id;
    if (filters.product_variant_id)
      where.product_variant_id = filters.product_variant_id;
    if (filters.batch_id) where.batch_id = filters.batch_id;
    if (filters.location_id) where.location_id = filters.location_id;
    if (filters.status) where.status = filters.status;
    // QUI-431 — warranty_expiry range filter (inclusive). Only the bounds that
    // were sent are applied. warranty_expiry is a DateTime column; @IsDateString
    // strings parse to UTC instants via new Date(...) (no tz drift for instants).
    if (filters.warranty_expiry_from || filters.warranty_expiry_to) {
      const warranty: Prisma.DateTimeFilter = {};
      if (filters.warranty_expiry_from) {
        warranty.gte = new Date(filters.warranty_expiry_from);
      }
      if (filters.warranty_expiry_to) {
        warranty.lte = new Date(filters.warranty_expiry_to);
      }
      where.warranty_expiry = warranty;
    }
    if (filters.search) {
      where.OR = [
        { serial_number: { contains: filters.search, mode: 'insensitive' } },
        {
          products: {
            name: { contains: filters.search, mode: 'insensitive' },
          },
        },
        {
          products: {
            sku: { contains: filters.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.inventory_serial_numbers.findMany({
        where,
        include: {
          products: { select: { id: true, name: true, sku: true } },
          product_variants: { select: { id: true, name: true, sku: true } },
          inventory_batches: {
            select: { id: true, batch_number: true, expiration_date: true },
          },
          inventory_locations: { select: { id: true, name: true } },
        },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.inventory_serial_numbers.count({ where }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Find a single serial by id (scoped). Throws INV_FIND_001 when absent.
   */
  async findOne(id: number, tx?: Prisma.TransactionClient): Promise<any> {
    const prisma = this.client(tx);
    const serial = await prisma.inventory_serial_numbers.findFirst({
      where: { id },
      include: {
        products: { select: { id: true, name: true, sku: true } },
        product_variants: { select: { id: true, name: true, sku: true } },
        inventory_batches: {
          select: { id: true, batch_number: true, expiration_date: true },
        },
        inventory_locations: { select: { id: true, name: true } },
        sales_document_serials: true,
      },
    });
    if (!serial) {
      throw new VendixHttpException(ErrorCodes.INV_FIND_001, undefined, {
        serial_id: id,
      });
    }
    return serial;
  }

  /**
   * Serials available to sell for a product/variant at a location (in_stock).
   * FIFO order (created_at ASC) so auto-selection consumes oldest first.
   */
  async listAvailable(
    product_id: number,
    location_id: number,
    product_variant_id?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<any[]> {
    const prisma = this.client(tx);
    return prisma.inventory_serial_numbers.findMany({
      where: {
        product_id,
        product_variant_id: product_variant_id ?? null,
        location_id,
        status: serial_status_enum.in_stock,
      },
      orderBy: { created_at: 'asc' },
    });
  }

  /**
   * Count in_stock serials for a (product, variant, location) tuple.
   * Used by parity enforcement.
   */
  async countInStock(
    product_id: number,
    location_id: number,
    product_variant_id?: number,
    tx?: Prisma.TransactionClient,
  ): Promise<number> {
    const prisma = this.client(tx);
    return prisma.inventory_serial_numbers.count({
      where: {
        product_id,
        product_variant_id: product_variant_id ?? null,
        location_id,
        status: serial_status_enum.in_stock,
      },
    });
  }

  /**
   * QUI-431 — Aggregate summary of the serial pool for the current store.
   *
   * Store scope is enforced by the scoped client (relational via
   * inventory_locations.store_id), exactly like list(). Optional product_id /
   * location_id narrow the base where. Returns:
   *   - total: all serials matching the scope/filters
   *   - by_status: count per serial_status_enum value (every key defaults to 0)
   *   - warranty_expired: serials whose warranty_expiry < now
   *   - warranty_expiring_soon: serials with now <= warranty_expiry <= now + 30d
   *
   * by_status + total come from a single groupBy(['status']); the two warranty
   * tallies are scope-aware count() calls layered on the same base where.
   */
  async summary(
    filters: SummarySerialNumbersDto,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    total: number;
    by_status: Record<serial_status_enum, number>;
    warranty_expired: number;
    warranty_expiring_soon: number;
  }> {
    const prisma = this.client(tx);

    const baseWhere: Prisma.inventory_serial_numbersWhereInput = {};
    if (filters.product_id) baseWhere.product_id = filters.product_id;
    if (filters.location_id) baseWhere.location_id = filters.location_id;

    // Every enum key defaults to 0 so the shape is stable for the frontend.
    const by_status: Record<serial_status_enum, number> = {
      [serial_status_enum.in_stock]: 0,
      [serial_status_enum.reserved]: 0,
      [serial_status_enum.sold]: 0,
      [serial_status_enum.returned]: 0,
      [serial_status_enum.damaged]: 0,
      [serial_status_enum.expired]: 0,
      [serial_status_enum.in_transit]: 0,
    };

    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const [grouped, warranty_expired, warranty_expiring_soon] =
      await Promise.all([
        prisma.inventory_serial_numbers.groupBy({
          by: ['status'],
          where: baseWhere,
          _count: true,
        }),
        prisma.inventory_serial_numbers.count({
          where: { ...baseWhere, warranty_expiry: { lt: now } },
        }),
        prisma.inventory_serial_numbers.count({
          where: { ...baseWhere, warranty_expiry: { gte: now, lte: soon } },
        }),
      ]);

    let total = 0;
    for (const row of grouped as Array<{
      status: serial_status_enum;
      _count: number;
    }>) {
      const count = typeof row._count === 'number' ? row._count : 0;
      by_status[row.status] = count;
      total += count;
    }

    return { total, by_status, warranty_expired, warranty_expiring_soon };
  }

  // ===========================================================================
  // Pool mutations
  // ===========================================================================

  /**
   * Create a single serial row. `location_id` is required (relational scope).
   */
  async createSerial(
    dto: CreateInventorySerialNumberDto,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const prisma = this.client(tx);
    return prisma.inventory_serial_numbers.create({
      data: {
        serial_number: dto.serial_number,
        product_id: dto.product_id,
        product_variant_id: dto.product_variant_id ?? null,
        location_id: dto.location_id,
        batch_id: dto.batch_id ?? null,
        status: dto.status ?? serial_status_enum.in_stock,
        cost:
          dto.cost !== undefined ? new Prisma.Decimal(dto.cost) : undefined,
        notes: dto.notes ?? null,
      },
    });
  }

  /**
   * Populate the pool on a purchase receipt: create N `in_stock` rows for a
   * product/variant at a location.
   *
   * - Provided `serial_numbers` are used first (trimmed, de-duped, blanks
   *   dropped).
   * - If fewer real serials are provided than `qty`, the gap is filled with
   *   UNIQUE auto-generated placeholders so the pool always reaches `qty`
   *   (strict parity with stock_levels.quantity_on_hand for serialized
   *   products). Placeholders are operative tokens, replaceable later.
   * - `location_id` is ALWAYS set (non-null) so rows are visible to the
   *   scoped client.
   *
   * Returns the created serial rows.
   */
  async populatePoolOnReceipt(
    product_id: number,
    product_variant_id: number | undefined,
    location_id: number,
    batch_id: number | undefined,
    serial_numbers: string[] | undefined,
    unit_cost: number | undefined,
    qty: number,
    tx?: Prisma.TransactionClient,
  ): Promise<any[]> {
    if (qty <= 0) return [];
    const prisma = this.client(tx);

    // Normalize provided serials: trim, drop blanks, de-dupe, cap at qty.
    const provided = Array.from(
      new Set(
        (serial_numbers ?? [])
          .map((s) => (s ?? '').toString().trim())
          .filter((s) => s.length > 0),
      ),
    ).slice(0, qty);

    const serialsToCreate = [...provided];

    // Fill the remainder with unique placeholders to preserve parity.
    const missing = qty - serialsToCreate.length;
    if (missing > 0) {
      const generated = await this.generatePlaceholders(
        product_id,
        product_variant_id,
        missing,
        prisma,
      );
      serialsToCreate.push(...generated);
    }

    const created: any[] = [];
    for (const serial_number of serialsToCreate) {
      const row = await prisma.inventory_serial_numbers.create({
        data: {
          serial_number,
          product_id,
          product_variant_id: product_variant_id ?? null,
          location_id,
          batch_id: batch_id ?? null,
          status: serial_status_enum.in_stock,
          cost:
            unit_cost !== undefined
              ? new Prisma.Decimal(unit_cost)
              : undefined,
        },
      });
      created.push(row);
    }
    return created;
  }

  /**
   * Generate `count` unique placeholder serial strings. Collision-safe: a
   * placeholder includes the product id, a timestamp, a random suffix, and a
   * monotonic index. Verifies against existing rows and regenerates on the
   * rare clash (serial_number is globally @unique).
   */
  private async generatePlaceholders(
    product_id: number,
    product_variant_id: number | undefined,
    count: number,
    prisma: any,
  ): Promise<string[]> {
    const result: string[] = [];
    const base = `AUTO-SN-P${product_id}${
      product_variant_id ? `V${product_variant_id}` : ''
    }-${Date.now().toString(36).toUpperCase()}`;

    let index = 0;
    while (result.length < count) {
      const candidate = `${base}-${index
        .toString(36)
        .toUpperCase()
        .padStart(3, '0')}-${Math.random()
        .toString(36)
        .slice(2, 7)
        .toUpperCase()}`;
      index += 1;

      const exists = await prisma.inventory_serial_numbers.findFirst({
        where: { serial_number: candidate },
        select: { id: true },
      });
      if (!exists && !result.includes(candidate)) {
        result.push(candidate);
      }
    }
    return result;
  }

  // ===========================================================================
  // Backfill / edit / delete over existing stock (QUI-431 continuation)
  // ===========================================================================

  /**
   * Backfill serial identities over EXISTING on-hand stock for a
   * product/variant at a location.
   *
   * Never mutates stock: this only registers WHICH individual units the
   * existing on-hand quantity corresponds to. Parity guard (key rule):
   * existing in_stock serials + new items MUST NOT exceed
   * stock_levels.quantity_on_hand for that (product, variant, location);
   * otherwise SERIAL_PARITY_001 is thrown and nothing is created.
   *
   * Each item is created `in_stock` reusing `createSerial`. A per-item P2002
   * (globally unique serial_number) is captured into `failed` instead of
   * aborting the whole batch. `warranty_expiry` (not handled by createSerial)
   * is applied with a targeted scope-safe update when present.
   *
   * Wrapped in `$transaction` so the parity check and all inserts commit
   * atomically (the scoped client's overridden $transaction keeps tenant
   * isolation inside `tx`).
   */
  async bulkBackfill(dto: BulkBackfillSerialNumbersDto): Promise<{
    created: number;
    created_serials: any[];
    failed: { serial_number: string; reason: string }[];
  }> {
    // Normalize input the same way the rest of the service does: trim, drop
    // blanks, de-dupe case-insensitively (first occurrence wins).
    const seen = new Set<string>();
    const items = (dto.items ?? [])
      .map((item) => ({
        ...item,
        serial_number: (item.serial_number ?? '').toString().trim(),
      }))
      .filter((item) => {
        if (item.serial_number.length === 0) return false;
        const key = item.serial_number.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    if (items.length === 0) {
      return { created: 0, created_serials: [], failed: [] };
    }

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Parity guard: serials registered must not exceed units on hand.
      const stockLevel = await (tx as any).stock_levels.findFirst({
        where: {
          product_id: dto.product_id,
          product_variant_id: dto.product_variant_id ?? null,
          location_id: dto.location_id,
        },
        select: { quantity_on_hand: true },
      });
      const onHand = stockLevel?.quantity_on_hand ?? 0;

      const existing = await this.countInStock(
        dto.product_id,
        dto.location_id,
        dto.product_variant_id,
        tx,
      );

      if (existing + items.length > onHand) {
        throw new VendixHttpException(
          ErrorCodes.SERIAL_PARITY_001,
          `No puedes registrar más seriales (${
            existing + items.length
          }) que unidades en stock (${onHand}) en esta ubicación`,
          {
            product_id: dto.product_id,
            product_variant_id: dto.product_variant_id ?? null,
            location_id: dto.location_id,
            existing_serials: existing,
            new_serials: items.length,
            quantity_on_hand: onHand,
          },
        );
      }

      const created_serials: any[] = [];
      const failed: { serial_number: string; reason: string }[] = [];

      for (const item of items) {
        try {
          const row = await this.createSerial(
            {
              serial_number: item.serial_number,
              product_id: dto.product_id,
              product_variant_id: dto.product_variant_id,
              location_id: dto.location_id,
              status: serial_status_enum.in_stock,
              cost: item.cost,
              notes: item.notes,
            },
            tx,
          );

          // createSerial does not set warranty_expiry; apply it when present.
          if (item.warranty_expiry) {
            await (tx as any).inventory_serial_numbers.updateMany({
              where: { id: row.id },
              data: { warranty_expiry: new Date(item.warranty_expiry) },
            });
            row.warranty_expiry = new Date(item.warranty_expiry);
          }

          created_serials.push(row);
        } catch (error: any) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            failed.push({
              serial_number: item.serial_number,
              reason: 'Serial number ya existe (debe ser único)',
            });
            continue;
          }
          throw error;
        }
      }

      return { created: created_serials.length, created_serials, failed };
    });
  }

  /**
   * Edit the descriptive fields of a serial (serial_number / notes / cost).
   * Does NOT change status (that is PATCH /:id/status). When serial_number
   * changes, a P2002 (global @unique) is re-thrown as SERIAL_DUP_001.
   * Returns the updated serial via findOne.
   */
  async updateSerial(id: number, dto: PatchSerialNumberDto): Promise<any> {
    // Ensure it exists & is in scope (throws INV_FIND_001 otherwise).
    await this.findOne(id);

    const data: Prisma.inventory_serial_numbersUpdateInput = {
      updated_at: new Date(),
    };
    if (dto.serial_number !== undefined) {
      data.serial_number = dto.serial_number.toString().trim();
    }
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.cost !== undefined) data.cost = new Prisma.Decimal(dto.cost);
    // QUI-431 — edit warranty_expiry. undefined => leave untouched; null/''
    // => clear (NULL); a date string => persist as a Date instant.
    if (dto.warranty_expiry !== undefined) {
      data.warranty_expiry =
        dto.warranty_expiry === null || dto.warranty_expiry === ''
          ? null
          : new Date(dto.warranty_expiry);
    }

    try {
      // Scope-safe write: updateMany with the unique id, then re-read.
      await (this.prisma as any).inventory_serial_numbers.updateMany({
        where: { id },
        data,
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.SERIAL_DUP_001, undefined, {
          serial_id: id,
          serial_number: data.serial_number,
        });
      }
      throw error;
    }

    return this.findOne(id);
  }

  /**
   * Delete a serial row. Only allowed when status === in_stock AND the serial
   * is not linked to any sales/dispatch document (sales_document_serials).
   * Never touches stock. Throws SERIAL_DELETE_BLOCKED_409 otherwise,
   * INV_FIND_001 if absent.
   */
  async deleteSerial(id: number): Promise<{ success: true }> {
    const serial = await this.findOne(id);

    if (serial.status !== serial_status_enum.in_stock) {
      throw new VendixHttpException(
        ErrorCodes.SERIAL_DELETE_BLOCKED_409,
        undefined,
        { serial_id: id, status: serial.status },
      );
    }

    const linkedCount = await (
      this.prisma as any
    ).sales_document_serials.count({
      where: { serial_number_id: id },
    });
    if (linkedCount > 0) {
      throw new VendixHttpException(
        ErrorCodes.SERIAL_DELETE_BLOCKED_409,
        undefined,
        { serial_id: id, linked_documents: linkedCount },
      );
    }

    await (this.prisma as any).inventory_serial_numbers.deleteMany({
      where: { id },
    });
    return { success: true };
  }

  // ===========================================================================
  // Lifecycle transitions
  // ===========================================================================

  /**
   * Legal serial status transitions.
   * in_stock → reserved | sold | damaged | in_transit | expired
   * reserved → sold | in_stock (release) | damaged
   * sold     → returned
   * returned → in_stock | damaged
   * in_transit → in_stock
   */
  private static readonly ALLOWED_TRANSITIONS: Record<
    serial_status_enum,
    serial_status_enum[]
  > = {
    in_stock: [
      serial_status_enum.reserved,
      serial_status_enum.sold,
      serial_status_enum.damaged,
      serial_status_enum.in_transit,
      serial_status_enum.expired,
    ],
    reserved: [
      serial_status_enum.sold,
      serial_status_enum.in_stock,
      serial_status_enum.damaged,
    ],
    sold: [serial_status_enum.returned],
    returned: [serial_status_enum.in_stock, serial_status_enum.damaged],
    in_transit: [serial_status_enum.in_stock, serial_status_enum.sold],
    damaged: [],
    expired: [],
  };

  /**
   * Transition a serial to `toStatus`, validating the transition is legal.
   * Sets `sold_date` automatically when transitioning to `sold`.
   * Throws INV_VALIDATE_001 on an illegal transition, INV_FIND_001 if absent.
   */
  async transition(
    serial_id: number,
    toStatus: serial_status_enum,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const prisma = this.client(tx);

    const serial = await prisma.inventory_serial_numbers.findFirst({
      where: { id: serial_id },
      select: { id: true, status: true },
    });
    if (!serial) {
      throw new VendixHttpException(ErrorCodes.INV_FIND_001, undefined, {
        serial_id,
      });
    }

    if (serial.status === toStatus) {
      return prisma.inventory_serial_numbers.findFirst({
        where: { id: serial_id },
      });
    }

    const allowed =
      InventorySerialNumbersService.ALLOWED_TRANSITIONS[
        serial.status as serial_status_enum
      ] ?? [];
    if (!allowed.includes(toStatus)) {
      throw new VendixHttpException(
        ErrorCodes.INV_VALIDATE_001,
        `Illegal serial transition ${serial.status} → ${toStatus}`,
        { serial_id, from: serial.status, to: toStatus },
      );
    }

    const data: Prisma.inventory_serial_numbersUpdateInput = {
      status: toStatus,
      updated_at: new Date(),
    };
    if (toStatus === serial_status_enum.sold) {
      data.sold_date = new Date();
    }

    // Scope-safe write: updateMany with the unique id, then re-read.
    await prisma.inventory_serial_numbers.updateMany({
      where: { id: serial_id },
      data,
    });
    return prisma.inventory_serial_numbers.findFirst({
      where: { id: serial_id },
    });
  }

  /**
   * Return a sold serial to `returned`. When `reenterStock` is true, the
   * serial is further moved back to `in_stock` so it rejoins the sellable
   * pool (still requires a location_id, which it retains from the sale).
   */
  async returnSerial(
    serial_id: number,
    reenterStock = false,
    tx?: Prisma.TransactionClient,
  ): Promise<any> {
    const returned = await this.transition(
      serial_id,
      serial_status_enum.returned,
      tx,
    );
    if (reenterStock) {
      return this.transition(serial_id, serial_status_enum.in_stock, tx);
    }
    return returned;
  }

  // ===========================================================================
  // Document linking (polymorphic junction)
  // ===========================================================================

  /**
   * Link a serial to a concrete document line via sales_document_serials.
   * The @@unique([document_item_type, serial_number_id]) constraint is the
   * anti-double-sale guard: a second attempt to commit the same serial to the
   * same document type violates it (P2002) and is re-thrown as SERIAL_DUP_001.
   */
  async linkToDocument(
    serial_id: number,
    document_item_type: sales_document_item_type_enum,
    document_item_id: number,
    tx?: Prisma.TransactionClient,
    quantity = 1,
  ): Promise<any> {
    const prisma = this.client(tx);
    try {
      return await prisma.sales_document_serials.create({
        data: {
          serial_number_id: serial_id,
          document_item_type,
          document_item_id,
          quantity,
        },
      });
    } catch (error: any) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new VendixHttpException(ErrorCodes.SERIAL_DUP_001, undefined, {
          serial_id,
          document_item_type,
        });
      }
      throw error;
    }
  }
}
