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
import { PurchaseOrdersModule } from './orders/purchase-orders/purchase-orders.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { StoreUsersModule } from './store-users/store-users.module';
import { SettingsModule } from './settings/settings.module';
import { CustomersModule } from './customers/customers.module';
import { StoreDomainsModule } from './domains/domains.module';
import { ShippingModule } from './shipping/shipping.module';
import { ExpensesModule } from './expenses/expenses.module';
import { StoreLegalDocumentsModule } from './legal-documents/legal-documents.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { InvoicingModule } from './invoicing/invoicing.module';
import { AccountingModule } from './accounting/accounting.module';
import { PayrollModule } from './payroll/payroll.module';
import { StoreRolesModule } from './roles/store-roles.module';
import { PromotionsModule } from './promotions/promotions.module';
import { CouponsModule } from './coupons/coupons.module';
import { QuotationsModule } from './quotations/quotations.module';
import { CashRegistersModule } from './cash-registers/cash-registers.module';
import { LayawayModule } from './layaway/layaway.module';
import { CreditsModule } from './credits/credits.module';
import { HabeasDataModule } from './habeas-data/habeas-data.module';
import { WithholdingTaxModule } from './withholding-tax/withholding-tax.module';
import { ExogenousModule } from './exogenous/exogenous.module';

@Module({
  imports: [
    BrandsModule,
    CategoriesModule,
    ProductsModule,
    RefundsModule,
    TaxesModule,
    PurchaseOrdersModule,
    OrdersModule,
    PaymentsModule,
    AddressesModule,
    StoresModule,
    InventoryModule,
    SuppliersModule,
    StoreUsersModule,
    SettingsModule,
    CustomersModule,
    StoreDomainsModule,
    ShippingModule,
    ExpensesModule,
    StoreLegalDocumentsModule,
    AnalyticsModule,
    NotificationsModule,
    InvoicingModule,
    AccountingModule,
    PayrollModule,
    StoreRolesModule,
    PromotionsModule,
    CouponsModule,
    QuotationsModule,
    CashRegistersModule,
    LayawayModule,
    CreditsModule,
    HabeasDataModule,
    WithholdingTaxModule,
    ExogenousModule,
  ],
  providers: [StorePrismaService],
  exports: [StorePrismaService],
})
export class StoreDomainModule { }
