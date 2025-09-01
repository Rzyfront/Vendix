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
} from './dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('addresses')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AddressesController {
  constructor(private readonly addressesService: AddressesService) {}

  @Post()
  @Permissions('addresses:create')
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.create(createAddressDto, user);
  }

  @Get()
  @Permissions('addresses:read')
  async findAll(@Query() query: AddressQueryDto, @CurrentUser() user: any) {
    return this.addressesService.findAll(query, user);
  }

  @Get('store/:storeId')
  @Permissions('addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.findByStore(storeId, user);
  }

  @Get(':id')
  @Permissions('addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.findOne(id, user);
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

  @Delete(':id')
  @Permissions('addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.addressesService.remove(id, user);
  }
}