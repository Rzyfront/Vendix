import {
    Controller,
    Get,
    Post,
    Delete,
    Body,
    Param,
    Headers,
    UseGuards,
    Request,
} from '@nestjs/common';
import { WishlistService } from './wishlist.service';
import { AddToWishlistDto } from './dto/wishlist.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/wishlist')
@UseGuards(JwtAuthGuard)
export class WishlistController {
    constructor(private readonly wishlist_service: WishlistService) { }

    @Get()
    async getWishlist(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.wishlist_service.getWishlist(store_id, user_id);
        return { success: true, data };
    }

    @Post()
    async addItem(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Body() dto: AddToWishlistDto,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.wishlist_service.addItem(store_id, user_id, dto);
        return { success: true, data };
    }

    @Delete(':productId')
    async removeItem(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Param('productId') product_id: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.wishlist_service.removeItem(
            store_id,
            user_id,
            parseInt(product_id, 10),
        );
        return { success: true, data };
    }

    @Get('check/:productId')
    async checkInWishlist(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Param('productId') product_id: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const user_id = req.user.id;
        const data = await this.wishlist_service.checkInWishlist(
            store_id,
            user_id,
            parseInt(product_id, 10),
        );
        return { success: true, data };
    }
}
