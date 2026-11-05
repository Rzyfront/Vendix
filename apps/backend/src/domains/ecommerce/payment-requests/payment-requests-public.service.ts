import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { S3Service } from '@common/services/s3.service';
import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PaymentLinksService } from '../../store/payment-links/payment-links.service';
import { hashPaymentRequestToken } from '../../store/payment-requests/payment-requests.service';
import {
  buildPaymentMethodsWhere,
  ONLINE_PAGE_PROCESSING_MODES,
  toPublicPaymentMethod,
} from '../checkout/utils/online-payment-methods.util';
import { StartWompiDto, SubmitTransferDto } from './dto/payment-requests-public.dto';

export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
const RECEIPT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

export type PublicMethodKind = 'wompi' | 'transfer' | 'info';

/**
 * Public side of the payment page. The token (sha256-hashed) is the only
 * credential; the store comes from the storefront domain via the request
 * context, so a token of another store is simply "not found".
 */
@Injectable()
export class PaymentRequestsPublicService {
  private readonly logger = new Logger(PaymentRequestsPublicService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly paymentLinks: PaymentLinksService,
    private readonly s3: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) {}

  async get(token: string) {
    const row = await this.load(token);
    const status = this.effectiveStatus(row);
    const methods = status === 'pending' ? await this.listMethods(Number(row.amount)) : [];
    return {
      amount: Number(row.amount),
      currency: row.currency,
      description: row.description,
      status,
      expires_at: row.expires_at,
      paid_at: row.paid_at,
      rejection_reason: status === 'pending' ? row.rejection_reason : null,
      has_receipt: !!row.transfer_receipt_s3_key,
      methods,
    };
  }

