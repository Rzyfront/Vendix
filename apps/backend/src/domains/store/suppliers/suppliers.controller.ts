import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierQueryDto } from './dto/supplier-query.dto';
import { ResponseService } from '@common/responses/response.service';
import { UseGuards } from '@nestjs/common';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';

@Controller('store/inventory/suppliers')
@UseGuards(PermissionsGuard)
export class SuppliersController {
  constructor(
    private readonly suppliersService: SuppliersService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:suppliers:create')
  async create(@Body() createSupplierDto: CreateSupplierDto) {
    try {
      const result = await this.suppliersService.create(createSupplierDto);
      return this.responseService.created(
        result,
        'Proveedor creado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear el proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:suppliers:read')
  async findAll(@Query() query: SupplierQueryDto) {
    try {
      const result = await this.suppliersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Proveedores obtenidos exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Proveedores obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los proveedores',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('active')
  @Permissions('store:suppliers:read')
  async findActive(@Query() query: SupplierQueryDto) {
    try {
      const result = await this.suppliersService.findActive(query);
      return this.responseService.success(
        result,
        'Proveedores activos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los proveedores activos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @Permissions('store:suppliers:read')
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.suppliersService.findOne(+id);
      return this.responseService.success(
        result,
        'Proveedor obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/products')
  @Permissions('store:suppliers:read')
  async findSupplierProducts(@Param('id') id: string) {
    try {
      const result = await this.suppliersService.findSupplierProducts(+id);
      return this.responseService.success(
        result,
        'Productos del proveedor obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los productos del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:suppliers:update')
  async update(
    @Param('id') id: string,
    @Body() updateSupplierDto: UpdateSupplierDto,
  ) {
    try {
      const result = await this.suppliersService.update(+id, updateSupplierDto);
      return this.responseService.updated(
        result,
        'Proveedor actualizado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar el proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:suppliers:delete')
  async remove(@Param('id') id: string) {
    try {
      await this.suppliersService.remove(+id);
      return this.responseService.deleted('Proveedor eliminado exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
