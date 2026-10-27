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
import { LodgingReservationsService } from '../reservations.service';
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
        'El folio está dividido: cada cuenta se factura a su titular',
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
        'El folio está dividido: cobra cada cuenta antes del check-out',
      );
    }
    if (current.balance > 0 && !dto.charge_to_credit) {
      if (!dto.store_payment_method_id) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_CHECKOUT_BALANCE_001,
          `El folio tiene un saldo de ${current.balance.toFixed(2)}: cóbralo o cárgalo a crédito de la empresa`,
        );
      }
      await this.folios.registerPayment(reservation_id, {
        amount: current.balance,
        store_payment_method_id: dto.store_payment_method_id,
        request_id: dto.request_id,
      });
    }

    // 5. Close: folio, order, reservation and rooms, all or nothing.
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
      throw new VendixHttpException(ErrorCodes.INVOICING_FIND_003, 'El folio no tiene factura');
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
    const settings = (await this.settings.getSettings()) as {
      hospitality?: { folio_invoice_verification?: boolean };
    };
    if (settings?.hospitality?.folio_invoice_verification === false) return;

    const current = await this.folios.getFolio(reservation_id);
    if (current.verified_current) return;
    if (dto.verify && hasActivePermission(user, FOLIO_VERIFY_PERMISSION)) {
      await this.markVerified(folio.id, folio.order_id);
      return;
    }
    throw new VendixHttpException(
      ErrorCodes.LODGING_CHECKOUT_VERIFY_001,
      current.verified_at
        ? 'El folio cambió después de verificarlo: un usuario con permiso debe verificarlo de nuevo'
        : 'Un usuario con permiso «Verificar el folio» debe revisarlo antes de facturar',
    );
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