  async startWompi(token: string, dto: StartWompiDto) {
    const row = await this.load(token);
    this.assertPayable(row);

    if (row.payment_link_id) {
      const existing = await this.prisma.payment_links.findFirst({
        where: { id: row.payment_link_id },
      });
      if (
        existing &&
        existing.status === 'active' &&
        (!existing.expires_at || existing.expires_at > new Date())
      ) {
        return { checkout_url: existing.checkout_url };
      }
    }

    const returnUrl = await this.storeReturnUrl(dto.return_url);
    let link: { id: number; checkout_url: string } | undefined;
    try {
      const created = await this.paymentLinks.create({
        name: row.description.slice(0, 255),
        description: row.description,
        single_use: true,
        collect_shipping: false,
        amount_in_cents: Math.round(Number(row.amount) * 100),
        currency: row.currency,
        ...(row.expires_at && row.expires_at > new Date()
          ? { expires_at: row.expires_at.toISOString() }
          : {}),
        ...(returnUrl ? { redirect_url: returnUrl } : {}),
      });
      link = created.data as { id: number; checkout_url: string };
    } catch (err: unknown) {
      this.logger.warn(
        `Payment request ${row.id}: Wompi link failed: ${err instanceof Error ? err.message : err}`,
      );
    }
    if (!link?.id) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_WOMPI_UNAVAILABLE);
    }

    const claimed = await this.prisma.payment_requests.updateMany({
      where: { id: row.id, payment_link_id: row.payment_link_id ?? null },
      data: { payment_link_id: link.id, updated_at: new Date() },
    });
    if (claimed.count === 1) return { checkout_url: link.checkout_url };

    // A concurrent call attached its own link first: use that one.
    await this.paymentLinks.deactivate(link.id).catch(() => undefined);
    const fresh = await this.load(token);
    const winner = fresh.payment_link_id
      ? await this.prisma.payment_links.findFirst({ where: { id: fresh.payment_link_id } })
      : null;
    if (!winner) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_WOMPI_UNAVAILABLE);
    return { checkout_url: winner.checkout_url };
  }

  async submitTransfer(
    token: string,
    file: Express.Multer.File | undefined,
    dto: SubmitTransferDto,
  ) {
    const row = await this.load(token);
    this.assertPayable(row);

    if (!file) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_RECEIPT_REQUIRED);
    if (!file.mimetype || !RECEIPT_MIME_TYPES.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_RECEIPT_TYPE);
    }
    const size = file.size ?? file.buffer?.length ?? 0;
    if (size > RECEIPT_MAX_BYTES) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_RECEIPT_SIZE);
    }

    let method_id: number | null = null;
    if (dto.method_id) {
      const method = await this.prisma.store_payment_methods.findFirst({
        where: {
          id: dto.method_id,
          state: 'enabled',
          system_payment_method: { type: 'bank_transfer' },
        },
        select: { id: true },
      });
      if (!method) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_METHOD_INVALID);
      method_id = method.id;
    }

    const key = await this.uploadReceipt(file);
    const now = new Date();
    const claimed = await this.prisma.payment_requests.updateMany({
      where: { id: row.id, status: 'pending' },
      data: {
        status: 'awaiting_confirmation',
        transfer_receipt_s3_key: key,
        transfer_reference: dto.reference?.trim() || null,
        transfer_store_payment_method_id: method_id,
        transfer_submitted_at: now,
        rejection_reason: null,
        updated_at: now,
      },
    });
    if (claimed.count !== 1) {
      throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_AWAITING_CONFIRMATION);
    }
    return { status: 'awaiting_confirmation' as const };
  }

  // --- helpers -------------------------------------------------------------

  /**
   * Wompi sends the customer to `return_url` after paying, and the link is reused by
   * later visitors, so only a host registered to this store is accepted (no open
   * redirect). Anything else is dropped and Wompi shows its own result page.
   */
  private async storeReturnUrl(raw?: string): Promise<string | null> {
    if (!raw) return null;
    let host: string;
    try {
      host = new URL(raw).hostname.toLowerCase();
    } catch {
      return null;
    }
    const store_id = RequestContextService.getStoreId();
    if (!store_id) return null;
    const domains = await this.prisma.domain_settings.findMany({
      where: { store_id },
      select: { hostname: true },
    });
    const allowed = domains
      .map((d) => (d.hostname ?? '').toLowerCase())
      .filter((h) => h.length > 0);
    if (allowed.some((h) => host === h || host.endsWith(`.${h}`))) return raw;
    this.logger.warn(`Payment request return_url host '${host}' is not a domain of store ${store_id}; dropped`);
    return null;
  }

  private async load(token: string) {
    const row = await this.prisma.payment_requests.findFirst({
      where: { public_token_hash: hashPaymentRequestToken(token ?? '') },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.PAYMENT_REQUEST_NOT_FOUND);
    return row;
  }

  /** `pending` past `expires_at` reads as `expired`; a receipt in review never expires (A9). */
  private effectiveStatus(row: { status: string; expires_at: Date | null }): string {
    if (row.status === 'pending' && row.expires_at && row.expires_at < new Date()) {
      return 'expired';
    }
    return row.status;
  }

  private assertPayable(row: { status: string; expires_at: Date | null }): void {
    const status = this.effectiveStatus(row);
    if (status === 'pending') return;
    const code = {
      paid: ErrorCodes.PAYMENT_REQUEST_ALREADY_PAID,
      cancelled: ErrorCodes.PAYMENT_REQUEST_CANCELLED,
      expired: ErrorCodes.PAYMENT_REQUEST_EXPIRED,
      awaiting_confirmation: ErrorCodes.PAYMENT_REQUEST_AWAITING_CONFIRMATION,
    }[status];
    throw new VendixHttpException(code ?? ErrorCodes.PAYMENT_REQUEST_INVALID_STATE);
  }

  /** Online methods of the store (no cash, wallet or cash-on-delivery), as the page renders them. */
  private async listMethods(amount: number) {
    const rows = await this.prisma.store_payment_methods.findMany({
      where: buildPaymentMethodsWhere({
        allowedModes: ONLINE_PAGE_PROCESSING_MODES,
        isPickup: false,
        isAuthenticated: false,
      }) as any,
      include: { system_payment_method: true },
      orderBy: { display_order: 'asc' },
    });
    const methods: Array<Record<string, unknown>> = [];
    for (const row of rows) {
      if (row.min_amount != null && amount < Number(row.min_amount)) continue;
      if (row.max_amount != null && amount > Number(row.max_amount)) continue;
      const m = toPublicPaymentMethod(row as any);
      const type = m.type as string;
      const kind: PublicMethodKind | null =
        type === 'wompi' ? 'wompi' : type === 'bank_transfer' ? 'transfer' : m.payment_instructions ? 'info' : null;
      if (!kind) continue;
      methods.push({
        // Only transfers need the id back (to say which account was paid).
        ...(kind === 'transfer' ? { id: m.id } : {}),
        kind,
        name: m.name,
        logo_url: m.logo_url,
        ...(m.payment_instructions ? { payment_instructions: m.payment_instructions } : {}),
      });
    }
    return methods;
  }

  /** Same key convention as checkout receipts, under `/payment-requests`. The key is stored, never a URL. */
  private async uploadReceipt(file: Express.Multer.File): Promise<string> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: { id: true, slug: true, organization_id: true },
    });
    if (!store) throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
    const organization = await this.prisma.organizations.findUnique({
      where: { id: store.organization_id },
      select: { id: true, slug: true },
    });
    if (!organization) throw new VendixHttpException(ErrorCodes.ORG_FIND_001);

    const base = this.s3PathHelper.buildReceiptPath(
      { id: organization.id, slug: organization.slug },
      { id: store.id, slug: store.slug },
    );
    const now = new Date();
    const year = String(now.getUTCFullYear());
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const leaf = (file.originalname ?? '').split(/[\\/]/).pop() ?? '';
    const safe = leaf.replace(/[^a-zA-Z0-9._-]/g, '_') || 'receipt';
    const key = `${base}/payment-requests/${year}/${month}/${randomUUID()}-${safe}`;
    await this.s3.uploadFile(file.buffer, key, file.mimetype);
    return key;
  }
}
