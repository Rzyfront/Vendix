import {
    Controller,
    Get,
    Post,
    Body,
    Headers,
    UseGuards,
    Request,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { CheckoutDto } from './dto/checkout.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
    constructor(private readonly checkout_service: CheckoutService) { }

    @Get('payment-methods')
    async getPaymentMethods(@Headers('x-store-id') store_id_header: string) {
        const store_id = parseInt(store_id_header, 10);
        const data = await this.checkout_service.getPaymentMethods(store_id);
        return { success: true, data };
    }

    @Post()
    async checkout(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Body() dto: CheckoutDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.checkout_service.checkout(store_id, user_id, dto);
        return { success: true, data };
    }
}
