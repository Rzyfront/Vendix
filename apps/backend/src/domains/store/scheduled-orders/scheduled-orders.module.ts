import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import { FulfillmentExceptionsService } from './fulfillment-exceptions.service';
import { FulfillmentExceptionsController } from './fulfillment-exceptions.controller';

/**
 * Pedidos programados (venta por encargo): agenda de cumplimiento,
 * agendamiento de órdenes, producción y recordatorios. Todo inerte mientras
 * `store_settings.scheduled_orders.enabled` siga en false.
 */
@Module({
  imports: [ResponseModule, PrismaModule],
  controllers: [FulfillmentExceptionsController],
  providers: [FulfillmentAvailabilityService, FulfillmentExceptionsService],
  exports: [FulfillmentAvailabilityService],
})
export class ScheduledOrdersModule {}
