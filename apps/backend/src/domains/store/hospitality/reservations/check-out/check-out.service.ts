import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { getSettledOrderAmount } from '../../../payments/services/payment-validator.service';
import { OrderHistoryService } from '../../../orders/order-history/order-history.service';
import { SettingsService } from '../../../settings/settings.service';
import { AccountsReceivableService } from '../../../accounts-receivable/accounts-receivable.service';
import { PosFiscalEmissionService } from '../../../invoicing/pos/pos-fiscal-emission.service';
import { PosFiscalStatus } from '../../../invoicing/pos/pos-fiscal-status.interface';
import { InvoicePdfService } from '../../../invoicing/services/invoice-pdf.service';
import { InvoicingService } from '../../../invoicing/invoicing.service';
import { SessionsService } from '../../../cash-registers/sessions/sessions.service';
import { buildOrderSaleTaxPayload } from '../../../payments/utils/order-sale-tax-payload.util';
import { LodgingReservationsService } from '../reservations.service';
import { formatShortDate } from '../stay-dates';
import { LODGING_CHECKED_OUT_EVENT } from '../stay-events';
import { FolioUser, FolioRow, hasActivePermission, LodgingFolioService } from '../folio/folio.service';
import { CheckOutDto } from './check-out.dto';

/** Dedicated permission of the review before the folio invoice (D11). */
export const FOLIO_VERIFY_PERMISSION = 'store:lodging:folio:verify';

/** Account of a split folio (H3.8). */
interface SplitAccountRow {
  id: number;
  label: string;
  grand_total: Prisma.Decimal;
}

/** Invoice of one account of a split folio (H3.8). */
export interface FolioAccountInvoice {
  account_id: number;
  label: string;
  grand_total: number;
  invoice: PosFiscalStatus | null;
  invoice_id: number | null;
  invoice_number: string | null;
  status: string | null;
}

/** Housekeeping states a departure turns into "Sucia". */
const DIRTY_FROM = ['clean', 'inspected'] as const;

const toCents = (value: Prisma.Decimal | number | string | null | undefined) =>
  Math.round(Number(value ?? 0) * 100);

/**
 * Hospitality Suite (H3.7) — check-out: the folio is reviewed (D11), its
 * last nights posted, the deposit left applied and the balance paid (or
 * charged to the company's credit); then it closes, the reservation becomes
 * "Salida", its rooms "Sucia", and ONE electronic invoice is emitted for the
 * whole folio order (D5).
 *
 * Money and accounting reuse what exists: the balance is a folio payment
 * (`LodgingFolioService.registerPayment`, a 2805 advance like every folio
 * payment), the credit is an `accounts_receivable` of the order
 * (`createCreditSaleFromEvent`, payment form 2) and the invoice is the POS
 * fiscal emission (`emitForOrder`, idempotent: it reuses the document of the
 * order and never takes a second number). Its acceptance books revenue + VAT
 * against 1305, and `lodging.folio_settlement` crosses the 2805 advance.
 *
 * Without electronic invoicing in the store (owner decision 2026-10-27) the
 * check-out recognizes the sale itself (`lodging.folio.sale_recognized`:
 * DR 1305 / CR revenue + taxes, then the 2805 cross); never blocking.
 *
 * Closing is a conditional update (open → closed): a double click closes
 * once, and only the request that closed emits; a repeated check-out only
 * retries a failed emission of the same document.
 */
@Injectable()
export class LodgingCheckOutService {
  private readonly logger = new Logger(LodgingCheckOutService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly folios: LodgingFolioService,
    private readonly reservations: LodgingReservationsService,
    private readonly orderHistory: OrderHistoryService,
    private readonly settings: SettingsService,
    private readonly receivables: AccountsReceivableService,
    private readonly fiscalEmission: PosFiscalEmissionService,
    private readonly pdfService: InvoicePdfService,
    private readonly eventEmitter: EventEmitter2,
    private readonly invoicing: InvoicingService,
    private readonly cashSessions: SessionsService,
  ) {}

