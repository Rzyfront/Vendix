import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { SubscriptionManualPaymentService } from '../../../store/subscriptions/services/subscription-manual-payment.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';

class ManualPaymentDto {
  bank_reference!: string;
  paid_at!: string;
  amount!: number;
}

@UseGuards(PermissionsGuard)
@Controller('superadmin/subscriptions/invoices')
export class ManualPaymentController {
  constructor(
    private readonly manualPaymentService: SubscriptionManualPaymentService,
    private readonly responseService: ResponseService,
  ) {}

  @Post(':id/manual-payment')
  @Permissions('superadmin:subscriptions')
  async recordManualPayment(
    @Param('id') id: string,
    @Body() dto: ManualPaymentDto,
  ) {
    const invoiceId = parseInt(id, 10);
    if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_VALIDATION);
    }

    const user = RequestContextService.getContext();
    await this.manualPaymentService.recordManualPayment(invoiceId, {
      bankReference: dto.bank_reference,
      paidAt: new Date(dto.paid_at),
      amount: new Prisma.Decimal(dto.amount),
      recordedByUserId: user?.user_id ?? 0,
    });

    return this.responseService.success(null, 'Manual payment recorded');
  }
}
