import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { CheckoutModule } from './checkout/checkout.module';
import { AccountModule } from './account/account.module';
import { EcommerceLegalModule } from './legal/ecommerce-legal.module';
import { EcommerceReviewsModule } from './reviews/reviews.module';
import { EcommerceReservationsModule } from './reservations/ecommerce-reservations.module';
import { EcommerceCustomerQueueModule } from './customer-queue/ecommerce-customer-queue.module';
import { EcommerceInvoiceDataModule } from './invoice-data/ecommerce-invoice-data.module';

/**
 * 🛒 Ecommerce Domain Module
 *
 * Provides customer-facing ecommerce functionality:
 * - CatalogModule: Public product browsing
 * - CartModule: Shopping cart management
 * - WishlistModule: User favorites
 * - CheckoutModule: Order placement
 * - AccountModule: Customer profile and orders
 * - EcommerceReviewsModule: Product reviews and ratings
 */
@Module({
    imports: [
        CatalogModule,
        CartModule,
        WishlistModule,
        CheckoutModule,
        AccountModule,
        EcommerceLegalModule,
        EcommerceReviewsModule,
        EcommerceReservationsModule,
        EcommerceCustomerQueueModule,
        EcommerceInvoiceDataModule,
    ],
})
export class EcommerceDomainModule { }
