import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import {
  FullTaxRow,
  resolveCatalogLine,
  resolveCatalogUnitPrice,
  resolveFullTaxRowsByProductId,
} from '../../../orders/utils/catalog-line-pricing.util';
import { OrderFlowService } from '../../../orders/order-flow/order-flow.service';
import { OrderHistoryService } from '../../../orders/order-history/order-history.service';
import { assertNoActiveFinancialSplit } from '../../../orders/shared/financial-split-policy';
import { resolveOrderLineTaxTotal } from '../../../taxes/utils/final-price.util';
import { getSettledOrderAmount } from '../../../payments/services/payment-validator.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { MovementsService } from '../../../cash-registers/movements/movements.service';
import { SettingsService } from '../../../settings/settings.service';
import { AddFolioChargeDto, FolioPaymentDto, VoidFolioChargeDto } from './folio.dto';
import { nightLineDescription } from './folio-nights';

/** Payment methods the desk registers by hand (gateways settle themselves). */
const MANUAL_METHODS = new Set(['cash', 'bank_transfer', 'card']);

/** Authenticated user as the JWT strategy puts it on the request. */
export interface FolioUser {
  roles?: string[];
  permissions?: Array<{ name?: string; status?: string }>;
}

/** Same rule as the POS (`PaymentsService.hasActivePermission`). */
function hasActivePermission(user: FolioUser | undefined, name: string): boolean {
  const roles = user?.roles ?? [];
  if (roles.includes('super_admin') || roles.includes('SUPER_ADMIN')) return true;
  return (user?.permissions ?? []).some((p) => p?.name === name && p?.status === 'active');
}

const toCents = (value: Prisma.Decimal | number | string | null | undefined) =>
  Math.round(Number(value ?? 0) * 100);

type Tx = Prisma.TransactionClient;

interface FolioRow {
  id: number;
  status: string;
  reservation_id: number;
  order_id: number;
}

/**
 * Hospitality Suite (H3.4) — the guest folio during the stay: nights charged
 * by the night audit (or "Cargar noche"), manual charges (laundry, minibar),
 * voids with a reason and partial payments.
 *
 * The folio is the draft POS order opened at check-in (H3.2). Every write
 * locks that order row first (`FOR UPDATE`, the same lock the table sessions
 * take), so a double click, the job and the desk never interleave.
 *
 * A partial payment is a DIRECT payment of the folio order (owner decision
 * D3, never a wallet deposit): a succeeded `payments` row and the cash
 * register sale movement, as the table session `confirmPayment`. It is NOT
 * announced as `payment.received`: on an uninvoiced order that event books
 * revenue with the order's current mix, and a folio keeps growing after the
 * payment, so the split would drift. It emits `lodging.folio_payment.received`
 * instead, booked as a customer advance (DR cash/bank, CR 2805); the folio
 * invoice (H3.7) recognizes the whole sale and crosses that advance.
 */
