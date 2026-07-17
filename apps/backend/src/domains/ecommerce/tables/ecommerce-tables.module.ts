import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { TablesModule } from '../../store/tables/tables.module';
import { SettingsModule } from '../../store/settings/settings.module';
import { CustomersModule } from '../../store/customers/customers.module';
import { MenusModule } from '../../store/menus/menus.module';
import { KitchenFireModule } from '../../store/kitchen-fire/kitchen-fire.module';
import { NotificationsModule } from '../../store/notifications/notifications.module';
import { WompiModule } from '../../store/payments/processors/wompi/wompi.module';
import { PaymentsModule } from '../../store/payments/payments.module';
import { EcommerceTablesController } from './ecommerce-tables.controller';
import { EcommerceTablesService } from './ecommerce-tables.service';

/**
 * EcommerceTablesModule — QR-por-mesa (Pasos 6 + 8)
 *
 * Public-facing table QR resolution + auto-pedido a la cuenta.
 *
 * Depends on:
 *   - TablesModule:           TablesService (getActiveSession, update),
 *                             TableSessionsService (openTableSessionPublic, addItems)
 *   - SettingsModule:         SettingsService (store currency fallback)
 *   - CustomersModule:        CustomersService (resolveTableGuestCustomer —
 *                             welcome-wizard "cliente presentado")
 *   - MenusModule:            MenuAvailabilityCheckerService (carta window gating)
 *   - KitchenFireModule:      KitchenFireService (prepareFireContext, fireOrderItemsInTx,
 *                             emitKitchenFiredAfterCommit — auto-fire path)
 *   - NotificationsModule:    NotificationsSseService (staff SSE for require_staff)
 *   - WompiModule:            WompiProcessor / WompiClientFactory (mesa checkout QR flow)
 *   - PaymentsModule:         PaymentGatewayService / StorePaymentMethodsService /
 *                             WebhookHandlerService (mesa checkout orchestration)
 *
 * PaymentsModule is wrapped in forwardRef because it internally depends on
 * WompiModule via forwardRef; importing both into EcommerceTablesModule at the
 * same time re-introduces the cycle at this level, so we break it defensively
 * (same pattern as CheckoutModule).
 *
 * Tenant isolation: `StorePrismaService` auto-scope (via PrismaModule).
 * The store_id is resolved from the ecommerce domain by
 * `DomainResolverMiddleware` and stored in `RequestContextService`.
 */
@Module({
  imports: [
    PrismaModule,
    TablesModule,
    SettingsModule,
    CustomersModule,
    MenusModule,
    KitchenFireModule,
    NotificationsModule,
    WompiModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [EcommerceTablesController],
  providers: [EcommerceTablesService],
  exports: [EcommerceTablesService],
})
export class EcommerceTablesModule {}