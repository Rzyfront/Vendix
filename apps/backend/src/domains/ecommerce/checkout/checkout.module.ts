import { Module } from '@nestjs/common';
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
import { ReservationsModule } from '../../store/reservations/reservations.module';

@Module({
    imports: [PrismaModule, CartModule, ShippingModule, TaxesModule, SettingsModule, InventoryModule, ProductsModule, WompiModule, ReservationsModule],
    controllers: [CheckoutController],
    providers: [CheckoutService, PaymentEncryptionService],
    exports: [CheckoutService],
})
export class CheckoutModule { }

