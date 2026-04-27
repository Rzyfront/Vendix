import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { WebhookController } from './webhook.controller';
import { SystemPaymentMethodsController } from './controllers/system-payment-methods.controller';
import { StorePaymentMethodsController } from './controllers/store-payment-methods.controller';
import { OrganizationPaymentPoliciesController } from './controllers/organization-payment-policies.controller';
import { WompiController } from './controllers/wompi.controller';
import { PaymentsService } from './payments.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../inventory/transactions/inventory-transactions.service';
import { TaxesModule } from '../taxes/taxes.module';
import { SettingsModule } from '../settings/settings.module';
import {
  PaymentGatewayService,
  PaymentValidatorService,
  WebhookHandlerService,
  WompiWebhookValidatorService,
} from './services';
import { WompiReconciliationService } from './services/wompi-reconciliation.service';
import { SystemPaymentMethodsService } from './services/system-payment-methods.service';
import { StorePaymentMethodsService } from './services/store-payment-methods.service';
import { OrganizationPaymentPoliciesService } from './services/organization-payment-policies.service';
import { PaymentEncryptionService } from './services/payment-encryption.service';
import { PromotionsModule } from '../promotions/promotions.module';
import { CashRegistersModule } from '../cash-registers/cash-registers.module';
import {
  CashPaymentModule,
  StripeModule,
  PaypalModule,
  BankTransferModule,
  WompiModule,
} from './processors';
import { CashPaymentProcessor } from './processors/cash/cash.processor';
import { StripeProcessor } from './processors/stripe/stripe.processor';
import { PaypalProcessor } from './processors/paypal/paypal.processor';
import { BankTransferProcessor } from './processors/bank-transfer/bank-transfer.processor';
import { WompiProcessor } from './processors/wompi/wompi.processor';
import { WalletModule } from '../wallet/wallet.module';
import { WalletPaymentProcessor } from '../wallet/services/wallet-payment.processor';
import { PaymentLinksModule } from '../payment-links/payment-links.module';
import { InvoiceDataRequestsModule } from '../invoicing/invoice-data-requests/invoice-data-requests.module';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    CashPaymentModule,
    StripeModule,
    PaypalModule,
    BankTransferModule,
    WompiModule,
    WalletModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => OrderFlowModule),
    forwardRef(() => PaymentLinksModule),
    TaxesModule,
    SettingsModule,
    PromotionsModule,
    CashRegistersModule,
    InvoiceDataRequestsModule,
  ],
  controllers: [
    PaymentsController,
    WebhookController,
    SystemPaymentMethodsController,
    StorePaymentMethodsController,
    OrganizationPaymentPoliciesController,
    WompiController,
  ],
  providers: [
    PaymentsService,
    PaymentGatewayService,
    PaymentValidatorService,
    WebhookHandlerService,
    WebhookController,
    StockLevelManager,
    InventoryTransactionsService,
    SystemPaymentMethodsService,
    StorePaymentMethodsService,
    OrganizationPaymentPoliciesService,
    PaymentEncryptionService,
    WompiWebhookValidatorService,
    WompiReconciliationService,
  ],
  exports: [
    PaymentsService,
    PaymentGatewayService,
    PaymentValidatorService,
    WebhookHandlerService,
    WebhookController,
    SystemPaymentMethodsService,
    StorePaymentMethodsService,
    OrganizationPaymentPoliciesService,
    PaymentEncryptionService,
    WompiReconciliationService,
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private paymentGateway: PaymentGatewayService,
    private cashProcessor: CashPaymentProcessor,
    private stripeProcessor: StripeProcessor,
    private paypalProcessor: PaypalProcessor,
    private bankTransferProcessor: BankTransferProcessor,
    private wompiProcessor: WompiProcessor,
    private walletProcessor: WalletPaymentProcessor,
  ) { }

  onModuleInit() {
    this.paymentGateway.registerProcessor('cash', this.cashProcessor);
    this.paymentGateway.registerProcessor('card', this.stripeProcessor);
    this.paymentGateway.registerProcessor('paypal', this.paypalProcessor);
    this.paymentGateway.registerProcessor(
      'bank_transfer',
      this.bankTransferProcessor,
    );
    this.paymentGateway.registerProcessor('wompi', this.wompiProcessor);
    this.paymentGateway.registerProcessor('wallet', this.walletProcessor);
  }
}
