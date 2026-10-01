import { Module, OnModuleInit } from '@nestjs/common';
import { AccountsReceivableController } from './accounts-receivable.controller';
import { AccountsReceivableService } from './accounts-receivable.service';
import { ArAgingService } from './services/ar-aging.service';
import { ArCollectionService } from './services/ar-collection.service';
import { PaymentAgreementService } from './services/payment-agreement.service';
import { ArEventsListener } from './listeners/ar-events.listener';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
// The receivables-payables tool family spans both sides of the ledger; this
// module owns the registration and imports the AP side (which does not import
// back, so no cycle).
import { AccountsPayableModule } from '../accounts-payable/accounts-payable.module';
import { AccountsPayableService } from '../accounts-payable/accounts-payable.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createReceivablesPayablesTools } from '../../../ai-engine/tools/domains/receivables-payables.tools';

@Module({
  imports: [PrismaModule, ResponseModule, AccountsPayableModule],
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
export class AccountsReceivableModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly receivable: AccountsReceivableService,
    private readonly payable: AccountsPayableService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createReceivablesPayablesTools({
        accountsReceivableService: this.receivable,
        accountsPayableService: this.payable,
      }),
    );
  }
}
