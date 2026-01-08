import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { CartModule } from './cart/cart.module';
import { WishlistModule } from './wishlist/wishlist.module';
import { CheckoutModule } from './checkout/checkout.module';
import { AccountModule } from './account/account.module';

/**
 * 🛒 Ecommerce Domain Module
 *
 * Provides customer-facing ecommerce functionality:
 * - CatalogModule: Public product browsing
 * - CartModule: Shopping cart management
 * - WishlistModule: User favorites
 * - CheckoutModule: Order placement
 * - AccountModule: Customer profile and orders
 */
@Module({
    imports: [
        CatalogModule,
        CartModule,
        WishlistModule,
        CheckoutModule,
        AccountModule,
    ],
})
export class EcommerceDomainModule { }