  /**
   * "Verificar folio" (D11): a user holding the dedicated permission reviews
   * the folio at its current total, after the nights already slept.
   */
  async verify(reservation_id: number) {
    const folio = await this.openFolio(reservation_id);
    await this.postSleptNights(folio);
    await this.markVerified(folio.id, folio.order_id);
    return this.folios.getFolio(reservation_id);
  }

  async checkOut(reservation_id: number, dto: CheckOutDto, user?: FolioUser) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id ?? null;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);

    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: { id: true, status: true, customer_id: true },
    });
    if (!reservation) throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    const folio = await this.folios.findFolio(reservation_id);

    // Repeated check-out: never a second invoice, only a retry of the same one.
    if (reservation.status === 'checked_out' && folio.status === 'closed') {
      await this.retryAfterClose(folio.order_id, store_id, context?.organization_id, user_id);
      return this.result(reservation_id, folio.order_id, true);
    }
    if (reservation.status !== 'checked_in' || folio.status !== 'open') {
      throw new VendixHttpException(ErrorCodes.LODGING_CHECKOUT_001);
    }

    // H3.8 — split folio: each account is paid apart and invoiced to its payer.
    const split = await this.activeSplitAccounts(folio.order_id);
    if (split && (dto.charge_to_credit || dto.bill_to_customer_id != null)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKOUT_BILL_TO_001,
        'La cuenta está dividida: cada parte se factura a su titular',
      );
    }

    const billTo = dto.bill_to_customer_id ?? null;
    if (billTo !== null && billTo !== reservation.customer_id) {
      const customer = await this.prisma.users.findFirst({
        where: { id: billTo, store_users: { some: { store_id } } },
        select: { id: true },
      });
      if (!customer) {
        throw new VendixHttpException(ErrorCodes.LODGING_CHECKOUT_BILL_TO_001);
      }
    }
    if (dto.charge_to_credit && (billTo === null || billTo === reservation.customer_id)) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKOUT_BILL_TO_001,
        'El crédito es de una empresa: elige la empresa a facturar',
      );
    }

    // 1. The folio as it will be invoiced: every night slept is charged.
    await this.postSleptNights(folio);
    // H3.9 — exempt nights only while the holder still qualifies.
    await this.folios.assertVatExemptionHolds(folio);

    // 2. D11 review at this total (before any money moves).
    await this.assertVerified(reservation_id, folio, dto, user);

    // The credit route sells without cash: the POS cash-session rule still
    // applies, checked before any money moves.
    if (dto.charge_to_credit) {
      await this.cashSessions.assertSessionForSales(user_id ?? undefined);
    }

    // 3. H6.6 — the online reservation payment, then the deposit still
    // held ("Anticipo aplicado").
    let current = await this.folios.getFolio(reservation_id);
    if (!split && current.online_payment_available > 0 && current.balance > 0) {
      current = await this.folios.applyOnlinePayments(reservation_id);
    }
    if (!split && current.deposit_available > 0 && current.balance > 0) {
      current = await this.folios.applyDeposit(reservation_id);
    }

    // 4. Balance: paid now, charged to credit, or the check-out stops.
    if (split && current.balance > 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKOUT_BALANCE_001,
        'La cuenta está dividida: cobra cada parte antes del check-out',
      );
    }
    if (current.balance > 0 && !dto.charge_to_credit) {
      if (!dto.store_payment_method_id) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_CHECKOUT_BALANCE_001,
          `La cuenta tiene un saldo de ${current.balance.toFixed(2)}: cóbralo o cárgalo a crédito de la empresa`,
        );
      }
      await this.folios.registerPayment(reservation_id, {
        amount: current.balance,
        store_payment_method_id: dto.store_payment_method_id,
        request_id: dto.request_id,
      });
    }

    // 5. Close: folio, order, reservation and rooms, all or nothing.
    const verifyTotal = await this.verificationRequired();
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    const closed = await this.prisma.$transaction(
      async (tx) => {
        const locked: Array<{ id: number }> = await tx.$queryRaw`
          SELECT id FROM orders WHERE id = ${folio.order_id} AND store_id = ${store_id} FOR UPDATE
        `;
        if (!locked.length) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);
        const order = await tx.orders.findUnique({
          where: { id: folio.order_id },
          include: { payments: { select: { amount: true, state: true } } },
        });
        if (!order) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);
        // D11 again under the lock: a charge may have entered after the review.
        if (verifyTotal) {
          const stored = await tx.lodging_folios.findUnique({
            where: { id: folio.id },
            select: { verified_total: true },
          });
          if (toCents(stored?.verified_total) !== toCents(order.grand_total)) {
            throw new VendixHttpException(
              ErrorCodes.LODGING_CHECKOUT_VERIFY_001,
              'La cuenta cambió después de verificarla: un usuario con permiso debe verificarla de nuevo',
            );
          }
        }
        const now = new Date();
        // Only one request moves the folio from open: the double click gets 0.
        const updated = await tx.lodging_folios.updateMany({
          where: { id: folio.id, status: 'open' },
          data: { status: 'closed', closed_at: now, closed_by_user_id: user_id, updated_at: now },
        });
        if (updated.count !== 1) return null;

        const remainingCents = toCents(order.grand_total) - toCents(getSettledOrderAmount(order));
        if (remainingCents > 0 && !dto.charge_to_credit) {
          throw new VendixHttpException(ErrorCodes.LODGING_CHECKOUT_BALANCE_001);
        }
        const credit = remainingCents > 0;
        await tx.orders.update({
          where: { id: order.id },
          data: {
            state: 'finished',
            completed_at: now,
            customer_id: billTo ?? order.customer_id,
            payment_form: credit ? '2' : '1',
            remaining_balance: Math.max(0, remainingCents) / 100,
            updated_at: now,
          },
        });
        await this.orderHistory.record(tx, {
          orderId: order.id,
          storeId: store_id,
          type: 'state_changed',
          // A paid split already moved the order on (draft → processing).
          fromState: order.state,
          toState: 'finished',
        });

        const moved = await tx.lodging_reservations.updateMany({
          where: { id: reservation_id, status: 'checked_in' },
          data: { status: 'checked_out', updated_at: now },
        });
        if (moved.count !== 1) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
            'La reserva cambió de estado; recarga e inténtalo de nuevo',
          );
        }
        await tx.lodging_reservation_events.create({
          data: {
            store_id,
            reservation_id,
            from_status: 'checked_in',
            to_status: 'checked_out',
            reason: null,
            user_id,
          },
        });

        const rooms = await tx.lodging_reservation_rooms.findMany({
          where: { reservation_id, cancelled_at: null, unit_id: { not: null } },
          select: { unit_id: true },
        });
        // Early departure: the nights not slept stop blocking the rooms.
        await tx.lodging_room_nights.updateMany({
          where: {
            reservation_room: { reservation_id },
            posted_order_item_id: null,
            is_active: true,
            night_date: { gte: new Date(`${today}T00:00:00.000Z`) },
          },
          data: { is_active: false, updated_at: now },
        });
        const unitIds = rooms.map((r) => r.unit_id as number);
        if (unitIds.length > 0) {
          await tx.lodging_units.updateMany({
            where: { id: { in: unitIds }, housekeeping_status: { in: [...DIRTY_FROM] } },
            data: { housekeeping_status: 'dirty', updated_at: now },
          });
        }

        // Stock cost of the POS/table consumptions moved to the folio (H3.6).
        const cost = await tx.lodging_room_charges.aggregate({
          where: { folio_id: folio.id },
          _sum: { cost_amount: true },
        });
        return {
          order_number: order.order_number,
          remaining: remainingCents / 100,
          credit,
          total_cost: Number(cost._sum.cost_amount ?? 0),
        };
      },
      { timeout: 20_000, maxWait: 5_000 },
    );

    // A concurrent click closed it first: answer with its result, no emission.
    if (!closed) return this.result(reservation_id, folio.order_id, false);

    // H4.1 — the TRA report of the departure listens; it never blocks the desk.
    this.eventEmitter.emit(LODGING_CHECKED_OUT_EVENT, { store_id, reservation_id });

    // After commit, so the listeners read the closed order.
    if (closed.credit) {
      await this.receivables.createCreditSaleFromEvent({
        order_id: folio.order_id,
        total_amount: closed.remaining,
        store_id,
      });
    }
    if (closed.total_cost > 0) {
      this.eventEmitter.emit('order.completed', {
        order_id: folio.order_id,
        order_number: closed.order_number,
        organization_id: context?.organization_id,
        store_id,
        total_cost: closed.total_cost,
        user_id: user_id ?? undefined,
      });
    }
    if (!split) await this.recognizeSale(folio.order_id, store_id, context?.organization_id, user_id);
    return this.result(reservation_id, folio.order_id, true);
  }

  /** Signed URL of the folio invoice PDF (the desk has no invoicing:read). */
  async invoicePdf(reservation_id: number, account_id?: number): Promise<{ url: string }> {
    const folio = await this.folios.findFolio(reservation_id);
    const invoice = await this.prisma.invoices.findFirst({
      where: {
        order_id: folio.order_id,
        // H3.8 — a split folio has one invoice per account.
        ...(account_id ? { financial_account_id: account_id } : {}),
        invoice_type: 'sales_invoice',
        status: { notIn: ['voided', 'cancelled'] },
      },
      select: { id: true },
      orderBy: { id: 'desc' },
    });
    if (!invoice) {
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_003, 'La cuenta no tiene factura');
    }
    return { url: await this.pdfService.getPdf(invoice.id) };
  }

  // --------------------------------------------------------------- helpers

  /**
   * Reservation, folio and invoice status. `emit` runs the (idempotent)
   * emission; otherwise the current status is only read.
   */
  private async result(reservation_id: number, order_id: number, emit: boolean) {
    const split = await this.activeSplitAccounts(order_id);
    if (split) {
      return {
        reservation: await this.reservations.findOne(reservation_id),
        folio: await this.folios.getFolio(reservation_id),
        invoice: null,
        invoices: await this.splitInvoices(split, emit),
      };
    }
    let invoice: PosFiscalStatus | null = null;
    try {
      invoice = emit
        ? await this.emitOnce(order_id)
        : await this.fiscalEmission.getStatusForOrder(order_id);
    } catch (error) {
      // The guest already paid and left: the folio stays closed, the desk
      // retries the invoice with the same check-out.
      this.logger.error(`Folio order ${order_id}: invoice emission failed: ${(error as Error).message}`);
    }
    return {
      reservation: await this.reservations.findOne(reservation_id),
      folio: await this.folios.getFolio(reservation_id),
      invoice,
    };
  }

  /**
   * H3.8 — one invoice per account of the split folio, each to its payer.
   * `emitForFinancialAccount` is idempotent (it reuses the account's document
   * and never takes a second number); without `emit` only the stored
   * document is read.
   */
  private async splitInvoices(accounts: SplitAccountRow[], emit: boolean) {
    const result: FolioAccountInvoice[] = [];
    for (const account of accounts) {
      let invoice: PosFiscalStatus | null = null;
      if (emit) {
        try {
          invoice = await this.fiscalEmission.emitForFinancialAccount(account.id);
        } catch (error) {
          this.logger.error(
            `Folio account ${account.id}: invoice emission failed: ${(error as Error).message}`,
          );
        }
      }
      const stored = invoice
        ? null
        : await this.prisma.invoices.findFirst({
            where: {
              financial_account_id: account.id,
              invoice_type: 'sales_invoice',
              status: { notIn: ['voided', 'cancelled'] },
            },
            select: { id: true, invoice_number: true, status: true },
            orderBy: { id: 'desc' },
          });
      result.push({
        account_id: account.id,
        label: account.label,
        grand_total: Number(account.grand_total),
        invoice,
        invoice_id: invoice?.invoice_id ?? stored?.id ?? null,
        invoice_number: invoice?.invoice_number ?? stored?.invoice_number ?? null,
        status: invoice?.state ?? stored?.status ?? null,
      });
    }
    return result;
  }

  /** Payable accounts of the folio order's active split, or null without one. */
  private async activeSplitAccounts(order_id: number): Promise<SplitAccountRow[] | null> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { active_financial_split_id: true },
    });
    if (!order?.active_financial_split_id) return null;
    return this.prisma.order_financial_accounts.findMany({
      where: { split_id: order.active_financial_split_id, role: 'payable', state: 'active' },
      select: { id: true, label: true, grand_total: true },
      orderBy: { ordinal: 'asc' },
    });
  }

  /**
   * Store without electronic invoicing: the check-out closes the folio as a
   * normal POS sale and recognizes the revenue now (the listener books
   * DR 1305 / CR revenue + taxes and crosses the 2805 advance; both entries
   * are idempotent per order). With electronic invoicing the invoice
   * acceptance does it. Never blocks the check-out.
   */
  private async recognizeSale(
    order_id: number,
    store_id: number,
    organization_id: number | undefined,
    user_id: number | null,
  ): Promise<void> {
    try {
      const { eligible } = await this.invoicing.getElectronicEmissionEligibility();
      if (eligible) return;
      // A document already started for the order (FE enabled at the time)
      // books the sale on acceptance: never recognize it twice.
      const invoice = await this.prisma.invoices.findFirst({ where: { order_id }, select: { id: true } });
      if (invoice) return;
      const order = await this.prisma.orders.findFirst({ where: { id: order_id } });
      if (!order) return;
      const items = await this.prisma.order_items.findMany({
        where: { order_id, cancelled_at: null },
        select: {
          total_price: true,
          quantity: true,
          tax_amount_item: true,
          weight: true,
          price_unit_quantity: true,
          item_type: true,
          order_item_taxes: { select: { tax_type: true, tax_amount: true, tax_rate: true } },
        },
      });
      const sale_tax = buildOrderSaleTaxPayload({
        product_tax_rows: items.flatMap((item) =>
          (item.order_item_taxes || []).map((tax) => ({
            ...tax,
            taxable_amount: Number(item.total_price || 0),
          })),
        ),
        order,
        order_items: items,
      });
      let customer: { id: number; name?: string; tax_id?: string } | undefined;
      if (order.customer_id) {
        const user = await this.prisma.users.findFirst({
          where: { id: order.customer_id },
          select: { first_name: true, last_name: true, document_number: true },
        });
        customer = {
          id: order.customer_id,
          name: user ? `${user.first_name} ${user.last_name}`.trim() : undefined,
          tax_id: user?.document_number ?? undefined,
        };
      }
      this.eventEmitter.emit('lodging.folio.sale_recognized', {
        order_id,
        organization_id,
        store_id,
        order_number: order.order_number,
        subtotal_amount: Number(order.subtotal_amount || 0),
        tax_amount: sale_tax.tax_amount,
        tax_breakdown: sale_tax.tax_breakdown,
        shipping_amount: sale_tax.shipping_amount,
        discount_amount: sale_tax.discount_amount,
        total_amount: Number(order.grand_total || 0),
        tip_amount: Number(order.tip_amount || 0),
        user_id: user_id ?? undefined,
        customer,
      });
    } catch (error) {
      this.logger.error(`Folio order ${order_id}: sale recognition failed: ${(error as Error).message}`);
    }
  }

  /** Repeated check-out: retries what runs after the close and may have failed. */
  private async retryAfterClose(
    order_id: number,
    store_id: number,
    organization_id: number | undefined,
    user_id: number | null,
  ): Promise<void> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { payment_form: true, remaining_balance: true, active_financial_split_id: true },
    });
    if (!order || order.active_financial_split_id) return;
    if (order.payment_form === '2' && Number(order.remaining_balance ?? 0) > 0) {
      try {
        await this.receivables.createCreditSaleFromEvent({
          order_id,
          total_amount: Number(order.remaining_balance),
          store_id,
        });
      } catch (error) {
        this.logger.error(`Folio order ${order_id}: receivable retry failed: ${(error as Error).message}`);
      }
    }
    await this.recognizeSale(order_id, store_id, organization_id, user_id);
  }

  /** Emits only when there is no document yet or the last attempt failed. */
  private async emitOnce(order_id: number): Promise<PosFiscalStatus> {
    const status = await this.fiscalEmission.getStatusForOrder(order_id);
    if (status.invoice_id !== null && status.state !== 'failed') return status;
    return this.fiscalEmission.emitForOrder(order_id);
  }

  private async openFolio(reservation_id: number): Promise<FolioRow> {
    const folio = await this.folios.findFolio(reservation_id);
    if (folio.status !== 'open') throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
    return folio;
  }

  /** Nights before today (store day): the guest slept them, so they are billed. */
  private async postSleptNights(folio: FolioRow): Promise<void> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    await this.folios.postNightsThrough(folio, today, false);
    // H7.1 freezes the nights of a closed business day; a night the night
    // audit failed to post stays unposted. Closing the folio over it would
    // never charge it, so the day must be reopened first.
    const frozen = await this.prisma.lodging_room_nights.findMany({
      where: {
        store_id,
        is_active: true,
        posted_order_item_id: null,
        night_date: { lt: new Date(`${today}T00:00:00.000Z`) },
        reservation_room: { reservation_id: folio.reservation_id, cancelled_at: null },
      },
      select: { night_date: true },
      orderBy: { night_date: 'asc' },
    });
    if (frozen.length > 0) {
      const dates = [...new Set(frozen.map((n) => n.night_date.toISOString().slice(0, 10)))];
      throw new VendixHttpException(
        ErrorCodes.LODGING_CHECKOUT_FROZEN_NIGHTS_001,
        `Hay noches sin cobrar en días cerrados (${dates.map(formatShortDate).join(', ')}): reabre el día para cobrarlas`,
      );
    }
  }

  /**
   * D11: with the store setting on (default), the invoice needs a review at
   * the current total — done before by a verifier, or now by this user when
   * they hold the permission and confirm it (`verify`).
   */
  private async assertVerified(
    reservation_id: number,
    folio: FolioRow,
    dto: CheckOutDto,
    user?: FolioUser,
  ): Promise<void> {
    if (!(await this.verificationRequired())) return;

    const current = await this.folios.getFolio(reservation_id);
    if (current.verified_current) return;
    if (dto.verify && hasActivePermission(user, FOLIO_VERIFY_PERMISSION)) {
      await this.markVerified(folio.id, folio.order_id);
      return;
    }
    throw new VendixHttpException(
      ErrorCodes.LODGING_CHECKOUT_VERIFY_001,
      current.verified_at
        ? 'La cuenta cambió después de verificarla: un usuario con permiso debe verificarla de nuevo'
        : 'Un usuario con permiso «Verificar cuenta» debe revisarla antes de facturar',
    );
  }

  private async verificationRequired(): Promise<boolean> {
    const settings = (await this.settings.getSettings()) as {
      hospitality?: { folio_invoice_verification?: boolean };
    };
    return settings?.hospitality?.folio_invoice_verification !== false;
  }

  private async markVerified(folio_id: number, order_id: number): Promise<void> {
    const order = await this.prisma.orders.findFirst({
      where: { id: order_id },
      select: { grand_total: true },
    });
    if (!order) throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_FIND_001);
    const now = new Date();
    await this.prisma.lodging_folios.updateMany({
      where: { id: folio_id, status: 'open' },
      data: {
        verified_at: now,
        verified_by_user_id: RequestContextService.getContext()?.user_id ?? null,
        verified_total: order.grand_total,
        updated_at: now,
      },
    });
  }
}
