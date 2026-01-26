import { Module } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CartModule } from '../cart/cart.module';
import { ShippingModule } from '../../store/shipping/shipping.module';

@Module({
    imports: [PrismaModule, CartModule, ShippingModule],
    controllers: [CheckoutController],
    providers: [CheckoutService],
    exports: [CheckoutService],
})
export class CheckoutModule { }

