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
import { WalletBalanceService } from '../../../wallet/services/wallet-balance.service';
import { depositTotals } from '../deposits/lodging-deposit-math';
import { AddFolioChargeDto, FolioPaymentDto, VoidFolioChargeDto } from './folio.dto';
import { nightLineDescription } from './folio-nights';
import {
  exemptNightTaxRows,
  isVatExemptRow,
  NightTaxRow,
  VAT_EXEMPTION_TAX_NAME,
  vatExemptionBlockers,
} from '../guests/lodging-vat-exemption';

/** Payment methods the desk registers by hand (gateways settle themselves). */
const MANUAL_METHODS = new Set(['cash', 'bank_transfer', 'card']);

/** Authenticated user as the JWT strategy puts it on the request. */
export interface FolioUser {
  roles?: string[];
  permissions?: Array<{ name?: string; status?: string }>;
}

/** Same rule as the POS (`PaymentsService.hasActivePermission`). */
export function hasActivePermission(user: FolioUser | undefined, name: string): boolean {
  const roles = user?.roles ?? [];
  if (roles.includes('super_admin') || roles.includes('SUPER_ADMIN')) return true;
  return (user?.permissions ?? []).some((p) => p?.name === name && p?.status === 'active');
}

const toCents = (value: Prisma.Decimal | number | string | null | undefined) =>
  Math.round(Number(value ?? 0) * 100);

type Tx = Prisma.TransactionClient;

export interface FolioRow {
  id: number;
  status: string;
  charges_blocked?: boolean;
  reservation_id: number;
  order_id: number;
  verified_at?: Date | null;
  verified_total?: Prisma.Decimal | null;
  closed_at?: Date | null;
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
    private readonly walletBalance: WalletBalanceService,
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
            order_item_taxes: { select: { tax_amount: true, tax_name: true } },
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
            lodging_deposit: { select: { id: true } },
            transaction_id: true,
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

    // H3.6 — lines moved here by a POS sale or table bill keep their origin.
    const origins = new Map<number, string>();
    const roomCharges = await this.prisma.lodging_room_charges.findMany({
      where: { folio_id: folio.id },
      select: { origin: true, item_ids: true },
    });
    for (const charge of roomCharges) {
      for (const itemId of charge.item_ids) origins.set(itemId, charge.origin);
    }

