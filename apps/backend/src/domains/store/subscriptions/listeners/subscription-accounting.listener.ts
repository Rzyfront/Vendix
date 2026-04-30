import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';

/**
 * RNC-31: Listener for `subscription.payment.succeeded` that triggers the
 * double accounting entry (auto-entry):
 *   - Vendix-platform: recognizes revenue + partner payable
 *   - Store-cliente:   recognizes SaaS expense
 *
 * Integration boundary
 * --------------------
 * Subscriptions belong to the store domain; accounting AutoEntryService lives
 * in `apps/backend/src/domains/store/accounting/auto-entries/auto-entry.service.ts`.
 * To keep modules decoupled (and because `subscriptions.module.ts` cannot
 * import `AccountingModule` without creating a cycle through PrismaModule
 * scopes), this listener does NOT call AutoEntryService directly. Instead it:
 *
 *   1. Resolves the invoice + split breakdown + organization context.
 *   2. Emits a structured `accounting.saas_subscription_payment.succeeded`
 *      event with the two payloads the accounting side needs.
 *   3. The accounting domain listens to that event in
 *      AccountingEventsListener (same module as AutoEntryService) and calls
 *      `auto_entry_service.createAutoEntry({ ... })` for each side of the
 *      double entry.
 *
 * Idempotency: the dedup key is `subscription_payment.id` — the accounting
 * side guards via `accounting_entries.source_id + source_type` so a redelivery
 * never produces a second journal entry.
 *
 * RNC-29/30: chargeback flow lives in SubscriptionWebhookService +
 * SubscriptionFraudService; this listener does NOT participate.
 */
@Injectable()
export class SubscriptionAccountingListener {
  private readonly logger = new Logger(SubscriptionAccountingListener.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent('subscription.payment.succeeded')
  async onPaymentSucceeded(payload: {
    invoiceId: number;
    paymentId: number;
    subscriptionId?: number;
    storeId?: number;
  }): Promise<void> {
    try {
      const invoiceId = payload?.invoiceId;
      const paymentId = payload?.paymentId;
      if (!invoiceId || !paymentId) return;

      const invoice = await this.prisma
        .withoutScope()
        .subscription_invoices.findUnique({
          where: { id: invoiceId },
          select: {
            id: true,
            invoice_number: true,
            total: true,
            currency: true,
            split_breakdown: true,
            store_id: true,
            store_subscription_id: true,
            partner_organization_id: true,
            issued_at: true,
          },
        });
      if (!invoice) {
        this.logger.warn(
          `accounting.saas_subscription_payment.succeeded skipped — invoice ${invoiceId} not found`,
        );
        return;
      }

      // subscription_invoices does not declare a `store` relation — resolve
      // organization_id with a separate lookup. Read-only and best-effort.
      const store = await this.prisma.withoutScope().stores.findUnique({
        where: { id: invoice.store_id },
        select: { organization_id: true },
      });

      const splitBreakdown = invoice.split_breakdown as Record<
        string,
        unknown
      > | null;

      const total = new Prisma.Decimal(invoice.total).toNumber();
      const vendixShare = splitBreakdown?.vendix_share
        ? parseFloat(splitBreakdown.vendix_share as string)
        : total;
      const partnerShare = splitBreakdown?.partner_share
        ? parseFloat(splitBreakdown.partner_share as string)
        : 0;

      // Vendix platform organization id is required to post the
      // SaaS-revenue side of the double entry. Resolve from settings — the
      // accounting listener treats a missing config as "skip the platform
      // side" and only emits the store-side expense entry, with a warning.
      const platformOrgId = await this.resolvePlatformOrgId();

      const storeOrgId = store?.organization_id ?? null;

      if (!storeOrgId) {
        this.logger.warn(
          `accounting.saas_subscription_payment.succeeded skipped — ` +
            `cannot resolve store organization for invoice ${invoiceId}`,
        );
        return;
      }

      // Idempotency dedup key — the source_id the accounting side will
      // pass to createAutoEntry(). Re-deliveries hit the unique
      // (source_type, source_id) guard inside AutoEntryService.
      const dedupKey = paymentId;

      this.logger.log(
        `AUTO_ENTRY_TRIGGERED invoice=${invoiceId} payment=${paymentId} ` +
          `store_org=${storeOrgId} platform_org=${platformOrgId ?? 'unset'} ` +
          `total=${total} vendix=${vendixShare} partner=${partnerShare}`,
      );

      this.eventEmitter.emit('accounting.saas_subscription_payment.succeeded', {
        // Identity
        invoiceId,
        invoiceNumber: invoice.invoice_number,
        paymentId,
        subscriptionId: invoice.store_subscription_id,
        dedupKey,
        // Entry date for fiscal-period resolution.
        entryDate: invoice.issued_at ?? new Date(),
        currency: invoice.currency,
        // Store-cliente side (SaaS expense)
        store: {
          organization_id: storeOrgId,
          store_id: invoice.store_id,
          amount: total,
        },
        // Vendix platform side (revenue + partner payable split)
        platform: platformOrgId
          ? {
              organization_id: platformOrgId,
              amount_total: total,
              vendix_share: vendixShare,
              partner_share: partnerShare,
              partner_organization_id: invoice.partner_organization_id ?? null,
            }
          : null,
      });
    } catch (err: any) {
      this.logger.error(
        `SubscriptionAccountingListener failed: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Resolve the Vendix platform organization id from `platform_settings`.
   * Falls back to the env var VENDIX_PLATFORM_ORG_ID for environments where
   * the row was not seeded yet. Returns null when neither is available so
   * the caller can still emit the store-side expense entry.
   */
  private async resolvePlatformOrgId(): Promise<number | null> {
    const envValue = process.env.VENDIX_PLATFORM_ORG_ID;
    if (envValue) {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }

    try {
      const setting = await this.prisma
        .withoutScope()
        .platform_settings.findFirst({
          where: { key: 'vendix_platform_organization_id' },
          select: { value: true },
        });
      const raw = setting?.value as unknown;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string') {
        const parsed = parseInt(raw, 10);
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
      if (raw && typeof raw === 'object' && 'id' in raw) {
        const id = (raw as Record<string, unknown>).id;
        if (typeof id === 'number') return id;
      }
    } catch (e: any) {
      // Read-only lookup; never break the listener on a missing row/table.
      this.logger.debug(`platform_settings lookup failed: ${e?.message ?? e}`);
    }

    return null;
  }
}
