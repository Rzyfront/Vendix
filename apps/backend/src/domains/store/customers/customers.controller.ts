import {
    Controller,
    Get,
    Post,
    Body,
    Patch,
    Param,
    Delete,
    UseGuards,
    Req,
    ParseIntPipe,
    Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@Controller('store/customers')
@UseGuards(RolesGuard, PermissionsGuard)
export class CustomersController {
    constructor(private readonly customersService: CustomersService) { }

    @Post()
    @Permissions('store:customers:create')
    create(@Req() req: AuthenticatedRequest, @Body() createCustomerDto: CreateCustomerDto) {
        if (!req.user.store_id) throw new Error('Store context required');
        return this.customersService.create(req.user.store_id, createCustomerDto);
    }

    @Get()
    @Permissions('store:customers:read')
    findAll(
        @Req() req: AuthenticatedRequest,
        @Query('search') search?: string,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        if (!req.user.store_id) throw new Error('Store context required');
        return this.customersService.findAll(req.user.store_id, { search, page, limit });
    }

    @Get(':id')
    @Permissions('store:customers:read')
    findOne(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
        if (!req.user.store_id) throw new Error('Store context required');
        return this.customersService.findOne(req.user.store_id, id);
    }

    @Patch(':id')
    @Permissions('store:customers:update')
    update(
        @Req() req: AuthenticatedRequest,
        @Param('id', ParseIntPipe) id: number,
        @Body() updateCustomerDto: UpdateCustomerDto,
    ) {
        if (!req.user.store_id) throw new Error('Store context required');
        return this.customersService.update(req.user.store_id, id, updateCustomerDto);
    }

    @Delete(':id')
    @Permissions('store:customers:delete')
    remove(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
        if (!req.user.store_id) throw new Error('Store context required');
        return this.customersService.remove(req.user.store_id, id);
    }
}
