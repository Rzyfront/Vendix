import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';
import { SuperadminMessagingPricesController } from './messaging-prices.controller';
import { SuperadminMessagingPricesService } from './messaging-prices.service';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [SuperadminMessagingPricesController],
  providers: [SuperadminMessagingPricesService],
})
export class SuperadminMessagingPricesModule {}
