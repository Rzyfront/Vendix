import { Module, forwardRef } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SalesOrdersModule } from './sales-orders/sales-orders.module';
import { StockTransfersModule } from './stock-transfers/stock-transfers.module';
import { ReturnOrdersModule } from './return-orders/return-orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { OrderFlowModule } from './order-flow/order-flow.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    SalesOrdersModule,
    StockTransfersModule,
    ReturnOrdersModule,
    forwardRef(() => PaymentsModule),
    OrderFlowModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
  exports: [OrdersService, OrderFlowModule],
})
export class OrdersModule {}
