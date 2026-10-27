import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { SplitOrderService } from '../../../tables/split-order.service';
import { SplitAccountPaymentService } from '../../../tables/split-account-payment.service';
import { FolioRow, LodgingFolioService } from '../folio/folio.service';
import {
  CancelFolioSplitDto,
  ConfirmFolioSplitDto,
  FolioSplitDto,
  FolioSplitPayDto,
} from './folio-split.dto';

/**
 * Hospitality Suite (H3.8) — split folio: the company pays the lodging and
 * the guest the consumptions, each account with its own payment and invoice.
 *
 * No new model: the folio order gets the financial split of the tables
 * (`SplitOrderService`, by items: every active line goes to exactly one
 * account, so the accounts add up to the folio), each account is paid with
 * `SplitAccountPaymentService` and invoiced at check-out with
 * `createFromFinancialAccount` (`PosFiscalEmissionService.emitForFinancialAccount`).
 * While the split is active the folio is locked (`lockFolioOrder` rejects
 * every charge, void, payment and deposit); "Quitar división" before any
 * account is paid restores the single folio.
 *
 * The split happens before money moves: a folio with payments or an applied
 * deposit is rejected. Those payments are customer advances (2805) crossed by
 * the single folio invoice (H3.7), while a split account recognizes its sale
 * when it is paid; mixing both would book the advance twice. A deposit still
 * held stays in the holder's wallet.
 */
@Injectable()
export class LodgingFolioSplitService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly folios: LodgingFolioService,
    private readonly splits: SplitOrderService,
    private readonly splitPayments: SplitAccountPaymentService,
  ) {}

  /** Active split of the folio, or null. */
  async get(reservation_id: number) {
    const folio = await this.folios.findFolio(reservation_id);
    return this.splits.getSplit(folio.order_id);
  }

  /** Totals per account before confirming (nothing is persisted but the slept nights). */
  async preview(reservation_id: number, dto: FolioSplitDto) {
    const folio = await this.prepare(reservation_id, dto);
    return this.splits.preview(folio.order_id, { mode: 'items', ...this.request(dto) });
  }

  async confirm(reservation_id: number, dto: ConfirmFolioSplitDto) {
    const folio = await this.prepare(reservation_id, dto);
    return this.splits.splitByItems(folio.order_id, {
      ...this.request(dto),
      source_version: dto.source_version,
      idempotency_key: `folio-split-${folio.id}-${dto.request_id}`,
    });
  }

  /** "Quitar división": only while no account has a payment. */
  async cancel(reservation_id: number, dto: CancelFolioSplitDto) {
    const folio = await this.openFolio(reservation_id);
    await this.splits.cancel(folio.order_id, { source_version: dto.source_version });
    return this.folios.getFolio(reservation_id);
  }

  /** "Cobrar" one account: cash, card or transfer, same cash gate as every sale. */
  async pay(reservation_id: number, account_id: number, dto: FolioSplitPayDto) {
    const folio = await this.openFolio(reservation_id);
    await this.splitPayments.pay(folio.order_id, account_id, {
      store_payment_method_id: dto.store_payment_method_id,
      amount: dto.amount,
      amount_received: dto.amount_received,
      idempotency_key: `folio-split-pay-${folio.id}-${dto.request_id}`,
    });
    return this.splits.getSplit(folio.order_id);
  }

  // --------------------------------------------------------------- helpers

  private async openFolio(reservation_id: number): Promise<FolioRow> {
    const folio = await this.folios.findFolio(reservation_id);
    if (folio.status !== 'open') throw new VendixHttpException(ErrorCodes.LODGING_FOLIO_CLOSED_001);
    return folio;
  }

  /**
   * The folio as it will be split: open, guest in house, every night slept
   * already charged (the same nights the check-out would post), no money
   * received yet, and every active line in exactly one account.
   */
  private async prepare(reservation_id: number, dto: FolioSplitDto): Promise<FolioRow> {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const folio = await this.openFolio(reservation_id);
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: { status: true },
    });
    if (reservation?.status !== 'checked_in') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_SPLIT_001,
        'Solo se divide el folio de un huésped en casa',
      );
    }

    const order = await this.prisma.orders.findFirst({
      where: { id: folio.order_id },
      select: { active_financial_split_id: true },
    });
    if (order?.active_financial_split_id) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_SPLIT_001,
        'El folio ya está dividido: quita la división para cambiarla',
      );
    }

    // The split locks the folio, so no night may be left to post: it is
    // done on the departure day, after the nights slept are charged.
    const today = localDateString(new Date(), await resolveStoreTimezone(this.prisma, store_id));
    await this.folios.postNightsThrough(folio, today, false);
    const unposted = await this.prisma.lodging_room_nights.count({
      where: {
        store_id,
        is_active: true,
        posted_order_item_id: null,
        reservation_room: { reservation_id, cancelled_at: null },
      },
    });
    if (unposted > 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_SPLIT_001,
        'Aún quedan noches por causar: divide el folio el día de la salida',
      );
    }

    const current = await this.folios.getFolio(reservation_id);
    if (current.paid > 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_SPLIT_001,
        'El folio ya tiene pagos o un anticipo aplicado: la división se hace antes de cobrar',
      );
    }
    const active = new Set(current.lines.filter((l) => !l.cancelled_at).map((l) => l.id));
    const assigned = new Set<number>();
    for (const account of dto.accounts) {
      for (const id of account.order_item_ids) {
        if (!active.has(id)) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_FOLIO_SPLIT_001,
            'Un cargo no pertenece al folio o está anulado; recarga el folio',
          );
        }
        if (assigned.has(id)) {
          throw new VendixHttpException(
            ErrorCodes.LODGING_FOLIO_SPLIT_001,
            'Cada cargo va en una sola cuenta',
          );
        }
        assigned.add(id);
      }
    }
    if (assigned.size !== active.size) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_FOLIO_SPLIT_001,
        'Asigna cada cargo del folio a una cuenta',
      );
    }

    // Accounts are invoiced to customers of this store only.
    const customerIds = [
      ...new Set(dto.accounts.map((a) => a.customer_id).filter((id): id is number => id != null)),
    ];
    if (customerIds.length > 0) {
      const found = await this.prisma.users.count({
        where: { id: { in: customerIds }, store_users: { some: { store_id } } },
      });
      if (found !== customerIds.length) {
        throw new VendixHttpException(ErrorCodes.LODGING_CHECKOUT_BILL_TO_001);
      }
    }
    return folio;
  }

  private request(dto: FolioSplitDto) {
    return {
      item_groups: dto.accounts.map((a) => ({ order_item_ids: a.order_item_ids })),
      accounts: dto.accounts.map((a, index) => ({
        label: a.label?.trim() || `Cuenta ${index + 1}`,
        customer_id: a.customer_id ?? null,
      })),
    };
  }
}
