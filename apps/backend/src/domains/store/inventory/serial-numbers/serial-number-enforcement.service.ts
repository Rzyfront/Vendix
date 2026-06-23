import { Injectable } from '@nestjs/common';
import { Prisma, serial_status_enum } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { InventorySerialNumbersService } from './inventory-serial-numbers.service';

/**
 * QUI-431 — Serial-number enforcement (strict behavior for serialized
 * products).
 *
 * A product is "serialized" when `products.requires_serial_numbers = true`.
 * Every method here is a NO-OP for non-serialized products, so callers can
 * invoke them unconditionally on any sale/dispatch/receipt path without
 * branching.
 *
 * Business rules (confirmed by the owner):
 *  - Strict parity: count(in_stock serials for product+variant+location) ==
 *    stock_levels.quantity_on_hand. Validated at item-close, not per-unit.
 *  - The pool is the source of truth for which individual units exist; free
 *    text always becomes a real pool row.
 */
@Injectable()
export class SerialNumberEnforcementService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly serials: InventorySerialNumbersService,
  ) {}

  private client(tx?: Prisma.TransactionClient): any {
    return tx ?? (this.prisma as any);
  }

  /**
   * True when the product requires serial-number tracking.
   * Reads `products.requires_serial_numbers`. Uses findFirst (scope-safe).
   */
  async isSerialized(
    product_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prisma = this.client(tx);
    const product = await prisma.products.findFirst({
      where: { id: product_id },
      select: { requires_serial_numbers: true },
    });
    return product?.requires_serial_numbers === true;
  }

  /**
   * Assert that the count of `in_stock` serials for a (product, variant,
   * location) tuple equals stock_levels.quantity_on_hand.
   *
   * No-op when the product is not serialized. Throws SERIAL_PARITY_001 on
   * mismatch (so receipts/adjustments cannot silently desynchronize the pool
   * from on-hand stock).
   */
  async assertParityForLocation(
    product_id: number,
    product_variant_id: number | undefined,
    location_id: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!(await this.isSerialized(product_id, tx))) return;

    const prisma = this.client(tx);

    const stockLevel = await prisma.stock_levels.findFirst({
      where: {
        product_id,
        product_variant_id: product_variant_id ?? null,
        location_id,
      },
      select: { quantity_on_hand: true },
    });
    const onHand = stockLevel?.quantity_on_hand ?? 0;

    const inStockCount = await this.serials.countInStock(
      product_id,
      location_id,
      product_variant_id,
      tx,
    );

    if (inStockCount !== onHand) {
      throw new VendixHttpException(ErrorCodes.SERIAL_PARITY_001, undefined, {
        product_id,
        product_variant_id: product_variant_id ?? null,
        location_id,
        in_stock_serials: inStockCount,
        quantity_on_hand: onHand,
      });
    }
  }

  /**
   * Assert that exactly `requested_qty` valid serials were provided for a
   * serialized product and that each is a real pool row currently sellable
   * (in_stock or reserved). No-op for non-serialized products.
   *
   * Throws SERIAL_REQUIRED_001 when the count differs or any provided id is
   * not a valid in_stock/reserved serial of the product.
   */
  async requireConfirmedSerials(
    product_id: number,
    requested_qty: number,
    provided_serial_ids: number[],
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (!(await this.isSerialized(product_id, tx))) return;

    const uniqueIds = Array.from(
      new Set((provided_serial_ids ?? []).filter((n) => Number.isInteger(n))),
    );

    if (uniqueIds.length !== requested_qty) {
      throw new VendixHttpException(
        ErrorCodes.SERIAL_REQUIRED_001,
        `Expected ${requested_qty} serial(s) but received ${uniqueIds.length}`,
        {
          product_id,
          requested_qty,
          provided_count: uniqueIds.length,
        },
      );
    }

    const prisma = this.client(tx);
    const validCount = await prisma.inventory_serial_numbers.count({
      where: {
        id: { in: uniqueIds },
        product_id,
        status: {
          in: [serial_status_enum.in_stock, serial_status_enum.reserved],
        },
      },
    });

    if (validCount !== requested_qty) {
      throw new VendixHttpException(
        ErrorCodes.SERIAL_REQUIRED_001,
        'One or more provided serials are invalid, not in stock, or belong to another product',
        {
          product_id,
          requested_qty,
          valid_serials: validCount,
        },
      );
    }
  }

  /**
   * Convert free-text serial strings into real pool rows for a serialized
   * product at a location and return their ids.
   *
   * - For each string: reuse an existing in_stock serial with that exact
   *   serial_number (same product) if present; otherwise create a new
   *   in_stock pool row (location_id always set).
   * - No-op (returns []) for non-serialized products.
   *
   * Note: this can drive the pool count above on-hand stock; callers that
   * need strict parity must reconcile stock separately (or call this only on
   * paths that also increment stock, e.g. receipts).
   */
  async resolveOrCreateFromFreeText(
    product_id: number,
    location_id: number,
    serial_strings: string[],
    tx?: Prisma.TransactionClient,
    product_variant_id?: number,
  ): Promise<number[]> {
    if (!(await this.isSerialized(product_id, tx))) return [];

    const prisma = this.client(tx);
    const cleaned = Array.from(
      new Set(
        (serial_strings ?? [])
          .map((s) => (s ?? '').toString().trim())
          .filter((s) => s.length > 0),
      ),
    );

    const ids: number[] = [];
    for (const serial_number of cleaned) {
      const existing = await prisma.inventory_serial_numbers.findFirst({
        where: { serial_number, product_id },
        select: { id: true, status: true },
      });

      if (existing) {
        ids.push(existing.id);
        continue;
      }

      const created = await this.serials.createSerial(
        {
          serial_number,
          product_id,
          product_variant_id,
          location_id,
          status: serial_status_enum.in_stock,
        },
        tx,
      );
      ids.push(created.id);
    }
    return ids;
  }
}
