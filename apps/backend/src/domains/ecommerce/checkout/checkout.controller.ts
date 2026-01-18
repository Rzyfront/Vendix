import {
    Controller,
    Get,
    Post,
    Body,
    UseGuards,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
    constructor(private readonly checkout_service: CheckoutService) { }

    @Get('payment-methods')
    async getPaymentMethods() {
        // store_id se resuelve automáticamente desde el dominio
        const data = await this.checkout_service.getPaymentMethods();
        return { success: true, data };
    }

    @Post()
    async checkout(@Body() dto: CheckoutDto) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.checkout_service.checkout(dto);
        return { success: true, data };
    }
}