    const total = Number(order.grand_total);
    const paid = Number(order.total_paid ?? 0);
    // H3.5 — deposit still held for the stay, applicable as "Anticipo aplicado".
    const deposit = depositTotals(
      await this.prisma.lodging_deposits.findMany({
        where: { reservation_id },
        select: { kind: true, status: true, amount: true },
      }),
    );
    return {
      id: folio.id,
      status: folio.status,
      charges_blocked: folio.charges_blocked ?? false,
      reservation_id,
      order_id: order.id,
      order_number: order.order_number,
      lines: order.order_items.map((item) => {
        const tax = resolveOrderLineTaxTotal(item);
        return {
          id: item.id,
          kind: item.lodging_room_night ? ('night' as const) : ('charge' as const),
          origin: origins.get(item.id) ?? null,
          night_date: item.lodging_room_night?.night_date.toISOString().slice(0, 10) ?? null,
          // A POS/table line carries the catalog description: show its name.
          description: origins.has(item.id) ? item.product_name : item.description || item.product_name,
          product_name: item.product_name,
          quantity: item.quantity,
          unit_price: Number(item.unit_price),
          subtotal: Number(item.total_price),
          tax_amount: Math.round(tax * 100) / 100,
          total: Math.round((Number(item.total_price) + tax) * 100) / 100,
          // H3.9 — night invoiced with VAT 0 % "Exento – art. 481 lit. d ET".
          vat_exempt: item.order_item_taxes.some(isVatExemptRow),
          cancelled_at: item.cancelled_at,
          cancellation_reason: item.cancellation_reason,
          created_at: item.created_at,
        };
      }),
      payments: order.payments.map((p) => ({
        id: p.id,
        kind: p.lodging_deposit ? ('deposit' as const) : ('payment' as const),
        amount: Number(p.amount),
        method: p.lodging_deposit
          ? 'Anticipo aplicado'
          : isOnlinePaymentTransaction(folio.id, p.transaction_id)
            ? 'Pago en línea de la reserva'
            : p.store_payment_method?.display_name ||
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
      deposit_available: Number(deposit.balance.toFixed(2)),
      // H6.6 — online reservation payment not applied to the folio yet.
      online_payment_available: await this.onlinePaymentAvailable(reservation_id),
      // H3.7 / D11 — reviewed at this total; a later change asks again.
      verified_at: folio.verified_at ?? null,
      verified_current:
        !!folio.verified_at && toCents(folio.verified_total) === toCents(order.grand_total),
      closed_at: folio.closed_at ?? null,
      vat_exemption: await this.vatExemptionStatus(reservation_id),
    };
  }

  // ---------------------------------------------------------- VAT exemption

  /**
   * H3.9 — "No residente – exento de IVA" of the holder: applied or not, and
   * why it cannot be applied (no RNT, no passport, no entry permit...).
   */
  async vatExemptionStatus(reservation_id: number) {
    const holder = await this.findHolder(reservation_id);
    const reasons = vatExemptionBlockers(await this.rntNumber(), holder);
    return {
      applied: !!holder?.vat_exempt_at,
      available: reasons.length === 0,
      reasons,
      applied_at: holder?.vat_exempt_at ?? null,
    };
  }

  /**
   * Marks or clears the holder's exemption and re-prices the nights already
   * on the folio: exempt nights keep their pre-tax base with VAT 0 %, cleared
   * ones go back to the catalog taxes. Consumptions and manual charges never
   * change. The folio total changes, so a D11 review asks again.
   */
  async setVatExemption(reservation_id: number, enabled: boolean) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;

    const holder = await this.findHolder(reservation_id);
    if (enabled) {
      const reasons = vatExemptionBlockers(await this.rntNumber(), holder);
      if (reasons.length > 0) {
        throw new VendixHttpException(ErrorCodes.LODGING_VAT_EXEMPT_001, reasons.join('. '));
      }
    }

    await this.prisma.$transaction(
      async (tx) => {
        await this.lockFolioOrder(tx, folio, store_id);
        if (holder) {
          await tx.lodging_guests.update({
            where: { id: holder.id },
            data: {
              vat_exempt_at: enabled ? new Date() : null,
              vat_exempt_by_user_id: enabled ? user_id : null,
              updated_at: new Date(),
            },
          });
        }
        await this.repriceNights(tx, folio.order_id, enabled);
        await this.recalcTotals(tx, folio.order_id);
        const order = await tx.orders.findUnique({
          where: { id: folio.order_id },
          include: { payments: { select: { amount: true, state: true } } },
        });
        if (order && toCents(getSettledOrderAmount(order)) > toCents(order.grand_total)) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_VAT_EXEMPT_001,
            'Los pagos del folio superarían el nuevo total',
          );
        }
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    this.logger.log(`Folio ${folio.id}: VAT exemption ${enabled ? 'applied' : 'cleared'}`);
    return this.getFolio(reservation_id);
  }

  /**
   * Check-out guard: exempt nights are invoiced only while the holder still
   * qualifies (the guest or the store RNT may have changed since).
   */
  async assertVatExemptionHolds(folio: FolioRow): Promise<void> {
    const exemptLines = await this.prisma.order_items.count({
      where: {
        order_id: folio.order_id,
        cancelled_at: null,
        order_item_taxes: { some: { tax_name: VAT_EXEMPTION_TAX_NAME } },
      },
    });
    if (exemptLines === 0) return;
    const holder = await this.findHolder(folio.reservation_id);
    const reasons = vatExemptionBlockers(await this.rntNumber(), holder);
    if (!holder?.vat_exempt_at) reasons.push('El titular ya no tiene la exención aplicada');
    if (reasons.length > 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_VAT_EXEMPT_001,
        `La exención de IVA ya no aplica: ${reasons.join('. ')}. Quítala del folio para facturar` +
          (folio.order_id && (await this.hasActiveSplit(folio.order_id)) ? ' (cancela antes la división del folio)' : ''),
      );
    }
  }

  private async hasActiveSplit(order_id: number): Promise<boolean> {
    const order = await this.prisma.orders.findUnique({
      where: { id: order_id },
      select: { active_financial_split_id: true },
    });
    return !!order?.active_financial_split_id;
  }

