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
import { PublicModule } from './common/public/public.module';
import { AuditModule } from './modules/audit/audit.module';
import { DomainSettingsModule } from './common/modules/domain-settings.module'; // ✅ Agregar import faltante
import { RolesModule } from './modules/roles/roles.module';

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
    PublicModule, // Módulo público para endpoints sin autenticación
    DomainSettingsModule, // Módulo para configuración de dominios
    AuditModule, // Módulo de auditoría
    RolesModule, // Módulo de roles y permisos
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}