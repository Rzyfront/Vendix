import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';

import { StoreShippingZonesService } from '../services/store-shipping-zones.service';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  CreateZoneDto,
  UpdateZoneDto,
  CreateRateDto,
  UpdateRateDto,
} from '../dto/store-shipping-zones.dto';

@ApiTags('Store Shipping Zones')
@Controller('store/shipping-zones')
@ApiBearerAuth()
export class StoreShippingZonesController {
  constructor(
    private readonly service: StoreShippingZonesService,
    private readonly responseService: ResponseService,
  ) {}

  // ========== ZONAS DEL SISTEMA (Solo lectura) ==========

  @Get('system')
  @ApiOperation({ summary: 'List system shipping zones (read-only reference)' })
  @ApiResponse({
    status: 200,
    description: 'System zones retrieved successfully',
  })
  async getSystemZones() {
    try {
      const data = await this.service.getSystemZones();
      return this.responseService.success(
        data,
        'Zonas del sistema obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener zonas del sistema',
        error,
      );
    }
  }

  @Get('system/:zoneId/rates')
  @ApiOperation({ summary: 'View rates for a system zone (read-only)' })
  @ApiParam({ name: 'zoneId', description: 'System zone ID' })
  @ApiResponse({
    status: 200,
    description: 'System zone rates retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'System zone not found' })
  async getSystemZoneRates(@Param('zoneId', ParseIntPipe) zoneId: number) {
    try {
      const data = await this.service.getSystemZoneRates(zoneId);
      return this.responseService.success(
        data,
        'Tarifas del sistema obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener tarifas del sistema',
        error,
      );
    }
  }

  @Post('system/:zoneId/duplicate')
  @ApiOperation({
    summary: 'Duplicate a system zone to create an editable copy',
    description:
      'Creates a copy of a system zone with all its rates. The copy will be fully editable.',
  })
  @ApiParam({ name: 'zoneId', description: 'System zone ID to duplicate' })
  @ApiResponse({
    status: 201,
    description: 'Zone duplicated successfully',
  })
  @ApiResponse({ status: 404, description: 'System zone not found' })
  async duplicateSystemZone(@Param('zoneId', ParseIntPipe) zoneId: number) {
    try {
      const data = await this.service.duplicateSystemZone(zoneId);
      return this.responseService.created(
        data,
        'Zona duplicada correctamente. Ahora puedes editarla.',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al duplicar zona',
        error,
      );
    }
  }

  @Post('system/rates/:rateId/duplicate')
  @ApiOperation({
    summary: 'Duplicate a system rate to a store zone',
    description: 'Copies a specific rate from a system zone to a store zone.',
  })
  @ApiParam({ name: 'rateId', description: 'System rate ID to duplicate' })
  @ApiResponse({
    status: 201,
    description: 'Rate duplicated successfully',
  })
  @ApiResponse({ status: 404, description: 'Rate or target zone not found' })
  async duplicateSystemRate(
    @Param('rateId', ParseIntPipe) rateId: number,
    @Body() body: { target_zone_id: number },
  ) {
    try {
      const data = await this.service.duplicateSystemRate(
        rateId,
        body.target_zone_id,
      );
      return this.responseService.created(
        data,
        'Tarifa duplicada correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al duplicar tarifa',
        error,
      );
    }
  }

  // ========== ESTADÍSTICAS ==========

  @Get('stats')
  @ApiOperation({ summary: 'Get zones and rates statistics' })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getStats() {
    try {
      const data = await this.service.getStats();
      return this.responseService.success(
        data,
        'Estadísticas obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener estadísticas',
        error,
      );
    }
  }

  // ========== MÉTODOS DE ENVÍO DISPONIBLES ==========

  @Get('shipping-methods')
  @ApiOperation({ summary: 'Get available shipping methods for creating rates' })
  @ApiResponse({
    status: 200,
    description: 'Shipping methods retrieved successfully',
  })
  async getAvailableShippingMethods() {
    try {
      const data = await this.service.getAvailableShippingMethods();
      return this.responseService.success(
        data,
        'Métodos de envío obtenidos correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener métodos de envío',
        error,
      );
    }
  }

  // ========== ZONAS DE TIENDA (CRUD) ==========

  @Get()
  @ApiOperation({ summary: 'List store shipping zones' })
  @ApiResponse({
    status: 200,
    description: 'Store zones retrieved successfully',
  })
  async getStoreZones() {
    try {
      const data = await this.service.getStoreZones();
      return this.responseService.success(
        data,
        'Zonas de tienda obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener zonas de tienda',
        error,
      );
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create a shipping zone for the store' })
  @ApiResponse({
    status: 201,
    description: 'Zone created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  async createZone(@Body() dto: CreateZoneDto) {
    try {
      const data = await this.service.createStoreZone(dto);
      return this.responseService.created(data, 'Zona creada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear zona',
        error,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a store shipping zone' })
  @ApiParam({ name: 'id', description: 'Zone ID' })
  @ApiResponse({
    status: 200,
    description: 'Zone updated successfully',
  })
  @ApiResponse({ status: 403, description: 'Cannot edit system zones' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  async updateZone(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateZoneDto,
  ) {
    try {
      const data = await this.service.updateStoreZone(id, dto);
      return this.responseService.updated(data, 'Zona actualizada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar zona',
        error,
      );
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a store shipping zone' })
  @ApiParam({ name: 'id', description: 'Zone ID' })
  @ApiResponse({
    status: 200,
    description: 'Zone deleted successfully',
  })
  @ApiResponse({ status: 403, description: 'Cannot delete system zones' })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  async deleteZone(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.service.deleteStoreZone(id);
      return this.responseService.deleted('Zona eliminada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar zona',
        error,
      );
    }
  }

  // ========== SINCRONIZACIÓN CON SISTEMA ==========

  @Get(':id/updates')
  @ApiOperation({
    summary: 'Get pending updates from system zone',
    description:
      'Shows changes made to the source system zone since this copy was last updated.',
  })
  @ApiParam({ name: 'id', description: 'Store zone ID (must be a system_copy)' })
  @ApiResponse({
    status: 200,
    description: 'Updates retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Zone not found or not a system copy' })
  async getSystemZoneUpdates(@Param('id', ParseIntPipe) id: number) {
    try {
      const data = await this.service.getSystemZoneUpdates(id);
      return this.responseService.success(
        data,
        'Actualizaciones obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener actualizaciones',
        error,
      );
    }
  }

  @Post(':id/sync')
  @ApiOperation({
    summary: 'Sync store zone with system zone',
    description:
      'Updates the store zone with the latest data from its source system zone.',
  })
  @ApiParam({ name: 'id', description: 'Store zone ID (must be a system_copy)' })
  @ApiResponse({
    status: 200,
    description: 'Zone synchronized successfully',
  })
  @ApiResponse({ status: 404, description: 'Zone not found or not a system copy' })
  async syncWithSystem(@Param('id', ParseIntPipe) id: number) {
    try {
      const data = await this.service.syncWithSystem(id);
      return this.responseService.success(
        data,
        'Zona sincronizada correctamente con el sistema',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al sincronizar zona',
        error,
      );
    }
  }

  // ========== TARIFAS DE ZONAS DE TIENDA (CRUD) ==========

  @Get(':zoneId/rates')
  @ApiOperation({ summary: 'List rates for a store zone' })
  @ApiParam({ name: 'zoneId', description: 'Zone ID' })
  @ApiResponse({
    status: 200,
    description: 'Rates retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Zone not found' })
  async getStoreZoneRates(@Param('zoneId', ParseIntPipe) zoneId: number) {
    try {
      const data = await this.service.getStoreZoneRates(zoneId);
      return this.responseService.success(
        data,
        'Tarifas obtenidas correctamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener tarifas',
        error,
      );
    }
  }

  @Post('rates')
  @ApiOperation({ summary: 'Create a rate in a store zone' })
  @ApiResponse({
    status: 201,
    description: 'Rate created successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 404, description: 'Zone or method not found' })
  async createRate(@Body() dto: CreateRateDto) {
    try {
      const data = await this.service.createStoreRate(dto);
      return this.responseService.created(data, 'Tarifa creada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear tarifa',
        error,
      );
    }
  }

  @Patch('rates/:id')
  @ApiOperation({ summary: 'Update a store rate' })
  @ApiParam({ name: 'id', description: 'Rate ID' })
  @ApiResponse({
    status: 200,
    description: 'Rate updated successfully',
  })
  @ApiResponse({ status: 403, description: 'Cannot edit system rates' })
  @ApiResponse({ status: 404, description: 'Rate not found' })
  async updateRate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRateDto,
  ) {
    try {
      const data = await this.service.updateStoreRate(id, dto);
      return this.responseService.updated(data, 'Tarifa actualizada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar tarifa',
        error,
      );
    }
  }

  @Delete('rates/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a store rate' })
  @ApiParam({ name: 'id', description: 'Rate ID' })
  @ApiResponse({
    status: 200,
    description: 'Rate deleted successfully',
  })
  @ApiResponse({ status: 403, description: 'Cannot delete system rates' })
  @ApiResponse({ status: 404, description: 'Rate not found' })
  async deleteRate(@Param('id', ParseIntPipe) id: number) {
    try {
      await this.service.deleteStoreRate(id);
      return this.responseService.deleted('Tarifa eliminada correctamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar tarifa',
        error,
      );
    }
  }
}