  /**
   * Every active night line of the folio, re-priced exempt or taxed from its
   * OWN pre-tax base and product: the exemption only drops or restores the
   * VAT, it never re-reads the night rate (a room change may have moved it).
   * The rows go exclusive on that base, so the base never changes.
   */
  private async repriceNights(tx: Tx, order_id: number, exempt: boolean): Promise<void> {
    const items = await tx.order_items.findMany({
      where: { order_id, cancelled_at: null, lodging_room_night: { isNot: null } },
      select: {
        id: true,
        quantity: true,
        unit_price: true,
        product_id: true,
        products: { select: { price_unit_quantity: true } },
      },
    });
    if (items.length === 0) return;
    const taxRows = await resolveFullTaxRowsByProductId(
      tx,
      items.map((i) => i.product_id).filter((id): id is number => id !== null),
    );
    for (const item of items) {
      const catalog = item.product_id !== null ? (taxRows.get(item.product_id) ?? []) : [];
      const rows = (exempt ? exemptNightTaxRows(catalog) : catalog).map((row) => ({
        ...row,
        is_inclusive: false,
      }));
      const line = resolveCatalogLine({
        catalogUnitPrice: Number(item.unit_price),
        quantity: item.quantity,
        priceUnitQuantityRaw: item.products?.price_unit_quantity ?? null,
        rows: rows as FullTaxRow[],
      });
      await tx.order_item_taxes.deleteMany({ where: { order_item_id: item.id } });
      await tx.order_items.update({
        where: { id: item.id },
        data: {
          unit_price: new Prisma.Decimal(line.unitBase),
          total_price: new Prisma.Decimal(line.totalPrice),
          tax_rate: new Prisma.Decimal(line.taxRate),
          tax_amount_item: new Prisma.Decimal(line.taxAmountItem),
          final_unit_price: new Prisma.Decimal(line.finalUnitPrice),
          updated_at: new Date(),
          ...(rows.length > 0 ? { order_item_taxes: { create: this.taxRowsData(line.taxRows) } } : {}),
        },
      });
    }
  }

  /**
   * Price and tax rows of a night. Taxed: the rate with the catalog rows.
   * Exempt (H3.9): the pre-tax base the catalog rows give that rate, with the
   * VAT rows replaced by the exempt VAT 0 % row; a product without VAT has
   * nothing to exempt and keeps its rows.
   */
  private nightPricing(
    rate: number,
    priceUnitQuantityRaw: unknown,
    rows: FullTaxRow[],
    exempt: boolean,
  ): { catalogUnitPrice: number; rows: NightTaxRow[] } {
    const exemptRows = exempt ? exemptNightTaxRows(rows) : rows;
    if (exemptRows === rows) return { catalogUnitPrice: rate, rows };
    const taxed = resolveCatalogLine({ catalogUnitPrice: rate, quantity: 1, priceUnitQuantityRaw, rows });
    return { catalogUnitPrice: taxed.unitBase, rows: exemptRows };
  }

  /** Holder (primary guest) of the reservation with the exemption evidence. */
  private findHolder(reservation_id: number) {
    return this.prisma.lodging_guests.findFirst({
      where: { reservation_id, is_primary: true },
      select: {
        id: true,
        is_primary: true,
        document_type: true,
        nationality_country_code: true,
        entry_permit_type: true,
        is_non_resident: true,
        vat_exempt_at: true,
      },
    });
  }

