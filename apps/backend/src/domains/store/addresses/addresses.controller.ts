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
import { CreateAddressDto, UpdateAddressDto, AddressQueryDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/addresses')
@UseGuards(PermissionsGuard)
export class AddressesController {
  constructor(
    private readonly addressesService: AddressesService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:addresses:create')
  async create(
    @Body() createAddressDto: CreateAddressDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.addressesService.create(
        createAddressDto,
        req.user,
      );
      return this.responseService.created(
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
  @Permissions('store:addresses:read')
  async findAll(
    @Query() query: AddressQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.addressesService.findAll(query, req.user);

      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Direcciones obtenidas exitosamente',
        );
      } else {
        return this.responseService.success(
          result,
          'Direcciones obtenidas exitosamente',
        );
      }
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las direcciones',
        error.message,
      );
    }
  }

  @Get('store/:storeId')
  @Permissions('store:addresses:read')
  async findByStore(
    @Param('storeId', ParseIntPipe) storeId: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.addressesService.findByStore(storeId, req.user);

      return this.responseService.success(
        result,
        'Direcciones de la tienda obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las direcciones',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('store:addresses:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.addressesService.findOne(id, req.user);
      return this.responseService.success(
        result,
        'Dirección obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener la dirección',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:addresses:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateAddressDto: UpdateAddressDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.addressesService.update(
        id,
        updateAddressDto,
        req.user,
      );
      return this.responseService.updated(
        result,
        'Dirección actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al actualizar la dirección',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:addresses:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      await this.addressesService.remove(id, req.user);
      return this.responseService.deleted('Dirección eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        'Error al eliminar la dirección',
        error.message,
      );
    }
  }
}
