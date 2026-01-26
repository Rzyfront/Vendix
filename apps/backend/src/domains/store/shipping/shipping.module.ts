import { Module } from '@nestjs/common';
import { ShippingService } from './shipping.service';
import { ShippingController } from './shipping.controller';
import { ShippingCalculatorService } from './shipping-calculator.service';
import { PrismaModule } from '../../../prisma/prisma.module';

@Module({
    imports: [PrismaModule],
    controllers: [ShippingController],
    providers: [ShippingService, ShippingCalculatorService],
    exports: [ShippingService, ShippingCalculatorService],
})
export class ShippingModule { }
