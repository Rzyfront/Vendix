import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CustomersBulkService } from './customers-bulk.service';
import { CustomersBulkController } from './customers-bulk.controller';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ResponseModule } from '../../../common/responses/response.module';

@Module({
    imports: [ResponseModule],
    controllers: [CustomersController, CustomersBulkController],
    providers: [CustomersService, CustomersBulkService, StorePrismaService],
    exports: [CustomersService],
})
export class CustomersModule { }
