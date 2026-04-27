import {
    Controller,
    Get,
    Post,
    Body,
    Param,
    ParseIntPipe,
    Query,
    UseGuards,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { WhatsappCheckoutDto } from './dto/whatsapp-checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';

@Controller('ecommerce/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
    constructor(private readonly checkout_service: CheckoutService) { }

    @Get('payment-methods')
    async getPaymentMethods(@Query('shipping_type') shippingType?: string) {
        // store_id se resuelve automáticamente desde el dominio
        // shipping_type filters payment methods by processing_mode:
        // - pickup: DIRECT + ONLINE
        // - delivery/carrier/etc: ONLINE + ON_DELIVERY
        const data = await this.checkout_service.getPaymentMethods(shippingType);
        return { success: true, data };
    }

    @Post()
    async checkout(@Body() dto: CheckoutDto) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.checkout_service.checkout(dto);
        return { success: true, data };
    }

    @Post('prepare-wompi')
    async prepareWompiPayment(
        @Body() dto: { order_id: number; amount: number; currency?: string; customer_email?: string; redirect_url?: string },
    ) {
        const data = await this.checkout_service.prepareWompiPayment(dto);
        return { success: true, data };
    }

    /**
     * Force-confirm a Wompi payment for an order by polling the Wompi API
     * directly. Called by the frontend widget callback so the user sees the
     * correct order/payment state immediately on return — does not replace
     * the canonical webhook flow, only complements it.
     *
     * Auth: customer JWT (same JwtAuthGuard as the rest of /ecommerce/checkout).
     * Tenant: store context resolved from x-store-id header (CheckoutService
     * uses StorePrismaService which scopes by store).
     */
    @Post('confirm-wompi-payment/:orderId')
    async confirmWompiPayment(
        @Param('orderId', ParseIntPipe) orderId: number,
    ) {
        const data = await this.checkout_service.confirmWompiPayment(orderId);
        return { success: true, data };
    }

    @OptionalAuth()
    @Post('whatsapp')
    async whatsappCheckout(@Body() dto: WhatsappCheckoutDto) {
        const data = await this.checkout_service.whatsappCheckout(dto);
        return { success: true, data };
    }
}
