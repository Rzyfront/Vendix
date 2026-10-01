import { Module, OnModuleInit } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { QuotationsController } from './quotations.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { EmailModule } from '../../../email/email.module';
import { QuotationProfilesModule } from '../backend-quotations-profiles/quotation-profiles.module';
import { TaxesModule } from '../taxes/taxes.module';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createQuotationTools } from '../../../ai-engine/tools/domains/quotations.tools';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    OrdersModule,
    EmailModule,
    QuotationProfilesModule,
    TaxesModule,
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly quotations: QuotationsService,
  ) {}

  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createQuotationTools({ quotationsService: this.quotations }),
    );
  }
}
