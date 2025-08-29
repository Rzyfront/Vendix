import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  ParseIntPipe,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto, UpdateCustomerDto, CustomerQueryDto } from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Post()
  @Permissions('customers:create')
  async create(
    @Body() createCustomerDto: CreateCustomerDto,
    @CurrentUser() user: any,
  ) {
    return this.customersService.create(createCustomerDto, user);
  }
  @Get()
  @Permissions('customers:read')
  async findAll(@Query() query: CustomerQueryDto, @CurrentUser() user: any) {
    return this.customersService.findAll(query, user);
  }

  @Get('store/:storeId')
  @Permissions('customers:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: CustomerQueryDto,
  ) {
    return this.customersService.findByStore(storeId, query);
  }

  @Get('email/:email/store/:storeId')
  @Permissions('customers:read')
  async findByEmail(
    @Param('email') email: string,
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.customersService.findByEmail(email, storeId, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Get(':id')
  @Permissions('customers:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.customersService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @Permissions('customers:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @CurrentUser() user: any,
  ) {
    return this.customersService.update(id, updateCustomerDto, user);
  }

  @Patch(':id/activate')
  @Permissions('customers:update')
  async activate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.customersService.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Permissions('customers:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.customersService.deactivate(id, user);
  }

  @Patch(':id/block')
  @Permissions('customers:update')
  async block(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.customersService.block(id, user);
  }

  @Patch(':id/verify')
  @Permissions('customers:update')
  async verify(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.customersService.verify(id, user);
  }

  @Delete(':id')
  @Permissions('customers:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.customersService.remove(id, user);
  }
}
