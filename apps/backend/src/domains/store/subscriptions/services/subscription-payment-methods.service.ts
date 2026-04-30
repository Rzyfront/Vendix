import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, subscription_payment_method_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { TokenizePaymentMethodDto } from '../dto/tokenize-payment-method.dto';
import {
  PlatformGatewayService,
  DecryptedCreds,
} from '../../../superadmin/subscriptions/gateway/platform-gateway.service';
import { WompiProcessor } from '../../payments/processors/wompi/wompi.processor';
import { WompiClientFactory } from '../../payments/processors/wompi/wompi.factory';
import {
  WompiConfig,
  WompiEnvironment,
} from '../../payments/processors/wompi/wompi.types';

export interface TokenizeWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
  /**
   * Wompi acceptance_token presented to the user. The frontend must echo it
   * back through the tokenize endpoint so the backend can forward it bit-exact
   * to `/payment_sources` (legal trail for COF / MIT charges).
   */
  acceptance_token: string;
  /**
   * Wompi personal_auth (presigned_personal_data_auth.acceptance_token).
   */
  personal_auth_token: string;
}

@Injectable()
export class SubscriptionPaymentMethodsService {
  private readonly logger = new Logger(SubscriptionPaymentMethodsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformGw: PlatformGatewayService,
    private readonly wompiProcessor: WompiProcessor,
    private readonly wompiClientFactory: WompiClientFactory,
  ) {}

