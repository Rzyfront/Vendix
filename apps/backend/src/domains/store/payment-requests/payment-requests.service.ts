import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { ResponseService } from '@common/responses/response.service';
import { S3Service } from '@common/services/s3.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';
import { PaymentRequestQueryDto } from './dto/payment-request.dto';

type Tx = Prisma.TransactionClient;

/** How the money arrived. */
export type PaymentRequestPayMethod = 'wompi' | 'transfer' | 'manual';

/** Payload of the `payment_request.paid` event (emitted once, after commit). */
export interface PaymentRequestPaidEvent {
  store_id: number;
  payment_request_id: number;
  purpose: string;
  amount: number;
  method: PaymentRequestPayMethod;
  paid_at: Date;
}

export interface CreatePaymentRequestInput {
  /** Free tag of the consumer (e.g. `service_deposit`). */
  purpose: string;
  amount: number | string | Prisma.Decimal;
  description: string;
  expires_at?: Date | null;
  currency?: string;
  created_by_user_id?: number | null;
}

export interface MarkPaidOptions {
  method: PaymentRequestPayMethod;
  confirmed_by_user_id?: number | null;
  /** A confirmed Wompi payment may land after the hold expired. */
  allow_late?: boolean;
}

/** Statuses a payment can still settle. */
const OPEN_STATUSES = ['pending', 'awaiting_confirmation'] as const;

/** sha256 hex of a public token: the only form that is stored. */
export function hashPaymentRequestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Payment requests: a generic "pay this amount" page (S15 / S3). Other domains
 * call `createInTx` to open one and listen to `payment_request.paid` to settle
 * what it collects. Paying is claimed with `updateMany`, so a repeated Wompi
 * event or a double click settles it exactly once.
 */
@Injectable()
export class PaymentRequestsService {
  private readonly logger = new Logger(PaymentRequestsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly storeContextRunner: StoreContextRunner,
    private readonly s3: S3Service,
    private readonly paymentLinks: PaymentLinksService,
    private readonly response: ResponseService,
  ) {}

