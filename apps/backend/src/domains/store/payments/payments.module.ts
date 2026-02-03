import { Module, OnModuleInit, forwardRef } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { WebhookController } from './webhook.controller';
import { SystemPaymentMethodsController } from './controllers/system-payment-methods.controller';
import { StorePaymentMethodsController } from './controllers/store-payment-methods.controller';
import { OrganizationPaymentPoliciesController } from './controllers/organization-payment-policies.controller';
import { PaymentsService } from './payments.service';
import { ResponseModule } from '@common/responses/response.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';
import { OrderFlowModule } from '../orders/order-flow/order-flow.module';
import { StockLevelManager } from '../inventory/shared/services/stock-level-manager.service';
import { InventoryTransactionsService } from '../inventory/transactions/inventory-transactions.service';
import { TaxesModule } from '../taxes/taxes.module';
import {
  PaymentGatewayService,
  PaymentValidatorService,
  WebhookHandlerService,
} from './services';
import { SystemPaymentMethodsService } from './services/system-payment-methods.service';
import { StorePaymentMethodsService } from './services/store-payment-methods.service';
import { OrganizationPaymentPoliciesService } from './services/organization-payment-policies.service';
import {
  CashPaymentModule,
  StripeModule,
  PaypalModule,
  BankTransferModule,
} from './processors';
import { CashPaymentProcessor } from './processors/cash/cash.processor';
import { StripeProcessor } from './processors/stripe/stripe.processor';
import { PaypalProcessor } from './processors/paypal/paypal.processor';
import { BankTransferProcessor } from './processors/bank-transfer/bank-transfer.processor';

@Module({
  imports: [
    ResponseModule,
    PrismaModule,
    CashPaymentModule,
    StripeModule,
    PaypalModule,
    BankTransferModule,
    forwardRef(() => OrdersModule),
    forwardRef(() => OrderFlowModule),
    TaxesModule,
  ],
  controllers: [
    PaymentsController,
    WebhookController,
    SystemPaymentMethodsController,
    StorePaymentMethodsController,
    OrganizationPaymentPoliciesController,
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
  ],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private paymentGateway: PaymentGatewayService,
    private cashProcessor: CashPaymentProcessor,
    private stripeProcessor: StripeProcessor,
    private paypalProcessor: PaypalProcessor,
    private bankTransferProcessor: BankTransferProcessor,
  ) { }

  onModuleInit() {
    this.paymentGateway.registerProcessor('cash', this.cashProcessor);
    this.paymentGateway.registerProcessor('card', this.stripeProcessor);
    this.paymentGateway.registerProcessor('paypal', this.paypalProcessor);
    this.paymentGateway.registerProcessor(
      'bank_transfer',
      this.bankTransferProcessor,
    );
  }
}
