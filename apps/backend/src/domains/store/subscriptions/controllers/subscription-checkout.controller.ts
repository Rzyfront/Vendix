import { Body, Controller, Post } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionProrationService } from '../services/subscription-proration.service';
import { SubscriptionBillingService } from '../services/subscription-billing.service';
import { SubscriptionPaymentService } from '../services/subscription-payment.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UseGuards } from '@nestjs/common';
import { CheckoutPreviewDto } from '../dto/checkout-preview.dto';
import { CheckoutCommitDto } from '../dto/checkout-commit.dto';
import { Prisma } from '@prisma/client';
import { InvoicePreview } from '../types/billing.types';
import { SkipSubscriptionGate } from '../decorators/skip-subscription-gate.decorator';

const DECIMAL_ZERO = new Prisma.Decimal(0);

@UseGuards(PermissionsGuard)
@SkipSubscriptionGate()
@Controller('store/subscriptions/checkout')
export class SubscriptionCheckoutController {
  constructor(
    private readonly proration: SubscriptionProrationService,
    private readonly billing: SubscriptionBillingService,
    private readonly payment: SubscriptionPaymentService,
    private readonly prisma: GlobalPrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @Permissions('subscriptions:read')
  @Post('preview')
  async preview(@Body() dto: CheckoutPreviewDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
      select: { id: true },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const prorationPreview = await this.proration.preview(sub.id, dto.planId);

    let invoicePreview: InvoicePreview | null = null;
    if (prorationPreview.invoice_to_issue) {
      invoicePreview = prorationPreview.invoice_to_issue;
    } else {
      const newSub = await this.prisma.store_subscriptions.findUnique({
        where: { id: sub.id },
      });
      if (newSub) {
        try {
          invoicePreview = await this.billing.previewNextInvoice(sub.id);
        } catch {
          invoicePreview = null;
        }
      }
    }

    return this.responseService.success(
      { proration: prorationPreview, invoice: invoicePreview },
      'Checkout preview retrieved',
    );
  }

  @Permissions('subscriptions:write')
  @Post('commit')
  async commit(@Body() dto: CheckoutCommitDto) {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const sub = await this.prisma.store_subscriptions.findUnique({
      where: { store_id: storeId },
    });
    if (!sub) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001);
    }

    const updated = await this.proration.apply(sub.id, dto.planId);

    const prorationAmount = await this.prisma.subscription_invoices.findFirst({
      where: { store_subscription_id: sub.id, state: 'issued' },
      orderBy: { created_at: 'desc' },
    });

    if (prorationAmount) {
      const total = new Prisma.Decimal(prorationAmount.total);
      if (total.greaterThan(DECIMAL_ZERO)) {
        await this.payment.charge(prorationAmount.id);
      }
    }

    return this.responseService.success(updated, 'Checkout committed');
  }
}
