import { Module } from '@nestjs/common';
import { CustomerQueueService } from './customer-queue.service';
import { CustomerQueueController } from './customer-queue.controller';
import { QrService } from '../../../common/services/qr.service';
import { CustomersModule } from '../customers/customers.module';
import { ResponseModule } from '../../../common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
  imports: [CustomersModule, ResponseModule, PrismaModule],
  providers: [CustomerQueueService, QrService],
  controllers: [CustomerQueueController],
  exports: [CustomerQueueService, QrService],
})
export class CustomerQueueModule {}
