import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerLookupService } from './customer-lookup.service';
import { CustomersController } from './customers.controller';
import { CustomersBulkService } from './customers-bulk.service';
import { CustomersBulkController } from './customers-bulk.controller';
import { CustomerHistoryController } from './history/customer-history.controller';
import { CustomerHistoryService } from './history/customer-history.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseModule } from '../../../common/responses/response.module';
import { MetadataModule } from '../metadata/metadata.module';

@Module({
    imports: [ResponseModule, MetadataModule],
    controllers: [CustomersController, CustomersBulkController, CustomerHistoryController],
    providers: [CustomersService, CustomerLookupService, CustomersBulkService, CustomerHistoryService, StorePrismaService],
    exports: [CustomersService, CustomerLookupService, CustomerHistoryService],
})
export class CustomersModule { }
