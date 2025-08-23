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
import { AddressesService } from './addresses.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
  UpdateGPSCoordinatesDto,
} from './dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@Controller('addresses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  @Permissions('addresses:create')
  async create(@Body() createAddressDto: CreateAddressDto, @CurrentUser() user: any) {
    return this.addressesService.create(createAddressDto, user);
  }
  @Get()
  @Permissions('addresses:read')
  async findAll(@Query() query: AddressQueryDto, @CurrentUser() user: any) {
    return this.addressesService.findAll(query, user);
  }

  @Get('customer/:customerId')
  @Permissions('addresses:read')
  async findByCustomer(
    @Param('customerId', ParseIntPipe) customerId: number,
    @Query() query: AddressQueryDto,
  ) {
    return this.addressesService.findByCustomer(customerId, query);
  }

  @Get('store/:storeId')
  @Permissions('addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Query() query: AddressQueryDto,
  ) {
    return this.addressesService.findByStore(storeId, query);
  }

  @Get('default/customer/:customerId')
  @Permissions('addresses:read')
  async getCustomerDefaultAddress(@Param('customerId', ParseIntPipe) customerId: number) {
    return this.addressesService.getDefaultAddress(customerId);
  }

  @Get('default/store/:storeId')
  @Permissions('addresses:read')
  async getStoreDefaultAddress(@Param('storeId', ParseIntPipe) storeId: number) {
    return this.addressesService.getDefaultAddress(undefined, storeId);
  }

  @Get(':id')
  @Permissions('addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_inactive') includeInactive?: string,
  ) {
    return this.addressesService.findOne(id, {
      includeInactive: includeInactive === 'true',
    });
  }

  @Patch(':id')
  @Permissions('addresses:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAddressDto: UpdateAddressDto,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.update(id, updateAddressDto, user);
  }

  @Patch(':id/gps')
  @Permissions('addresses:update')
  async updateGPS(
    @Param('id', ParseIntPipe) id: number,
    @Body() gpsData: UpdateGPSCoordinatesDto,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.updateGPSCoordinates(id, gpsData, user);
  }

  @Patch(':id/set-default')
  @Permissions('addresses:update')
  async setAsDefault(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.addressesService.setAsDefault(id, user);
  }

  @Patch(':id/activate')
  @Permissions('addresses:update')
  async activate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.addressesService.activate(id, user);
  }

  @Patch(':id/deactivate')
  @Permissions('addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivate(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.addressesService.deactivate(id, user);
  }

  @Delete(':id')
  @Permissions('addresses:admin_delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.addressesService.remove(id, user);
  }
}
