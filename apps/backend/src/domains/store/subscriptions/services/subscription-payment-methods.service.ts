import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { Prisma, subscription_payment_method_state_enum } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { TokenizePaymentMethodDto } from '../dto/tokenize-payment-method.dto';
import { PlatformGatewayService } from '../../../superadmin/subscriptions/gateway/platform-gateway.service';

export interface TokenizeWidgetConfig {
  public_key: string;
  currency: string;
  amount_in_cents: number;
  reference: string;
  signature_integrity: string;
  redirect_url: string;
  customer_email: string;
}

@Injectable()
export class SubscriptionPaymentMethodsService {
  private readonly logger = new Logger(SubscriptionPaymentMethodsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformGw: PlatformGatewayService,
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
      };
    });
  }

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

    // If setting as default, unset any existing default
    if (dto.is_default) {
      await this.prisma.subscription_payment_methods.updateMany({
        where: { store_id: storeId, is_default: true },
        data: { is_default: false, updated_at: new Date() },
      });
    }

    let created: Awaited<
      ReturnType<typeof this.prisma.subscription_payment_methods.create>
    >;

    try {
      created = await this.prisma.subscription_payment_methods.create({
        data: {
          store_id: storeId,
          store_subscription_id: subscription.id,
          type: dto.type ?? 'card',
          provider: 'wompi',
          provider_token: dto.provider_token,
          last4: dto.last4 ?? null,
          brand: dto.brand ?? null,
          expiry_month: dto.expiry_month ?? null,
          expiry_year: dto.expiry_year ?? null,
          card_holder: dto.card_holder ?? null,
          is_default: dto.is_default ?? false,
          state: subscription_payment_method_state_enum.active,
        },
      });
    } catch (error: unknown) {
      this._mapWompiError(error);
      throw error;
    }

    return {
      id: String(created.id),
      type: created.type,
      last4: created.last4,
      brand: created.brand,
      is_default: created.is_default,
      created_at: created.created_at.toISOString(),
    };
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
   * Soft-deletes the old method (state='replaced') so payment history that
   * references its id stays intact, and creates a brand new method that
   * inherits the `is_default` flag if the old one was the default.
   *
   * NOTE: `replaced_at` and `replaced_by_id` are stored in `metadata` until
   * the schema gains dedicated columns — see TODO(G11-schema-gap).
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

    // Determine if the new PM should inherit the default flag.
    const inheritsDefault = oldMethod.is_default || dto.is_default === true;

    return this.prisma.$transaction(async (tx) => {
      // 1) Clear other defaults if the new one will be default.
      if (inheritsDefault) {
        await tx.subscription_payment_methods.updateMany({
          where: { store_id: storeId, is_default: true },
          data: { is_default: false, updated_at: new Date() },
        });
      }

      // 2) Create the new method.
      let created;
      try {
        created = await tx.subscription_payment_methods.create({
          data: {
            store_id: storeId,
            store_subscription_id: subscription.id,
            type: dto.type ?? oldMethod.type ?? 'card',
            provider: 'wompi',
            provider_token: dto.provider_token,
            last4: dto.last4 ?? null,
            brand: dto.brand ?? null,
            expiry_month: dto.expiry_month ?? null,
            expiry_year: dto.expiry_year ?? null,
            card_holder: dto.card_holder ?? null,
            is_default: inheritsDefault,
            state: subscription_payment_method_state_enum.active,
            metadata: {
              replaces_id: oldMethod.id,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (error: unknown) {
        this._mapWompiError(error);
        throw error;
      }

      // 3) Soft-delete the old method (preserve payment history references).
      const oldMeta =
        (oldMethod.metadata as Record<string, unknown> | null) ?? {};
      const nextOldMeta = {
        ...oldMeta,
        replaced_at: new Date().toISOString(),
        replaced_by_id: created.id,
      } as Prisma.InputJsonValue;

      const replacedAt = new Date();
      await tx.subscription_payment_methods.update({
        where: { id: oldMethod.id },
        data: {
          state: subscription_payment_method_state_enum.replaced,
          replaced_by_id: created.id,
          replaced_at: replacedAt,
          is_default: false,
          metadata: nextOldMeta,
          updated_at: replacedAt,
        },
      });

      // 4) Audit row in subscription_events. Reuse `state_transition`; the
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
            new_payment_method_id: created.id,
            inherits_default: inheritsDefault,
          } as Prisma.InputJsonValue,
        },
      });

      this.logger.log(
        `PAYMENT_METHOD_REPLACED store=${storeId} oldPm=${oldMethod.id} newPm=${created.id} default=${inheritsDefault}`,
      );

      return {
        id: String(created.id),
        type: created.type,
        last4: created.last4,
        brand: created.brand,
        is_default: created.is_default,
        created_at: created.created_at.toISOString(),
      };
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

    return {
      public_key: wompiConfig.public_key,
      currency,
      amount_in_cents: amountInCents,
      reference,
      signature_integrity: signatureIntegrity,
      redirect_url: opts.redirectUrl ?? '',
      customer_email:
        opts.customerEmail ?? `saas-${storeId}@vendix.app`,
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
      err.status ??
      err.statusCode ??
      err.response?.status ??
      0;

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
