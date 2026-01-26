import {
    Controller,
    Get,
    Put,
    Post,
    Patch,
    Delete,
    Body,
    Param,
    Query,
    UseGuards,
} from '@nestjs/common';
import { AccountService } from './account.service';
import { UpdateProfileDto, ChangePasswordDto, CreateAddressDto, UpdateAddressDto } from './dto/account.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Controller('ecommerce/account')
@UseGuards(JwtAuthGuard)
export class AccountController {
    constructor(private readonly account_service: AccountService) { }

    @Get()
    async getProfile() {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.getProfile();
        return { success: true, data };
    }

    @Put()
    async updateProfile(@Body() dto: UpdateProfileDto) {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.updateProfile(dto);
        return { success: true, data };
    }

    @Post('change-password')
    async changePassword(@Body() dto: ChangePasswordDto) {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.changePassword(dto);
        return { success: true, data };
    }

    @Get('orders')
    async getOrders(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
    ) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.account_service.getOrders(
            page ? parseInt(page, 10) : 1,
            limit ? parseInt(limit, 10) : 10,
        );
        return { success: true, ...data };
    }

    @Get('orders/:id')
    async getOrderDetail(@Param('id') order_id: string) {
        // store_id y user_id se resuelven automáticamente
        const data = await this.account_service.getOrderDetail(
            parseInt(order_id, 10),
        );
        return { success: true, data };
    }

    @Get('addresses')
    async getAddresses() {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.getAddresses();
        return { success: true, data };
    }

    @Post('addresses')
    async createAddress(@Body() dto: CreateAddressDto) {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.createAddress(dto);
        return { success: true, data };
    }

    @Delete('addresses/:id')
    async deleteAddress(@Param('id') address_id: string) {
        // user_id se resuelve automáticamente desde el JWT
        const data = await this.account_service.deleteAddress(
            parseInt(address_id, 10),
        );
        return { success: true, data };
    }

    @Put('addresses/:id')
    async updateAddress(
        @Param('id') address_id: string,
        @Body() dto: UpdateAddressDto,
    ) {
        const data = await this.account_service.updateAddress(
            parseInt(address_id, 10),
            dto,
        );
        return { success: true, data };
    }

    @Patch('addresses/:id/set-primary')
    async setAddressPrimary(@Param('id') address_id: string) {
        const data = await this.account_service.setAddressPrimary(
            parseInt(address_id, 10),
        );
        return { success: true, data };
    }
}
