import { Module, OnModuleInit } from '@nestjs/common';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { createCustomerTools } from '../../../ai-engine/tools/domains/customers.tools';
import { createCustomerWriteTools } from '../../../ai-engine/tools/domains/writes.tools';
import { CustomersService } from './customers.service';
import { CustomerLookupService } from './customer-lookup.service';
import { CustomersController } from './customers.controller';
import { CustomersBulkService } from './customers-bulk.service';
import { CustomersBulkController } from './customers-bulk.controller';
import { CustomerHistoryController } from './history/customer-history.controller';
import { CustomerHistoryService } from './history/customer-history.service';
import { CustomerEmailListener } from './customer-email.listener';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { MetadataModule } from '../metadata/metadata.module';
import { EmailModule } from '../../../email/email.module';

@Module({
  imports: [ResponseModule, MetadataModule, EmailModule],
  controllers: [
    CustomersController,
    CustomersBulkController,
    CustomerHistoryController,
  ],
  providers: [
    CustomersService,
    CustomerLookupService,
    CustomersBulkService,
    CustomerHistoryService,
    CustomerEmailListener,
    StorePrismaService,
  ],
  exports: [CustomersService, CustomerLookupService, CustomerHistoryService],
})
export class CustomersModule implements OnModuleInit {
  constructor(
    private readonly toolRegistry: AIToolRegistry,
    private readonly customersService: CustomersService,
    private readonly prisma: StorePrismaService,
  ) {}

  /**
   * Registers the customers tool family for the AI agent. It lives here and
   * not in `AIEngineModule` because that module is `@Global()`: importing one
   * domain module per tool family into it generates dependency cycles.
   * `AIToolRegistry` is exported globally, so the dependency points from the
   * domain to the engine and this module imports nothing extra.
   */
  onModuleInit(): void {
    this.toolRegistry.registerMany(
      createCustomerTools({
        customersService: this.customersService,
        prisma: this.prisma,
      }),
    );

    // `upsert_customer`: crear o corregir un cliente. Delega en
    // `CustomersService`, dueño del rol `customer`, del vínculo con la tienda y
    // de la unicidad de documento dentro de la organización.
    this.toolRegistry.registerMany(
      createCustomerWriteTools({
        customersService: this.customersService,
        prisma: this.prisma,
      }),
    );
  }
}