  async listForStore() {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // G11 — Include `invalid` methods alongside `active` so the UI can
    // surface the "tu tarjeta no es válida, actualízala" banner. `removed`
    // and `replaced` stay hidden (soft-deleted; only kept for audit lineage).
    const methods = await this.prisma.subscription_payment_methods.findMany({
      where: {
        store_id: storeId,
        state: {
          in: [
            subscription_payment_method_state_enum.active,
            subscription_payment_method_state_enum.invalid,
          ],
        },
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });

    return methods.map((m) => {
      const meta = (m.metadata as Record<string, unknown> | null) ?? {};
      return {
        id: String(m.id),
        type: m.type as 'card' | 'bank_transfer',
        last4: m.last4,
        brand: m.brand,
        is_default: m.is_default,
        created_at: m.created_at.toISOString(),
        // G11 — expose expiry + state to the banner UI so it can warn the
        // user before a charge is attempted with an expired card.
        expiry_month: m.expiry_month,
        expiry_year: m.expiry_year,
        state: m.state,
        consecutive_failures: Number(meta.consecutive_failures ?? 0),
        // Wompi Phase 5 — when present, the row already migrated to the
        // payment_source flow (recurrent:true charges available). The
        // frontend uses it to show the "Verificada para cobros recurrentes"
        // badge.
        providerPaymentSourceId: m.provider_payment_source_id ?? null,
      };
    });
  }

  /**
   * Wompi Phase 5 — exchanges the widget-supplied `card_token` (tok_*) for a
   * long-lived `payment_source_id` and persists it as a recurring PM.
   *
   * Replaces the legacy `tokenize` flow that stored only the short-lived
   * `tok_*` directly on `provider_token` (which Wompi expires within minutes
   * and cannot be charged with `recurrent:true`).
   */
  async tokenize(dto: TokenizePaymentMethodDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const subscription = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!subscription) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No active subscription for this store',
      );
    }

    return this.tokenizeAndRegister(storeId, subscription.id, dto);
  }

  /**
   * Core tokenize flow (called from `tokenize` and `replace`).
   *
   * Steps:
   *  1. Resolve platform Wompi credentials (multi-tenant: SaaS-level keys, not
   *     per-store).
   *  2. Compute a deterministic idempotency key derived from `card_token` so a
   *     widget retry / double-click does not create duplicate `payment_sources`
   *     on the gateway side.
   *  3. Call `WompiProcessor.createPaymentSourceFromCardToken` to exchange the
   *     short-lived `tok_*` for a long-lived `payment_source_id`.
   *  4. Acquire an advisory transaction lock on
   *     hash(store_id || payment_source_id) so concurrent requests (eg. webhook
   *     re-delivery + widget callback) don't both insert the same row.
   *  5. Upsert idempotently by `(store_id, provider_payment_source_id, active)`.
   */
  private async tokenizeAndRegister(
    storeId: number,
    subscriptionId: number,
    dto: TokenizePaymentMethodDto,
  ) {
    // ── 1. Resolve Wompi credentials (platform-level, not per-store).
    const wompiConfig = await this.resolveWompiConfig();

    // Customer email — Wompi requires a non-empty email. Use the synthetic
    // `saas-<storeId>@vendix.app` consistent with `prepareWidgetConfig` so
    // the merchant view aligns. The `stores` model has no email column; the
    // user-facing billing email is per-organization (out of scope here).
    const customerEmail = `saas-${storeId}@vendix.app`;

    // ── 2. Stable idempotency key derived from the card_token.
    //   Same widget tokenization + same store ⇒ same key ⇒ Wompi returns the
    //   same payment_source instead of creating a duplicate. The hash slice
    //   stays under Wompi's 64-char idempotency-key limit comfortably.
    const tokenHash = crypto
      .createHash('sha256')
      .update(dto.card_token)
      .digest('hex')
      .slice(0, 16);
    const idempotencyKey = `pm:tokenize:${storeId}:${tokenHash}`;

    // ── 3. Exchange tok_* for payment_source_id.
    let psid: string;
    let acceptanceTokenUsed: string;
    let publicData: any;
    try {
      const result = await this.wompiProcessor.createPaymentSourceFromCardToken(
        {
          storeId,
          cardTokenFromWidget: dto.card_token,
          acceptanceToken: dto.acceptance_token,
          personalAuthToken: dto.personal_auth_token,
          customerEmail,
          wompiConfig,
          idempotencyKey,
        },
      );
      psid = result.paymentSourceId;
      acceptanceTokenUsed = result.acceptanceTokenUsed;
      publicData = result.publicData ?? {};
    } catch (error: unknown) {
      // VendixHttpException raised by the processor (PAYMENT_SOURCE_*) bubbles
      // through unchanged. Generic gateway errors get mapped to the legacy
      // SUBSCRIPTION_TOKEN_INVALID / CARD_DECLINED / PROVIDER_UNAVAILABLE
      // codes the frontend already handles.
      if (error instanceof VendixHttpException) throw error;
      this._mapWompiError(error);
      throw error;
    }

    // ── 4 + 5. Idempotent upsert under advisory lock.
    return this.prisma.$transaction(async (tx) => {
      // Advisory lock keyed by (store_id, payment_source_id) hash. Prevents
      // a webhook handler race from inserting the same row twice. Auto
      // released at COMMIT/ROLLBACK.
      const lockKeySrc = `${storeId}:${psid}`;
      const lockKey =
        // bigint — use the first 8 hex chars of the SHA-1 to fit pg's bigint range
        BigInt(
          '0x' +
            crypto.createHash('sha1').update(lockKeySrc).digest('hex').slice(0, 15),
        );
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`,
      );

      // Idempotent: same (store, payment_source_id) already saved? Reuse it.
      const existing = await tx.subscription_payment_methods.findFirst({
        where: {
          store_id: storeId,
          provider_payment_source_id: psid,
          state: subscription_payment_method_state_enum.active,
        },
      });
      if (existing) {
        // Return the existing row so the frontend reflects the saved card.
        return this._mapPmResponse(existing);
      }

      // First-PM-for-store ⇒ default. Otherwise honour the dto flag and
      // demote previous defaults atomically.
      const activeCount = await tx.subscription_payment_methods.count({
        where: {
          store_id: storeId,
          state: subscription_payment_method_state_enum.active,
        },
      });
      const inheritsDefault = activeCount === 0 || dto.is_default === true;
      if (inheritsDefault) {
        await tx.subscription_payment_methods.updateMany({
          where: {
            store_id: storeId,
            is_default: true,
            state: subscription_payment_method_state_enum.active,
          },
          data: { is_default: false, updated_at: new Date() },
        });
      }

      const extra = (publicData?.extra ?? publicData) as
        | Record<string, unknown>
        | undefined;
      const last4 =
        dto.last4 ??
        ((extra?.last_four as string | undefined) ??
          (publicData?.last_four as string | undefined) ??
          null);
      const brand =
        dto.brand ??
        ((extra?.brand as string | undefined) ??
          (publicData?.brand as string | undefined) ??
          null);
      const expMonth =
        dto.expiry_month ??
        ((extra?.exp_month as string | undefined) ??
          (publicData?.exp_month as string | undefined) ??
          null);
      const expYear =
        dto.expiry_year ??
        ((extra?.exp_year as string | undefined) ??
          (publicData?.exp_year as string | undefined) ??
          null);
      const cardHolder =
        dto.card_holder ??
        ((extra?.card_holder as string | undefined) ??
          (extra?.name as string | undefined) ??
          null);

      const created = await tx.subscription_payment_methods.create({
        data: {
          store_id: storeId,
          store_subscription_id: subscriptionId,
          type: dto.type ?? 'card',
          provider: 'wompi',
          // legacy mirror — readers that still look at provider_token (eg.
          // chargeInvoice retry path before Fase 6) can keep working until
          // Fase 7 enforces full migration.
          provider_token: psid,
          provider_payment_source_id: psid,
          acceptance_token_used: acceptanceTokenUsed,
          cof_registered_at: new Date(),
          last4: last4 ? String(last4).slice(-4) : null,
          brand: brand ? String(brand) : null,
          expiry_month: expMonth ? String(expMonth).padStart(2, '0').slice(0, 2) : null,
          expiry_year: expYear ? String(expYear).slice(0, 4) : null,
          card_holder: cardHolder ? String(cardHolder) : null,
          is_default: inheritsDefault,
          state: subscription_payment_method_state_enum.active,
          metadata: {
            source: 'tokenize_widget',
            registered_at: new Date().toISOString(),
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `PAYMENT_METHOD_TOKENIZED store=${storeId} sub=${subscriptionId} pm=${created.id} psid=${psid} default=${inheritsDefault}`,
      );

      return this._mapPmResponse(created);
    });
  }

  async setDefault(id: string) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const methodId = parseInt(id, 10);
    if (isNaN(methodId)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid payment method ID',
      );
    }

    const method = await this.prisma.subscription_payment_methods.findFirst({
      where: { id: methodId, store_id: storeId },
    });
    if (!method) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment method not found',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription_payment_methods.updateMany({
        where: { store_id: storeId, is_default: true },
        data: { is_default: false, updated_at: new Date() },
      });
      await tx.subscription_payment_methods.update({
        where: { id: methodId },
        data: { is_default: true, updated_at: new Date() },
      });
    });

    return {
      id: String(method.id),
      type: method.type,
      last4: method.last4,
      brand: method.brand,
      is_default: true,
      created_at: method.created_at.toISOString(),
    };
  }

  /**
   * G11 — Replace a payment method with a freshly-tokenized one.
   *
   * Wompi Phase 5: instead of mutating `provider_token`, the new card is
   * tokenized through `tokenizeAndRegister` (creating a fresh
   * payment_source). The old PM is then soft-deleted (state='replaced').
   */
  async replace(oldId: string, dto: TokenizePaymentMethodDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const oldMethodId = parseInt(oldId, 10);
    if (isNaN(oldMethodId)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid payment method ID',
      );
    }

    const oldMethod = await this.prisma.subscription_payment_methods.findFirst({
      where: { id: oldMethodId, store_id: storeId },
    });
    if (!oldMethod) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment method not found',
      );
    }

    const subscription = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!subscription) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'No active subscription for this store',
      );
    }

    const inheritsDefault = oldMethod.is_default || dto.is_default === true;

    // Tokenize first (calls Wompi outside the soft-delete tx — safer if the
    // gateway rejects, the old PM stays untouched).
    const newPmDto: TokenizePaymentMethodDto = {
      ...dto,
      is_default: inheritsDefault,
    };
    const created = await this.tokenizeAndRegister(
      storeId,
      subscription.id,
      newPmDto,
    );

    // Soft-delete the old PM and audit.
    const newPmId = parseInt(created.id, 10);
    return this.prisma.$transaction(async (tx) => {
      const oldMeta =
        (oldMethod.metadata as Record<string, unknown> | null) ?? {};
      const replacedAt = new Date();
      const nextOldMeta = {
        ...oldMeta,
        replaced_at: replacedAt.toISOString(),
        replaced_by_id: newPmId,
      } as Prisma.InputJsonValue;

      await tx.subscription_payment_methods.update({
        where: { id: oldMethod.id },
        data: {
          state: subscription_payment_method_state_enum.replaced,
          replaced_by_id: newPmId,
          replaced_at: replacedAt,
          is_default: false,
          metadata: nextOldMeta,
          updated_at: replacedAt,
        },
      });

      // Mirror the linkage on the new row so audit lineage is bidirectional.
      await tx.subscription_payment_methods.update({
        where: { id: newPmId },
        data: {
          metadata: {
            source: 'tokenize_widget',
            replaces_id: oldMethod.id,
            registered_at: replacedAt.toISOString(),
          } as Prisma.InputJsonValue,
          updated_at: replacedAt,
        },
      });

      // Audit row in subscription_events. Reuse `state_transition`; the
      // canonical event type enum has no `payment_method_replaced` value
      // yet (see schema enum). payload.reason='payment_method_replaced'
      // makes it queryable.
      await tx.subscription_events.create({
        data: {
          store_subscription_id: subscription.id,
          type: 'state_transition',
          payload: {
            reason: 'payment_method_replaced',
            old_payment_method_id: oldMethod.id,
            new_payment_method_id: newPmId,
            inherits_default: inheritsDefault,
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `PAYMENT_METHOD_REPLACED store=${storeId} oldPm=${oldMethod.id} newPm=${newPmId} default=${inheritsDefault}`,
      );

      return created;
    });
  }

  /**
   * S3.2 — Returns the most recent charges executed against a specific
   * payment method. Used by the "Configurar" modal to show the user a
   * snapshot of the last billing attempts (success / failure / failure
   * reason) for context before they edit / delete / replace the card.
   *
   * Linkage: `subscription_payments.metadata.saved_payment_method_id`
   * is set by `subscription-payment.service` on retry attempts that
   * reuse a saved Wompi token. Initial widget-flow charges (manual
   * widget tokenization) are not joined here — those have no saved PM.
   */
  async listCharges(id: string, limit = 5) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const methodId = parseInt(id, 10);
    if (isNaN(methodId)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid payment method ID',
      );
    }

    // Validate ownership before exposing payment history.
    const method = await this.prisma.subscription_payment_methods.findFirst({
      where: { id: methodId, store_id: storeId },
      select: { id: true },
    });
    if (!method) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment method not found',
      );
    }

    const safeLimit = Math.min(Math.max(limit, 1), 20);

    // Filter on metadata.saved_payment_method_id (Json path equality).
    // Prisma's `path` filter on Json supports number values via `equals`.
    const payments = await this.prisma.subscription_payments.findMany({
      where: {
        invoice: { store_id: storeId },
        metadata: {
          path: ['saved_payment_method_id'],
          equals: methodId,
        },
      },
      orderBy: { created_at: 'desc' },
      take: safeLimit,
      include: {
        invoice: {
          select: {
            invoice_number: true,
            currency: true,
          },
        },
      },
    });

    return payments.map((p) => ({
      id: String(p.id),
      invoice_number: p.invoice?.invoice_number ?? null,
      amount: p.amount.toString(),
      currency: p.currency || p.invoice?.currency || 'COP',
      state: p.state,
      paid_at: p.paid_at ? p.paid_at.toISOString() : null,
      created_at: p.created_at.toISOString(),
      failure_reason: p.failure_reason ?? null,
    }));
  }

  async remove(id: string) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const methodId = parseInt(id, 10);
    if (isNaN(methodId)) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_INTERNAL_ERROR,
        'Invalid payment method ID',
      );
    }

    const method = await this.prisma.subscription_payment_methods.findFirst({
      where: { id: methodId, store_id: storeId },
    });
    if (!method) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Payment method not found',
      );
    }

    await this.prisma.subscription_payment_methods.update({
      where: { id: methodId },
      data: {
        state: subscription_payment_method_state_enum.removed,
        updated_at: new Date(),
      },
    });

    return { success: true };
  }

  async prepareWidgetConfig(opts: {
    customerEmail?: string;
    redirectUrl?: string;
  }): Promise<TokenizeWidgetConfig | null> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const wompiConfig = await this.platformGw.getActiveCredentials('wompi');
    if (!wompiConfig) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }

    const reference = `vendix_saas_tokenize_${storeId}_${Date.now()}`;
    const amountInCents = 100; // Minimum amount for Wompi widget
    const currency = 'COP';

    const signatureIntegrity = this.computeIntegritySignature(
      reference,
      amountInCents,
      currency,
      wompiConfig.integrity_secret,
    );

    // Wompi Phase 5 — fetch acceptance + personal_auth tokens so the widget
    // can echo them back through the tokenize endpoint. Without these the
    // backend cannot create a long-lived `payment_source_id` for COF/MIT.
    const client = this.wompiClientFactory.getClient(
      `pm-widget-${storeId}`,
      this._toWompiConfig(wompiConfig),
    );
    const { acceptance_token, personal_auth_token } =
      await client.getAcceptanceTokens();

    return {
      public_key: wompiConfig.public_key,
      currency,
      amount_in_cents: amountInCents,
      reference,
      signature_integrity: signatureIntegrity,
      redirect_url: opts.redirectUrl ?? '',
      customer_email: opts.customerEmail ?? `saas-${storeId}@vendix.app`,
      acceptance_token,
      personal_auth_token,
    };
  }

  // ── Helpers ──────────────────────────────────────────────────────

  /**
   * Resolves platform-level Wompi credentials (used for SaaS billing) and
   * casts them to the `WompiConfig` shape consumed by the processor / client.
   */
  private async resolveWompiConfig(): Promise<WompiConfig> {
    const creds = await this.platformGw.getActiveCredentials('wompi');
    if (!creds) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'Credenciales de pasarela de plataforma no configuradas',
      );
    }
    return this._toWompiConfig(creds);
  }

  private _toWompiConfig(creds: DecryptedCreds): WompiConfig {
    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret,
      integrity_secret: creds.integrity_secret,
      // PlatformGatewayEnvironmentEnum and WompiEnvironment overlap by string
      // value (sandbox / production). Cast through unknown for safety.
      environment: (creds.environment as unknown as WompiEnvironment) ??
        WompiEnvironment.SANDBOX,
    };
  }

  private _mapPmResponse(m: {
    id: number;
    type: string;
    last4: string | null;
    brand: string | null;
    is_default: boolean;
    created_at: Date;
    provider_payment_source_id?: string | null;
  }) {
    return {
      id: String(m.id),
      type: m.type,
      last4: m.last4,
      brand: m.brand,
      is_default: m.is_default,
      created_at: m.created_at.toISOString(),
      providerPaymentSourceId: m.provider_payment_source_id ?? null,
    };
  }

  /**
   * Maps known Wompi / payment-gateway errors to typed VendixHttpExceptions.
   * Call inside catch blocks — re-throw unchanged if the error is not recognized.
   *
   * Wompi error signals (HTTP status + body.error codes):
   *  - 422 / token_invalid | token_expired  → SUBSCRIPTION_TOKEN_INVALID (400)
   *  - 402 / card_declined | card_blocked   → SUBSCRIPTION_CARD_DECLINED  (402)
   *  - 5xx / timeout / ECONNREFUSED         → SUBSCRIPTION_PROVIDER_UNAVAILABLE (503)
   */
  private _mapWompiError(error: unknown): never | void {
    const err = error as {
      status?: number;
      statusCode?: number;
      code?: string;
      message?: string;
      response?: { status?: number; data?: { error?: string } };
    };

    const httpStatus =
      err.status ?? err.statusCode ?? err.response?.status ?? 0;

    const wompiErrorCode = (
      err.code ??
      err.response?.data?.error ??
      ''
    ).toLowerCase();

    const message = (err.message ?? '').toLowerCase();

    // Token inválido / expirado
    if (
      wompiErrorCode.includes('token_invalid') ||
      wompiErrorCode.includes('token_expired') ||
      message.includes('token inválido') ||
      message.includes('token invalido') ||
      httpStatus === 422
    ) {
      this.logger.warn(`Wompi token inválido/expirado: ${String(error)}`);
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_TOKEN_INVALID,
        `Wompi token error: ${wompiErrorCode || message}`,
      );
    }

    // Tarjeta rechazada / bloqueada
    if (
      wompiErrorCode.includes('card_declined') ||
      wompiErrorCode.includes('card_blocked') ||
      message.includes('declined') ||
      message.includes('blocked') ||
      httpStatus === 402
    ) {
      this.logger.warn(`Wompi tarjeta rechazada: ${String(error)}`);
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_CARD_DECLINED,
        `Wompi card error: ${wompiErrorCode || message}`,
      );
    }

    // Provider no disponible (timeout, 5xx, ECONNREFUSED)
    if (
      httpStatus >= 500 ||
      wompiErrorCode.includes('econnrefused') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('network')
    ) {
      this.logger.error(`Wompi provider no disponible: ${String(error)}`);
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_PROVIDER_UNAVAILABLE,
        `Wompi provider error: ${wompiErrorCode || message}`,
      );
    }
  }

  private computeIntegritySignature(
    reference: string,
    amountInCents: number,
    currency: string,
    integritySecret: string,
  ): string {
    const concatenated = `${reference}${amountInCents}${currency}${integritySecret}`;
    return crypto.createHash('sha256').update(concatenated).digest('hex');
  }
}
