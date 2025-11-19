import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './modules/users/users.module';
import { TestModule } from './test/test.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { StoresModule } from './modules/stores/stores.module';
import { AddressesModule } from './modules/addresses/addresses.module';
import { BrandsModule } from './modules/brands/brands.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { ProductsModule } from './modules/products/products.module';
import { TaxesModule } from './modules/taxes/taxes.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { AuditModule } from './modules/audit/audit.module';
import { DomainsModule } from './modules/domains/domains.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { BypassEmailModule } from './modules/bypass-email/bypass-email.module';
import { AdminOrganizationsModule } from './modules/superadmin/admin-organizations/admin-organizations.module';
import { AdminStoresModule } from './modules/superadmin/admin-stores/admin-stores.module';
import { AdminDomainsModule } from './modules/superadmin/admin-domains/admin-domains.module';
import { AdminRolesModule } from './modules/superadmin/admin-roles/admin-roles.module';
import { AdminUsersModule } from './modules/superadmin/admin-users/admin-users.module';
import { AdminDashboardModule } from './modules/superadmin/admin-dashboard/admin-dashboard.module';

import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RequestContextService } from './common/context/request-context.service';
import { RequestContextInterceptor } from './common/interceptors/request-context.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    PrismaModule,
    OrganizationsModule,
    StoresModule,
    UsersModule,

    AddressesModule,
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    TaxesModule,
    OrdersModule,
    PaymentsModule,
    RefundsModule,
    InventoryModule,
    TestModule,
    DomainsModule, // ✅ Módulo de dominios (público y privado)
    AuditModule, // Módulo de auditoría
    RolesModule, // Módulo de roles y permisos
    PermissionsModule, // Módulo de permisos
    BypassEmailModule, // Módulo de bypass de email (solo desarrollo)
    // Admin modules for SuperAdmin functionality
    AdminOrganizationsModule,
    AdminStoresModule,
    AdminDomainsModule,
    AdminRolesModule,
    AdminUsersModule,
    AdminDashboardModule,
    OnboardingModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    RequestContextService, // ✅ Servicio de contexto con AsyncLocalStorage
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