@Injectable()
export class LodgingFolioService {
  private readonly logger = new Logger(LodgingFolioService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly orderFlow: OrderFlowService,
    private readonly orderHistory: OrderHistoryService,
    private readonly cashSessions: SessionsService,
    private readonly cashMovements: MovementsService,
    private readonly settings: SettingsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ------------------------------------------------------------------ read

  /** Folio of a reservation: lines (voided ones too), payments and balance. */
  async getFolio(reservation_id: number) {
    const folio = await this.findFolio(reservation_id);
    const order = await this.prisma.orders.findFirst({
      where: { id: folio.order_id },
      select: {
        id: true,
        order_number: true,
        subtotal_amount: true,
        tax_amount: true,
        grand_total: true,
        total_paid: true,
        order_items: {
          select: {
            id: true,
            product_id: true,
            product_name: true,
            description: true,
            quantity: true,
            unit_price: true,
            total_price: true,
            tax_amount_item: true,
            weight: true,
            price_unit_quantity: true,
            cancelled_at: true,
            cancellation_reason: true,
            created_at: true,
            order_item_taxes: { select: { tax_amount: true } },
            lodging_room_night: { select: { night_date: true } },
          },
          orderBy: { id: 'asc' },
        },
        payments: {
          where: { state: { in: ['succeeded', 'captured', 'partially_refunded'] } },
          select: {
            id: true,
            amount: true,
            state: true,
            paid_at: true,
            created_at: true,
            store_payment_method: {
              select: {
                display_name: true,
                system_payment_method: { select: { display_name: true, type: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);

    const store_id = this.requireStoreId();
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    const pending_nights = await this.prisma.lodging_room_nights.count({
      where: {
        is_active: true,
        posted_order_item_id: null,
        night_date: { lte: new Date(`${today}T00:00:00.000Z`) },
        reservation_room: { reservation_id, cancelled_at: null },
      },
    });

    const total = Number(order.grand_total);
    const paid = Number(order.total_paid ?? 0);
    return {
      id: folio.id,
      status: folio.status,
      reservation_id,
      order_id: order.id,
      order_number: order.order_number,
      lines: order.order_items.map((item) => {
        const tax = resolveOrderLineTaxTotal(item);
        return {
          id: item.id,
          kind: item.lodging_room_night ? ('night' as const) : ('charge' as const),
          night_date: item.lodging_room_night?.night_date.toISOString().slice(0, 10) ?? null,
          description: item.description || item.product_name,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.total_price),
          tax_amount: Math.round(tax * 100) / 100,
          total: Math.round((Number(item.total_price) + tax) * 100) / 100,
          cancelled_at: item.cancelled_at,
          cancellation_reason: item.cancellation_reason,
          created_at: item.created_at,
        };
      }),
      payments: order.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        method:
          p.store_payment_method?.display_name ||
          p.store_payment_method?.system_payment_method?.display_name ||
          'Pago',
        paid_at: p.paid_at ?? p.created_at,
      })),
      subtotal: Number(order.subtotal_amount),
      tax_amount: Number(order.tax_amount),
      total,
      paid,
      balance: Math.max(0, Math.round((total - paid) * 100) / 100),
      pending_nights,
    };
  }

  // ---------------------------------------------------------------- nights

  /**
   * "Cargar noche": charges every night already due — up to tonight, store
   * day — that the folio does not have yet. Posting again adds nothing.
   */
  async postNights(reservation_id: number) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    const posted = await this.postNightsThrough(folio, today, true);
    if (posted > 0) {
      this.logger.log(`Folio ${folio.id}: ${posted} night(s) posted by hand`);
    }
    return { posted, folio: await this.getFolio(reservation_id) };
  }

  /**
   * Charges the active, unposted nights of the folio's reservation up to
   * `through` (inclusive when `inclusive`, else exclusive). One line per
   * night: the room type's service product at the night's `rate_amount`
   * snapshot, taxed like the catalog. Returns how many nights it charged.
   * Used by "Cargar noche" and by the night audit job.
   */
  async postNightsThrough(folio: FolioRow, through: string, inclusive: boolean): Promise<number> {
    const store_id = this.requireStoreId();
    const bound = new Date(`${through}T00:00:00.000Z`);
    const nightWhere: Prisma.lodging_room_nightsWhereInput = {
      store_id,
      is_active: true,
      posted_order_item_id: null,
      night_date: inclusive ? { lte: bound } : { lt: bound },
      reservation_room: { reservation_id: folio.reservation_id, cancelled_at: null },
    };
    // Cheap pre-check outside the transaction: the job visits every folio.
    const due = await this.prisma.lodging_room_nights.count({ where: nightWhere });
    if (due === 0) return 0;

    return this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        // Re-read under the lock: a concurrent post already took them.
        const nights = await tx.lodging_room_nights.findMany({
          where: nightWhere,
          select: {
            id: true,
            night_date: true,
            rate_amount: true,
            unit: { select: { code: true } },
            unit_type: {
              select: {
                name: true,
                product: { select: { id: true, name: true, price_unit_quantity: true } },
              },
            },
          },
          orderBy: [{ night_date: 'asc' }, { id: 'asc' }],
        });
        if (nights.length === 0) return 0;

        const taxRows = await resolveFullTaxRowsByProductId(
          tx,
          nights.map((n) => n.unit_type.product.id),
        );
        for (const night of nights) {
          const product = night.unit_type.product;
          const nightDate = night.night_date.toISOString().slice(0, 10);
          const item = await this.createLine(tx, order.id, {
            product_id: product.id,
            product_variant_id: null,
            product_name: product.name,
            description: nightLineDescription(nightDate, night.unit_type.name, night.unit?.code ?? null),
            quantity: 1,
            catalogUnitPrice: Number(night.rate_amount),
            priceUnitQuantityRaw: product.price_unit_quantity,
            rows: taxRows.get(product.id) ?? [],
            override: null,
          });
          // Conditional: only a night still unposted takes the line.
          const marked = await tx.lodging_room_nights.updateMany({
            where: { id: night.id, posted_order_item_id: null },
            data: { posted_order_item_id: item.id, updated_at: new Date() },
          });
          if (marked.count !== 1) {
            throw new VendixHttpException(
              ErrorCodes.LODGING_FOLIO_CHARGE_001,
              'La noche ya estaba cargada; recarga el folio',
            );
          }
        }
        await this.recalcTotals(tx, order.id);
        return nights.length;
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
  }

  // --------------------------------------------------------------- charges

  /**
   * "Agregar cargo": an existing product or service without inventory. A
   * price other than the catalog's follows the POS rule: the product must
   * allow it and the user needs `store:pos:price_override`.
   */
  async addCharge(reservation_id: number, dto: AddFolioChargeDto, user?: FolioUser) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;

    const product = await this.prisma.products.findFirst({
      where: { id: dto.product_id },
      select: {
        id: true,
        name: true,
        base_price: true,
        is_on_sale: true,
        sale_price: true,
        is_sellable: true,
        state: true,
        product_type: true,
        track_inventory: true,
        allow_pos_price_override: true,
        price_unit_quantity: true,
        product_variants: {
          select: {
            id: true,
            name: true,
            price_override: true,
            is_on_sale: true,
            sale_price: true,
            track_inventory_override: true,
          },
        },
      },
    });
    if (!product || !product.is_sellable || product.state !== 'active') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_CHARGE_001,
        'El producto no existe o no se puede vender',
      );
    }
    const variant =
      dto.product_variant_id != null
        ? product.product_variants.find((v) => v.id === dto.product_variant_id)
        : undefined;
    if (dto.product_variant_id != null && !variant) {
      throw new VendixHttpException(ErrorCodes.PRODUCT_VARIANT_MISMATCH);
    }
    if (product.product_variants.length > 0 && !variant) {
      throw new VendixHttpException(
        ErrorCodes.PRODUCT_VARIANT_REQUIRED,
        `El producto "${product.name}" tiene variantes: selecciona una.`,
      );
    }
    // Stock and recipes move with the POS sale (H3.6 charges POS sales to the
    // room); the folio itself never touches inventory.
    const tracksStock =
      product.product_type === 'prepared' ||
      (product.product_type !== 'service' &&
        (variant?.track_inventory_override ?? product.track_inventory) === true);
    if (tracksStock) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_CHARGE_001,
        `"${product.name}" maneja inventario: véndelo desde el POS`,
      );
    }

