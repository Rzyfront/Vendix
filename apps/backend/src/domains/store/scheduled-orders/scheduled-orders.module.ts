import { Module } from '@nestjs/common';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { FulfillmentAvailabilityService } from './fulfillment-availability.service';
import { FulfillmentExceptionsService } from './fulfillment-exceptions.service';
import { FulfillmentExceptionsController } from './fulfillment-exceptions.controller';
import { ScheduledOrdersService } from './scheduled-orders.service';
import { ScheduledOrdersController } from './scheduled-orders.controller';
import { ScheduledOrderCancelledListener } from './listeners/order-cancelled.listener';
import { EcommerceScheduledOrdersController } from './ecommerce-scheduled-orders.controller';
import { ScheduledOrderProductionService } from './scheduled-order-production.service';
import { InventoryModule } from '../inventory/inventory.module';
import { RecipesModule } from '../recipes/recipes.module';
import { EmailModule } from '../../../email/email.module';
import { ScheduledOrderRemindersJob } from './jobs/scheduled-order-reminders.job';
import { ScheduledOrderReminderEmailListener } from './listeners/reminder-email.listener';

/**
 * Pedidos programados (venta por encargo): agenda de cumplimiento,
 * agendamiento de órdenes, producción y recordatorios. Todo inerte mientras
 * `store_settings.scheduled_orders.enabled` siga en false.
 */
@Module({
  // Inventario y recetas para el consumo al iniciar producción (S4). Sin
  // ciclo: ninguno de los dos importa pagos, checkout ni este módulo.
  // EmailModule: recordatorio al cliente por email (S5).
  imports: [ResponseModule, PrismaModule, InventoryModule, RecipesModule, EmailModule],
  // Orden importa: las rutas fijas (availability, exceptions, agenda) antes de `:id`.
  controllers: [
    FulfillmentExceptionsController,
    ScheduledOrdersController,
    EcommerceScheduledOrdersController,
  ],
  providers: [
    FulfillmentAvailabilityService,
    FulfillmentExceptionsService,
    ScheduledOrdersService,
    ScheduledOrderCancelledListener,
    ScheduledOrderProductionService,
    ScheduledOrderRemindersJob,
    ScheduledOrderReminderEmailListener,
  ],
  exports: [FulfillmentAvailabilityService, ScheduledOrdersService],
})
export class ScheduledOrdersModule {}
