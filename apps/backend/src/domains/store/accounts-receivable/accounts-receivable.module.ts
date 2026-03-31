import { Module } from '@nestjs/common';
import { AccountsReceivableController } from './accounts-receivable.controller';
import { AccountsReceivableService } from './accounts-receivable.service';
import { ArAgingService } from './services/ar-aging.service';
import { ArCollectionService } from './services/ar-collection.service';
import { PaymentAgreementService } from './services/payment-agreement.service';
import { ArEventsListener } from './listeners/ar-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [AccountsReceivableController],
  providers: [
    AccountsReceivableService,
    ArAgingService,
    ArCollectionService,
    PaymentAgreementService,
    ArEventsListener,
  ],
  exports: [AccountsReceivableService],
})
export class AccountsReceivableModule {}
