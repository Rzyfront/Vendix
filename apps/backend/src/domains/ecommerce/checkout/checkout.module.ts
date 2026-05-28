import { Module, forwardRef } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CartModule } from '../cart/cart.module';
import { ShippingModule } from '../../store/shipping/shipping.module';
import { TaxesModule } from '../../store/taxes/taxes.module';
import { SettingsModule } from '../../store/settings/settings.module';
import { InventoryModule } from '../../store/inventory/inventory.module';
import { ProductsModule } from '../../store/products/products.module';
import { WompiModule } from '../../store/payments/processors/wompi/wompi.module';
import { PaymentEncryptionService } from '../../store/payments/services/payment-encryption.service';
import { PaymentsModule } from '../../store/payments/payments.module';
import { ReservationsModule } from '../../store/reservations/reservations.module';
import { InvoicingModule } from '../../store/invoicing/invoicing.module';
import { InvoiceDataRequestsModule } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.module';
import { S3Module } from '../../../common/services/s3.module';
import { CustomersModule } from '../../store/customers/customers.module';
import { PromotionsModule } from '../../store/promotions/promotions.module';
import { CouponsModule } from '../../store/coupons/coupons.module';

@Module({
  imports: [
    PrismaModule,
    CartModule,
    ShippingModule,
    TaxesModule,
    SettingsModule,
    InventoryModule,
    ProductsModule,
    WompiModule,
    // PaymentsModule provides WebhookHandlerService (used by confirm-wompi-payment).
    // Wrapped in forwardRef defensively because PaymentsModule already pulls in
    // OrderFlow/Orders/PaymentLinks via forwardRef.
    forwardRef(() => PaymentsModule),
    ReservationsModule,
    InvoicingModule,
    InvoiceDataRequestsModule,
    S3Module,
    CustomersModule,
    // PromotionsModule exposes PromotionEngineService.quoteDiscounts, the
    // shared source-of-truth used by checkout to recompute automatic promo
    // discounts. CouponsModule exposes CouponsService.validate/registerUse
    // for the optional coupon flow. Both must be available scoped per-store
    // (StorePrismaService inside).
    PromotionsModule,
    CouponsModule,
    // 5 MB max upload — matches what the checkout controller's
    // FileInterceptor advertises so multer rejects oversized uploads early
    // (before the buffer is even allocated).
    MulterModule.register({ limits: { fileSize: 5 * 1024 * 1024 } }),
  ],
  controllers: [CheckoutController],
  providers: [CheckoutService, PaymentEncryptionService],
  exports: [CheckoutService],
})
export class CheckoutModule {}