  private async rntNumber(): Promise<string | null> {
    const settings = (await this.settings.getSettings()) as { hospitality?: { rnt_number?: string } };
    return settings?.hospitality?.rnt_number ?? null;
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

        // H3.9 — the holder took the VAT exemption: nights go out at VAT 0 %.
        // Read after the order lock, so a concurrent change already committed.
        const exempt = !!(await this.findHolder(folio.reservation_id))?.vat_exempt_at;
        const taxRows = await resolveFullTaxRowsByProductId(
          tx,
          nights.map((n) => n.unit_type.product.id),
        );
        for (const night of nights) {
          const product = night.unit_type.product;
          const nightDate = night.night_date.toISOString().slice(0, 10);
          const priced = this.nightPricing(
            Number(night.rate_amount),
            product.price_unit_quantity,
            taxRows.get(product.id) ?? [],
            exempt,
          );
          const item = await this.createLine(tx, order.id, {
            product_id: product.id,
            product_variant_id: null,
            product_name: product.name,
            description: nightLineDescription(nightDate, night.unit_type.name, night.unit?.code ?? null),
            quantity: 1,
            catalogUnitPrice: priced.catalogUnitPrice,
            priceUnitQuantityRaw: product.price_unit_quantity,
            rows: priced.rows,
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

  /**
   * H3.6 — "Cargos bloqueados": while on, the POS and the tables cannot charge
   * this room (the desk can still add charges here).
   */
  async setChargesBlocked(reservation_id: number, blocked: boolean) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    await this.prisma.lodging_folios.update({
      where: { id: folio.id },
      data: { charges_blocked: blocked, updated_at: new Date() },
    });
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

  // --------------------------------------------------------------- deposit

  /**
   * H3.5 — "Aplicar anticipo": the reservation deposit (a wallet advance, D3)
   * pays the folio up to its balance, shown as "Anticipo aplicado". The
   * wallet is debited and the folio gets a payment linked to the deposit
   * ledger row. No accounting entry: the money already sits in 2805 customer
   * advance since the deposit was received, as every folio payment does, and
   * the folio invoice (H3.7) crosses it. Applying again only takes what is
   * left; the check-out (H3.7) applies the rest.
   */
  async applyDeposit(reservation_id: number) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;

    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        if (!order.customer_id) {
          throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'El folio no tiene titular');
        }
        const rows = await tx.lodging_deposits.findMany({
          where: { store_id, reservation_id },
          select: { kind: true, status: true, amount: true },
        });
        const heldCents = toCents(depositTotals(rows).balance.toString());
        if (heldCents <= 0) {
          throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'No hay anticipo por aplicar');
        }
        const balanceCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
        if (balanceCents <= 0) {
          throw new VendixHttpException(ErrorCodes.LODGING_DEPOSIT_001, 'El folio no tiene saldo por cubrir');
        }
        const wallet = await tx.wallets.findFirst({
          where: { store_id, customer_id: order.customer_id },
          select: { id: true, balance: true, held_balance: true },
        });
        const availableCents = wallet ? toCents(wallet.balance) - toCents(wallet.held_balance) : 0;
        const amountCents = Math.min(heldCents, balanceCents, availableCents);
        if (!wallet || amountCents <= 0) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_DEPOSIT_001,
            'La wallet del titular no tiene saldo para el anticipo',
          );
        }
        const amount = amountCents / 100;
        const now = new Date();
        const applied = rows.filter((row) => row.kind === 'applied').length;
        const payment = await tx.payments.create({
          data: {
            order_id: order.id,
            customer_id: order.customer_id,
            amount,
            currency: order.currency,
            state: 'succeeded',
            paid_at: now,
            transaction_id: `FOLIO-${folio.id}-DEPOSIT-${applied + 1}`,
            gateway_response: {
              lodging_folio: {
                folio_id: folio.id,
                created_by_user_id: user_id,
                accounting: 'customer_advance',
                source: 'deposit',
              },
            },
            updated_at: now,
          },
        });
        const debit = await this.walletBalance.debitInTransaction(tx, wallet.id, amount, {
          reference_type: 'lodging_deposit',
          reference_id: reservation_id,
          description: `Anticipo aplicado al folio ${order.order_number}`,
          created_by: user_id ?? undefined,
          expected_store_id: store_id,
          expected_customer_id: order.customer_id,
        });
        await tx.lodging_deposits.create({
          data: {
            store_id,
            reservation_id,
            kind: 'applied',
            status: 'completed',
            amount,
            wallet_transaction_id: debit.transaction.id,
            payment_id: payment.id,
            created_by_user_id: user_id,
          },
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
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    return this.getFolio(reservation_id);
  }

  // ---------------------------------------------------------- online payment

  /** H6.6 — what the online reservation payments still have to apply. */
  private async onlinePaymentAvailable(reservation_id: number): Promise<number> {
    const rows = await this.prisma.lodging_reservation_payments.findMany({
      where: { reservation_id, status: 'completed' },
      select: { amount: true, applied_amount: true },
    });
    const cents = rows.reduce((sum, row) => sum + toCents(row.amount) - toCents(row.applied_amount), 0);
    return Math.max(0, cents) / 100;
  }

  /**
   * H6.6 — the reservation paid online (booking engine) pays the folio up to
   * its balance, as a folio payment "Pago en línea de la reserva". It is a
   * direct payment, never a deposit (D3): no wallet. No accounting entry
   * either: Wompi's confirmation already booked it DR bank / CR 2805, as any
   * folio payment, and the folio invoice crosses it. The check-out (H3.7)
   * calls it before the deposit.
   */
  async applyOnlinePayments(reservation_id: number) {
    const folio = await this.findFolio(reservation_id);
    this.assertOpen(folio);
    const store_id = this.requireStoreId();
    const user_id = RequestContextService.getContext()?.user_id ?? null;

    await this.prisma.$transaction(
      async (tx) => {
        const order = await this.lockFolioOrder(tx, folio, store_id);
        const rows = await tx.lodging_reservation_payments.findMany({
          where: { store_id, reservation_id, status: 'completed' },
          select: { id: true, amount: true, applied_amount: true, method: true },
          orderBy: { id: 'asc' },
        });
        let balanceCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
        let appliedCents = 0;
        const now = new Date();
        for (const row of rows) {
          const amountCents = Math.min(toCents(row.amount) - toCents(row.applied_amount), balanceCents);
          if (amountCents <= 0) continue;
          const amount = amountCents / 100;
          const payment = await tx.payments.create({
            data: {
              order_id: order.id,
              customer_id: order.customer_id,
              amount,
              currency: order.currency,
              state: 'succeeded',
              paid_at: now,
              transaction_id: `${onlinePaymentPrefix(folio.id)}${row.id}-${toCents(row.applied_amount)}`,
              gateway_response: {
                lodging_folio: {
                  folio_id: folio.id,
                  created_by_user_id: user_id,
                  accounting: 'customer_advance',
                  source: 'online_reservation_payment',
                  reservation_payment_id: row.id,
                  method: row.method,
                },
              },
              updated_at: now,
            },
          });
          await tx.lodging_reservation_payments.update({
            where: { id: row.id },
            data: { applied_amount: { increment: amount }, updated_at: now },
          });
          await this.orderHistory.record(tx, {
            orderId: order.id,
            storeId: store_id,
            type: 'payment_registered',
            paymentId: payment.id,
            amount,
          });
          balanceCents -= amountCents;
          appliedCents += amountCents;
        }
        if (appliedCents > 0) {
          await tx.orders.update({
            where: { id: order.id },
            data: { total_paid: { increment: appliedCents / 100 }, updated_at: now },
          });
          await this.recalcTotals(tx, order.id);
        }
      },
      { timeout: 20_000, maxWait: 5_000 },
    );
    return this.getFolio(reservation_id);
  }

  // --------------------------------------------------------------- helpers

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    return store_id;
  }

