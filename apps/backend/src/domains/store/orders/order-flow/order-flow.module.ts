import { Module } from '@nestjs/common';
import { OrderFlowService } from './order-flow.service';
import { OrderFlowController } from './order-flow.controller';
import { PrismaModule } from '../../../../prisma/prisma.module';
import { ResponseModule } from '@common/responses/response.module';

@Module({
  imports: [PrismaModule, ResponseModule],
  controllers: [OrderFlowController],
  providers: [OrderFlowService],
  exports: [OrderFlowService],
})
export class OrderFlowModule {}
