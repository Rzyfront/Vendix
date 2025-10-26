import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '../../common/responses/response.service';
import { StoresService } from './stores.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  StoreQueryDto,
  UpdateStoreSettingsDto,
  StoreDashboardDto,
} from './dto';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Permissions } from '../auth/decorators/permissions.decorator';

@Controller('stores')
@UseGuards(PermissionsGuard)
export class StoresController {
  constructor(
    private readonly storesService: StoresService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('stores:create')
  async create(@Body() createStoreDto: CreateStoreDto) {
    try {
      const store = await this.storesService.create(createStoreDto);
      return this.responseService.created(store, 'Tienda creada exitosamente');
    } catch (error) {
      if (error.code === 'P2002') {
        return this.responseService.conflict(
          'La tienda ya existe en esta organización',
          error.meta?.target || 'Duplicate entry',
        );
      }
      if (error.message.includes('Organization not found')) {
        return this.responseService.notFound(
          'Organización no encontrada',
          'Organization',
        );
      }
      return this.responseService.error(
        'Error al crear la tienda',
        error.message,
      );
    }
  }

  @Get()
  @Permissions('stores:read')
  async findAll(@Query() query: StoreQueryDto) {
    try {
      const result = await this.storesService.findAll(query);
      return this.responseService.paginated(
        result.data,
        result.meta.total,
        result.meta.page,
        result.meta.limit,
        'Tiendas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las tiendas',
        error.message,
      );
    }
  }

  @Get('stats')
  @Permissions('stores:read')
  async getStats() {
    try {
      const result = await this.storesService.getGlobalDashboard();
      return this.responseService.success(
        result,
        'Estadísticas de tiendas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las estadísticas de tiendas',
        error.message,
      );
    }
  }

  @Get(':id')
  @Permissions('stores:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    try {
      const store = await this.storesService.findOne(id);
      return this.responseService.success(
        store,
        'Tienda obtenida exitosamente',
      );
    } catch (error) {
      if (error.message.includes('Store not found')) {
        return this.responseService.notFound('Tienda no encontrada', 'Store');
      }
      return this.responseService.error(
        'Error al obtener la tienda',
        error.message,
      );
    }
  }

  @Patch(':id')
  @Permissions('stores:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    try {
      const store = await this.storesService.update(id, updateStoreDto);
      return this.responseService.updated(
        store,
        'Tienda actualizada exitosamente',
      );
    } catch (error) {
      if (error.message.includes('Store not found')) {
        return this.responseService.notFound('Tienda no encontrada', 'Store');
      }
      return this.responseService.error(
        'Error al actualizar la tienda',
        error.message,
      );
    }
  }

  @Delete(':id')
  @Permissions('stores:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.storesService.remove(id);
      return this.responseService.deleted('Tienda eliminada exitosamente');
    } catch (error) {
      if (error.message.includes('Store not found')) {
        return this.responseService.notFound('Tienda no encontrada', 'Store');
      }
      if (error.message.includes('Cannot delete store with active orders')) {
        return this.responseService.conflict(
          'No se puede eliminar la tienda porque tiene órdenes activas',
          error.message,
        );
      }
      return this.responseService.error(
        'Error al eliminar la tienda',
        error.message,
      );
    }
  }

  @Patch(':id/settings')
  @Permissions('stores:update')
  async updateSettings(
    @Param('id', ParseIntPipe) storeId: number,
    @Body() settingsDto: UpdateStoreSettingsDto,
  ) {
    try {
      const settings = await this.storesService.updateStoreSettings(
        storeId,
        settingsDto,
      );
      return this.responseService.updated(
        settings,
        'Configuración de tienda actualizada exitosamente',
      );
    } catch (error) {
      if (error.message.includes('Store not found')) {
        return this.responseService.notFound('Tienda no encontrada', 'Store');
      }
      return this.responseService.error(
        'Error al actualizar la configuración de la tienda',
        error.message,
      );
    }
  }

  @Get(':id/stats')
  @Permissions('stores:read')
  async getStoreStats(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: StoreDashboardDto,
  ) {
    try {
      const result = await this.storesService.getDashboard(id, query);
      return this.responseService.success(
        result,
        'Estadísticas de tienda obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        'Error al obtener las estadísticas de tienda',
        error.message,
      );
    }
  }
}
