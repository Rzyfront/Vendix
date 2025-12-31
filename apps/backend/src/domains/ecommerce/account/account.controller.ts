import {
    Controller,
    Get,
    Put,
    Post,
    Delete,
    Body,
    Param,
    Query,
    Headers,
    UseGuards,
    Request,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { UpdateProfileDto, ChangePasswordDto, CreateAddressDto } from './dto/account.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/account')
@UseGuards(JwtAuthGuard)
export class AccountController {
    constructor(private readonly account_service: AccountService) { }

    @Get()
    async getProfile(@Request() req: any) {
        const data = await this.account_service.getProfile(req.user.id);
        return { success: true, data };
    }

    @Put()
    async updateProfile(@Request() req: any, @Body() dto: UpdateProfileDto) {
        const data = await this.account_service.updateProfile(req.user.id, dto);
        return { success: true, data };
    }

    @Post('change-password')
    async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
        const data = await this.account_service.changePassword(req.user.id, dto);
        return { success: true, data };
    }

    @Get('orders')
    async getOrders(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const data = await this.account_service.getOrders(
            store_id,
            req.user.id,
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 10,
        );
        return { success: true, ...data };
    }

    @Get('orders/:id')
    async getOrderDetail(
        @Headers('x-store-id') store_id_header: string,
        @Request() req: any,
        @Param('id') order_id: string,
    ) {
        const store_id = parseInt(store_id_header, 10);
        const data = await this.account_service.getOrderDetail(
            store_id,
            req.user.id,
            parseInt(order_id, 10),
        );
        return { success: true, data };
    }

    @Get('addresses')
    async getAddresses(@Request() req: any) {
        const data = await this.account_service.getAddresses(req.user.id);
        return { success: true, data };
    }

    @Post('addresses')
    async createAddress(@Request() req: any, @Body() dto: CreateAddressDto) {
        const data = await this.account_service.createAddress(req.user.id, dto);
        return { success: true, data };
    }

    @Delete('addresses/:id')
    async deleteAddress(@Request() req: any, @Param('id') address_id: string) {
        const data = await this.account_service.deleteAddress(
            req.user.id,
            parseInt(address_id, 10),
        );
        return { success: true, data };
    }
}
