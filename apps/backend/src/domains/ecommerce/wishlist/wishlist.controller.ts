import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    UseGuards,
} from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto } from './dto/wishlist.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
    constructor(private readonly wishlist_service: WishlistService) { }

    @Get()
    async getWishlist() {
        // store_id y user_id se resuelven automáticamente desde el dominio y el JWT
        const data = await this.wishlist_service.getWishlist();
        return { success: true, data };
    }

    @Post()
    async addItem(@Body() dto: AddToWishlistDto) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.wishlist_service.addItem(dto);
        return { success: true, data };
    }

    @Delete(':productId')
    async removeItem(@Param('productId') product_id: string) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.wishlist_service.removeItem(parseInt(product_id, 10));
        return { success: true, data };
    }

    @Get('check/:productId')
    async checkInWishlist(@Param('productId') product_id: string) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.wishlist_service.checkInWishlist(parseInt(product_id, 10));
        return { success: true, data };
    }
}
