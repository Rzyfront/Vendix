import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    Headers,
    UseGuards,
    Request,
} from '@nestjs/common';
import { CartService } from './cart.service';
import { AddToCartDto, UpdateCartItemDto, SyncCartDto } from './dto/cart.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/cart')
@UseGuards(JwtAuthGuard)
export class CartController {
    constructor(private readonly cart_service: CartService) { }

    @Get()
    async getCart(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.cart_service.getCart(store_id, user_id);
        return { success: true, data };
    }

    @Post('items')
    async addItem(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Body() dto: AddToCartDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.cart_service.addItem(store_id, user_id, dto);
        return { success: true, data };
    }

    @Put('items/:id')
    async updateItem(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Param('id') item_id: string,
        @Body() dto: UpdateCartItemDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.cart_service.updateItem(
            store_id,
            user_id,
            parseInt(item_id, 10),
            dto,
        );
        return { success: true, data };
    }

    @Delete('items/:id')
    async removeItem(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Param('id') item_id: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.cart_service.removeItem(
            store_id,
            user_id,
            parseInt(item_id, 10),
        );
        return { success: true, data };
    }

    @Delete()
    async clearCart(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        return this.cart_service.clearCart(store_id, user_id);
    }

    @Post('sync')
    async syncCart(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Body() dto: SyncCartDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.cart_service.syncFromLocalStorage(store_id, user_id, dto);
        return { success: true, data };
    }
}