    const catalogUnitPrice = resolveCatalogUnitPrice(product, variant);
    const overridden =
      dto.unit_price != null && toCents(dto.unit_price) !== toCents(catalogUnitPrice);
    if (overridden) {
      if (!product.allow_pos_price_override) {
        throw new VendixHttpException(
          ErrorCodes.POS_PRICE_OVERRIDE_NOT_ALLOWED_001,
          `El producto "${product.name}" no permite editar el precio.`,
        );
      }
      if (!hasActivePermission(user, 'store:pos:price_override')) {
        throw new VendixHttpException(
          ErrorCodes.AUTH_PERM_001,
          'No tienes permiso para cambiar el precio del cargo.',
        );
      }
    }
    const rows = (await resolveFullTaxRowsByProductId(this.prisma, [product.id])).get(product.id) ?? [];

    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        await this.createLine(tx, order.id, {
          product_id: product.id,
          product_variant_id: variant?.id ?? null,
          product_name: product.name,
          description: variant?.name ? `${product.name} · ${variant.name}` : null,
          quantity: dto.quantity,
          catalogUnitPrice: overridden ? Number(dto.unit_price) : catalogUnitPrice,
          priceUnitQuantityRaw: product.price_unit_quantity,
          rows,
          override: overridden ? { user_id, catalogUnitPrice } : null,
        });
        await this.recalcTotals(tx, order.id);
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    return this.getFolio(reservation_id);
  }

  /**
   * "Anular": the line stays in the folio struck through with its reason and
   * leaves the totals. A voided night is not posted again. The folio total
   * can never fall below what the guest already paid.
   */
  async voidCharge(reservation_id: number, order_item_id: number, dto: VoidFolioChargeDto) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const reason = dto.reason.trim();
    if (reason.length < 3) {
      throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_VOID_001, 'Escribe el motivo de la anulación');
    }

    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        const item = await tx.order_items.findFirst({
          where: { id: order_item_id, order_id: order.id },
          select: {
            id: true,
            total_price: true,
            tax_amount_item: true,
            quantity: true,
            weight: true,
            price_unit_quantity: true,
            cancelled_at: true,
            inventory_committed: true,
            inventory_consumed_at_fire: true,
            order_item_taxes: { select: { tax_amount: true } },
          },
        });
        if (!item) {
          throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_VOID_001, 'El cargo no pertenece a este folio');
        }
        if (item.cancelled_at) return; // Already voided: nothing to write.
        if (item.inventory_committed || item.inventory_consumed_at_fire) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_FOLIO_VOID_001,
            'Este consumo ya descontó inventario: anúlalo desde su orden',
          );
        }
        const lineCents = toCents(item.total_price) + toCents(resolveOrderLineTaxTotal(item));
        const paidCents = toCents(getSettledOrderAmount(order));
        if (toCents(order.grand_total) - lineCents < paidCents) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_FOLIO_VOID_001,
            'El folio quedaría por debajo de lo ya pagado: no se puede anular este cargo',
          );
        }
        await tx.order_items.update({
          where: { id: item.id },
          data: {
            cancelled_at: new Date(),
            cancellation_reason: reason,
            cancellation_type: 'before_fire',
            updated_at: new Date(),
          },
        });
        await this.recalcTotals(tx, order.id);
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    return this.getFolio(reservation_id);
  }

  // -------------------------------------------------------------- payments

  /** Partial payment of the balance with a manual method (cash, card, transfer). */
  async registerPayment(reservation_id: number, dto: FolioPaymentDto) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id;
    if (!user_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const transaction_id = `FOLIO-${folio.id}-${dto.request_id}`;
    // Double click: the first request already registered this payment.
    const existing = await this.prisma.payments.findFirst({
      where: { transaction_id, order_id: folio.order_id },
      select: { id: true },
    });
    if (existing) return this.getFolio(reservation_id);

    const method = await this.prisma.store_payment_methods.findFirst({
      where: { id: dto.store_payment_method_id, state: 'enabled' },
      select: {
        id: true,
        display_name: true,
        system_payment_method: { select: { type: true, display_name: true } },
      },
    });
    const methodType = method?.system_payment_method?.type ?? null;
    if (!method || !methodType || !MANUAL_METHODS.has(methodType)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_PAYMENT_001,
        'Elige efectivo, tarjeta o transferencia',
      );
    }
    // Same cash gate as every sale: with the register on, the cashier needs
    // an open session before taking money.
    await this.cashSessions.assertSessionForSales(user_id);

    const emitted = await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        // A concurrent double click waited on the lock: the first one won.
        const duplicate = await tx.payments.findFirst({
          where: { transaction_id, order_id: order.id },
          select: { id: true },
        });
        if (duplicate) return null;
        const balanceCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
        const amountCents = toCents(dto.amount);
        if (amountCents > balanceCents) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_FOLIO_PAYMENT_001,
            `El pago supera el saldo del folio (${(balanceCents / 100).toFixed(2)})`,
          );
        }
        const amount = amountCents / 100;
        const now = new Date();
        const payment = await tx.payments.create({
          data: {
            order_id: order.id,
            customer_id: order.customer_id,
            amount,
            currency: order.currency,
            state: 'succeeded',
            paid_at: now,
            store_payment_method_id: method.id,
            transaction_id,
            // Booked as a customer advance (2805): the folio invoice crosses it.
            gateway_response: {
              lodging_folio: { folio_id: folio.id, created_by_user_id: user_id, accounting: 'customer_advance' },
            },
            updated_at: now,
          },
        });
        await this.recordCashMovement(tx, {
          store_id,
          user_id,
          order_id: order.id,
          payment_id: payment.id,
          amount,
          payment_method: methodType,
        });
        await tx.orders.update({
          where: { id: order.id },
          data: { total_paid: { increment: amount }, updated_at: now },
        });
        await this.recalcTotals(tx, order.id);
        await this.orderHistory.record(tx, {
          orderId: order.id,
          storeId: store_id,
          type: 'payment_registered',
          paymentId: payment.id,
          amount,
        });
        return {
          store_id,
          payment_id: payment.id,
          order_number: order.order_number,
          amount,
          payment_method_type: methodType,
          customer_id: order.customer_id,
          user_id,
        };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    // After commit, so the accounting listener reads the committed payment.
    if (emitted) this.eventEmitter.emit('lodging.folio_payment.received', emitted);
    return this.getFolio(reservation_id);
  }

  // --------------------------------------------------------------- helpers

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  private async findFolio(reservation_id: number): Promise<FolioRow> {
    const folio = await this.prisma.lodging_folios.findFirst({
      where: { reservation_id },
      select: { id: true, status: true, reservation_id: true, order_id: true },
    });
    if (!folio) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);
    return folio;
  }

  private assertOpen(folio: FolioRow): void {
    if (folio.status !== 'open') throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
  }

  /** Locks the folio order and returns it with its settled payments. */
  private async lockFolioOrder(tx: Tx, folio: FolioRow, store_id: number) {
    const locked: Array<{ id: number }> = await tx.$queryRaw`
      SELECT id FROM orders WHERE id = ${folio.order_id} AND store_id = ${store_id} FOR UPDATE
    `;
    if (!locked.length) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);
    const order = await tx.orders.findUnique({
      where: { id: folio.order_id },
      include: { payments: { select: { amount: true, state: true } } },
    });
    if (!order || order.state !== 'draft') {
      throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
    }
    assertNoActiveFinancialSplit(order);
    return order;
  }

  /** One catalog line with its tax rows, priced like the POS and table check. */
  private async createLine(
    tx: Tx,
    order_id: number,
    input: {
      product_id: number;
      product_variant_id: number | null;
      product_name: string;
      description: string | null;
      quantity: number;
      catalogUnitPrice: number;
      priceUnitQuantityRaw: unknown;
      rows: FullTaxRow[];
      override: { user_id: number | null; catalogUnitPrice: number } | null;
    },
  ) {
    const line = resolveCatalogLine({
      catalogUnitPrice: input.catalogUnitPrice,
      quantity: input.quantity,
      priceUnitQuantityRaw: input.priceUnitQuantityRaw,
      rows: input.rows,
    });
    return tx.order_items.create({
      data: {
        order_id,
        product_id: input.product_id,
        product_variant_id: input.product_variant_id,
        product_name: input.product_name,
        description: input.description,
        quantity: input.quantity,
        unit_price: new Prisma.Decimal(line.unitBase),
        total_price: new Prisma.Decimal(line.totalPrice),
        tax_rate: new Prisma.Decimal(line.taxRate),
        tax_amount_item: new Prisma.Decimal(line.taxAmountItem),
        final_unit_price: new Prisma.Decimal(line.finalUnitPrice),
        catalog_final_price: input.override
          ? new Prisma.Decimal(input.override.catalogUnitPrice)
          : null,
        is_price_overridden: input.override !== null,
        price_override_reason: input.override ? 'Cargo manual del folio' : null,
        price_overridden_by_user_id: input.override?.user_id ?? null,
        price_unit_quantity: line.priceUnitQuantity > 1 ? line.priceUnitQuantity : null,
        item_type: 'service',
        updated_at: new Date(),
        ...(input.rows.length > 0
          ? {
              order_item_taxes: {
                create: line.taxRows.map(({ row, tax_amount }) => ({
                  tax_rate_id: row.tax_rate_id,
                  tax_name: row.name,
                  tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
                  tax_amount,
                  tax_type: row.tax_type,
                  is_compound: false,
                  is_inclusive: row.is_inclusive,
                })),
              },
            }
          : {}),
      },
      select: { id: true },
    });
  }

  /** Totals and balance from the active lines (the shared order rule). */
  private async recalcTotals(tx: Tx, order_id: number): Promise<void> {
    const order = await tx.orders.findUnique({
      where: { id: order_id },
      include: { payments: { select: { id: true, amount: true, state: true } } },
    });
    await this.orderFlow.recalcOrderTotalsFromActiveLinesInTx(tx, order, order_id);
  }

  /** Cash register sale movement, same gate the POS and table checks use. */
  private async recordCashMovement(
    tx: Tx,
    args: {
      store_id: number;
      user_id: number;
      order_id: number;
      payment_id: number;
      amount: number;
      payment_method: string;
    },
  ): Promise<void> {
    const settings = await this.settings.getSettings();
    if (!(settings as { pos?: { cash_register?: { enabled?: boolean } } })?.pos?.cash_register?.enabled) {
      return;
    }
    const session = await this.cashSessions.getActiveSession(args.user_id);
    if (!session) throw new VendixHttpException(ErrorCodes.CASH_SESSION_REQUIRED_001);
    await this.cashMovements.recordSaleMovement(session.id, args, tx);
  }
}