  async findFolio(reservation_id: number): Promise<FolioRow> {
    const folio = await this.prisma.lodging_folios.findFirst({
      where: { reservation_id },
      select: {
        id: true,
        status: true,
        charges_blocked: true,
        reservation_id: true,
        order_id: true,
        verified_at: true,
        verified_total: true,
        closed_at: true,
      },
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
      rows: NightTaxRow[];
      override: { user_id: number | null; catalogUnitPrice: number } | null;
    },
  ) {
    // The exempt VAT row (H3.9) has no catalog rate; pricing reads only rate
    // and inclusiveness, so it prices like any other row.
    const line = resolveCatalogLine({
      catalogUnitPrice: input.catalogUnitPrice,
      quantity: input.quantity,
      priceUnitQuantityRaw: input.priceUnitQuantityRaw,
      rows: input.rows as FullTaxRow[],
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
          ? { order_item_taxes: { create: this.taxRowsData(line.taxRows) } }
          : {}),
      },
      select: { id: true },
    });
  }

  /** `order_item_taxes` rows of a priced line (snapshot per rate). */
  private taxRowsData(taxRows: ReturnType<typeof resolveCatalogLine>['taxRows']) {
    return taxRows.map(({ row, tax_amount }) => ({
      tax_rate_id: (row as NightTaxRow).tax_rate_id,
      tax_name: row.name,
      tax_rate: Math.round((row.rate + Number.EPSILON) * 100000) / 100000,
      tax_amount,
      tax_type: row.tax_type,
      is_compound: false,
      is_inclusive: row.is_inclusive,
    }));
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

/** H6.6 — transaction id prefix of a folio payment from an online reservation payment. */
function onlinePaymentPrefix(folio_id: number): string {
  return `FOLIO-${folio_id}-ONLINE-`;
}

function isOnlinePaymentTransaction(folio_id: number, transaction_id: string | null): boolean {
  return !!transaction_id?.startsWith(onlinePaymentPrefix(folio_id));
}