  /**
   * Opens a payment request inside the caller's transaction. The plain token
   * is returned once (to build the link); only its sha256 is stored.
   */
  async createInTx(tx: Tx, input: CreatePaymentRequestInput) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const amount = new Prisma.Decimal(input.amount);
    if (!amount.gt(0)) {
      throw new VendixHttpException(
        ErrorCodes.PAYMENT_REQUEST_INVALID_STATE,
        'El monto a pagar debe ser mayor a cero.',
      );
    }
    const publicToken = randomBytes(32).toString('base64url');
    const request = await tx.payment_requests.create({
      data: {
        store_id,
        public_token_hash: hashPaymentRequestToken(publicToken),
        purpose: input.purpose,
        amount,
        currency: input.currency ?? 'COP',
        description: input.description,
        expires_at: input.expires_at ?? null,
        created_by_user_id: input.created_by_user_id ?? RequestContextService.getUserId() ?? null,
      },
    });
    return { request, publicToken };
  }

  /**
   * Issues a new public token for a still-pending request (only the hash is
   * stored, so the admin cannot read the old link back). The previous token
   * stops working. Refuses any other status.
   */
  async rotateTokenInTx(tx: Tx, id: number): Promise<{ publicToken: string }> {
    const publicToken = randomBytes(32).toString('base64url');
    const rotated = await tx.payment_requests.updateMany({
      where: { id, status: 'pending' },
      data: { public_token_hash: hashPaymentRequestToken(publicToken), updated_at: new Date() },
    });
    if (rotated.count !== 1) {
      throw new VendixHttpException(
        ErrorCodes.PAYMENT_REQUEST_INVALID_STATE,
        'Solo se puede generar un nuevo enlace mientras el pago está pendiente.',
      );
    }
    return { publicToken };
  }

  /**
   * Claims the request as paid inside the caller's transaction. Returns the
   * event to emit after commit (`emitPaid`), or `null` when it was not open
   * (already paid, cancelled, expired): the second caller is a no-op.
   */
  async markPaidInTx(
    tx: Tx,
    id: number,
    options: MarkPaidOptions,
  ): Promise<PaymentRequestPaidEvent | null> {
    const paid_at = new Date();
    const statuses: string[] = options.allow_late
      ? [...OPEN_STATUSES, 'expired']
      : [...OPEN_STATUSES];
    const claimed = await tx.payment_requests.updateMany({
      where: { id, status: { in: statuses as any } },
      data: {
        status: 'paid',
        paid_at,
        updated_at: paid_at,
        ...(options.confirmed_by_user_id
          ? { confirmed_by_user_id: options.confirmed_by_user_id, confirmed_at: paid_at }
          : {}),
      },
    });
    if (claimed.count !== 1) return null;
    const row = await tx.payment_requests.findFirst({
      where: { id },
      select: { id: true, store_id: true, purpose: true, amount: true, paid_at: true },
    });
    if (!row) return null;
    return {
      store_id: row.store_id,
      payment_request_id: row.id,
      purpose: row.purpose,
      amount: Number(row.amount),
      method: options.method,
      paid_at: row.paid_at ?? paid_at,
    };
  }

  /** Emits `payment_request.paid`; call it after the transaction committed. */
  emitPaid(event: PaymentRequestPaidEvent): void {
    this.eventEmitter.emit('payment_request.paid', event);
  }

  /** `markPaidInTx` in its own transaction, emitting after it committed. */
  async markPaid(
    id: number,
    options: MarkPaidOptions,
  ): Promise<PaymentRequestPaidEvent | null> {
    const event = await this.prisma.$transaction((tx) =>
      this.markPaidInTx(tx, id, options),
    );
    if (event) this.emitPaid(event);
    return event;
  }

  /** Wompi confirmed a payment link: settle the request it belongs to. */
  @OnEvent('payment_link.paid')
  async onPaymentLinkPaid(event: { payment_link_id: number; store_id: number }) {
    try {
      const own = await (this.prisma.withoutScope() as any).payment_requests.findFirst({
        where: { payment_link_id: event.payment_link_id },
        select: { id: true, store_id: true },
      });
      // Links of other consumers (hotel deposits, bookings...) are not ours.
      if (!own || own.store_id !== event.store_id) return;
      await this.storeContextRunner.runInStoreContext(own.store_id, async () => {
        const paid = await this.markPaid(own.id, { method: 'wompi', allow_late: true });
        if (!paid) {
          this.logger.warn(
            `Payment request ${own.id} was not open when Wompi link ${event.payment_link_id} was paid (repeated event or cancelled): nothing settled`,
          );
        }
      });
    } catch (err: unknown) {
      this.logger.error(
        `Payment request for link ${event.payment_link_id} failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Expires the pending requests past `expires_at` and returns their ids.
   * A request awaiting confirmation never expires (A9): the customer already
   * paid, the admin is reviewing the receipt.
   */
  async expireOverdue(now = new Date()): Promise<number[]> {
    const where = { status: 'pending' as const, expires_at: { lt: now } };
    const rows = await this.prisma.payment_requests.findMany({
      where,
      select: { id: true },
    });
    if (rows.length === 0) return [];
    await this.prisma.payment_requests.updateMany({
      where: { ...where, id: { in: rows.map((r) => r.id) } },
      data: { status: 'expired', updated_at: now },
    });
    return rows.map((r) => r.id);
  }

  // --- Admin API -----------------------------------------------------------

  async findAll(query: PaymentRequestQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Prisma.payment_requestsWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.purpose ? { purpose: query.purpose } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.payment_requests.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.payment_requests.count({ where }),
    ]);
    return this.response.success({
      data: rows.map((row) => this.toAdminView(row)),
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  }

  async findOne(id: number) {
    const row = await this.requireRequest(id);
    const receipt_url = row.transfer_receipt_s3_key
      ? await this.signReceipt(row.transfer_receipt_s3_key)
      : null;
    return this.response.success({ ...this.toAdminView(row), receipt_url });
  }

  /** Admin confirms the transfer receipt: the request is paid. */
  async confirm(id: number) {
    const row = await this.requireRequest(id);
    if (row.status !== 'awaiting_confirmation') {
      throw new VendixHttpException(
        ErrorCodes.PAYMENT_REQUEST_INVALID_STATE,
        'Solo se puede confirmar una transferencia con comprobante en revisión.',
      );
    }
    const event = await this.markPaid(id, {
      method: 'transfer',
      confirmed_by_user_id: RequestContextService.getUserId() ?? null,
    });
    if (!event) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_INVALID_STATE);
    }
    return this.response.success(event, 'Transferencia confirmada');
  }

  /** Admin rejects the receipt: back to pending so the customer can resend. */
  async reject(id: number, reason: string) {
    const clean = (reason ?? '').trim();
    if (!clean) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_REJECT_REASON);
    const row = await this.requireRequest(id);
    if (row.status !== 'awaiting_confirmation') {
      throw new VendixHttpException(
        ErrorCodes.PAYMENT_REQUEST_INVALID_STATE,
        'Solo se puede rechazar un comprobante en revisión.',
      );
    }
    const now = new Date();
    const claimed = await this.prisma.payment_requests.updateMany({
      where: { id, status: 'awaiting_confirmation' },
      data: { status: 'pending', rejection_reason: clean, updated_at: now },
    });
    if (claimed.count !== 1) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_INVALID_STATE);
    }
    return this.response.success({ id, status: 'pending' }, 'Comprobante rechazado');
  }

  async cancel(id: number) {
    const row = await this.requireRequest(id);
    if (row.status === 'paid') {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_ALREADY_PAID);
    }
    if (row.status === 'cancelled') {
      return this.response.success({ id, status: 'cancelled' });
    }
    const claimed = await this.prisma.payment_requests.updateMany({
      where: { id, status: { in: ['pending', 'awaiting_confirmation', 'expired'] } },
      data: { status: 'cancelled', updated_at: new Date() },
    });
    if (claimed.count !== 1) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_INVALID_STATE);
    }
    if (row.payment_link_id) {
      try {
        await this.paymentLinks.deactivate(row.payment_link_id);
      } catch (err: unknown) {
        this.logger.warn(
          `Payment link ${row.payment_link_id} not deactivated: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
    return this.response.success({ id, status: 'cancelled' }, 'Solicitud de pago cancelada');
  }

  // --- helpers -------------------------------------------------------------

  private async requireRequest(id: number) {
    const row = await this.prisma.payment_requests.findFirst({ where: { id } });
    if (!row) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_NOT_FOUND);
    return row;
  }

  /** Never exposes the token hash or the raw S3 key. */
  private toAdminView(row: Record<string, any>) {
    const { public_token_hash: _hash, transfer_receipt_s3_key, ...rest } = row;
    return { ...rest, has_receipt: !!transfer_receipt_s3_key };
  }

  private async signReceipt(key: string): Promise<string | null> {
    try {
      return await this.s3.getPresignedUrl(key, 300);
    } catch {
      return null;
    }
  }
}
