import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    Header,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/cart')
@UseGuards(JwtAuthGuard)
export class CartController {
    constructor(private readonly cart_service: CartService) { }

    @Get()
    @Header('Cache-Control', 'no-store')
    async getCart() {
        // store_id y user_id se resuelven automáticamente desde el dominio y el JWT
        const data = await this.cart_service.getCart();
        return { success: true, data };
    }

    @Post('items')
    @Header('Cache-Control', 'no-store')
    async addItem(@Body() dto: AddToCartDto) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.cart_service.addItem(dto);
        return { success: true, data };
    }

    @Put('items/:id')
    @Header('Cache-Control', 'no-store')
    async updateItem(
        @Param('id') item_id: string,
        @Body() dto: UpdateCartItemDto,
    ) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.cart_service.updateItem(
            parseInt(item_id, 10),
            dto,
        );
        return { success: true, data };
    }

    @Delete('items/:id')
    @Header('Cache-Control', 'no-store')
    async removeItem(@Param('id') item_id: string) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.cart_service.removeItem(parseInt(item_id, 10));
        return { success: true, data };
    }

    @Delete()
    @Header('Cache-Control', 'no-store')
    async clearCart() {
        // store_id y user_id se resuelven automáticamente
        return this.cart_service.clearCart();
    }

    @Post('sync')
    @Header('Cache-Control', 'no-store')
    async syncCart(@Body() dto: SyncCartDto) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.cart_service.syncFromLocalStorage(dto);
        return { success: true, data };
    }
}
