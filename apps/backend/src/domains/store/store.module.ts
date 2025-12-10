import { Module } from '@nestjs/common';
import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { BrandsModule } from './brands/brands.module';
import { CategoriesModule } from './categories/categories.module';
import { ProductsModule } from './products/products.module';
import { RefundsModule } from './refunds/refunds.module';
import { TaxesModule } from './taxes/taxes.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';
import { AddressesModule } from './addresses/addresses.module';
import { StoresModule } from './stores/stores.module';
import { InventoryModule } from './inventory/inventory.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { StoreUsersModule } from './store-users/store-users.module';
import { SettingsModule } from './settings/settings.module';
import { CustomersModule } from './customers/customers.module';

@Module({
  imports: [
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    RefundsModule,
    TaxesModule,
    OrdersModule,
    PaymentsModule,
    AddressesModule,
    StoresModule,
    InventoryModule,
    SuppliersModule,
    StoreUsersModule,
    SettingsModule,
    CustomersModule,
  ],
  providers: [StorePrismaService],
  exports: [StorePrismaService],
})
export class StoreDomainModule { }
