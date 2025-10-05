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
  Request,
} from '@nestjs/common';
import { AddressesService } from './addresses.service';
import {
  CreateAddressDto,
  UpdateAddressDto,
  AddressQueryDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ResponseService } from '../../common/responses/response.service';

@Controller('addresses')
@UseGuards(PermissionsGuard)
export class AddressesController {
  constructor(
    private readonly addressesService: AddressesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('addresses:create')
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.create(createAddressDto, user);
      return this.responseService.success(
        result,
        'Dirección creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al crear la dirección',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('addresses:read')
  async findAll(@Query() query: AddressQueryDto, @CurrentUser() user: any, @Request() req) {
    try {
      const result = await this.addressesService.findAll(query, user);
      return this.responseService.success(
        result,
        'Direcciones obtenidas exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las direcciones',
        error.message,
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.findByStore(storeId, user);
      return this.responseService.success(
        result,
        'Direcciones obtenidas exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las direcciones',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.findOne(id, user);
      return this.responseService.success(
        result,
        'Dirección obtenida exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener la dirección',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('addresses:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAddressDto: UpdateAddressDto,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.update(id, updateAddressDto, user);
      return this.responseService.success(
        result,
        'Dirección actualizada exitosamente',
        req.url,
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar la dirección',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
    @Request() req,
  ) {
    try {
      const result = await this.addressesService.remove(id, user);
      return this.responseService.success(
        null,
        'Dirección eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar la dirección',
        error.message,
      );
    }
  }
}