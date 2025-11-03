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
} from '@nestjs/common';
import { AdminStoresService } from './admin-stores.service';
import {
  CreateStoreDto,
  UpdateStoreDto,
  AdminStoreQueryDto,
} from '../stores/dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '../auth/enums/user-role.enum';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ResponseService } from '../../common/responses/response.service';

@ApiTags('Admin Stores')
@Controller('admin/stores')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminStoresController {
  constructor(
    private readonly adminStoresService: AdminStoresService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new store' })
  @ApiResponse({ status: 201, description: 'Store created successfully' })
  async create(@Body() createStoreDto: CreateStoreDto) {
    try {
      const result = await this.adminStoresService.create(createStoreDto);
      return this.responseService.created(result, 'Tienda creada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la tienda',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all stores with pagination and filtering' })
  @ApiResponse({ status: 200, description: 'Stores retrieved successfully' })
  async findAll(@Query() query: AdminStoreQueryDto) {
    try {
      const result = await this.adminStoresService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Tiendas obtenidas exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Tiendas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las tiendas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('dashboard')
  @ApiOperation({ summary: 'Get dashboard statistics for stores' })
  @ApiResponse({
    status: 200,
    description: 'Dashboard statistics retrieved successfully',
  })
  async getDashboardStats() {
    try {
      const result = await this.adminStoresService.getDashboardStats();
      return this.responseService.success(
        result,
        'Estadísticas del dashboard obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las estadísticas del dashboard',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a store by ID' })
  @ApiResponse({ status: 200, description: 'Store retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.adminStoresService.findOne(+id);
      return this.responseService.success(
        result,
        'Tienda obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la tienda',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a store' })
  @ApiResponse({ status: 200, description: 'Store updated successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  async update(
    @Param('id') id: string,
    @Body() updateStoreDto: UpdateStoreDto,
  ) {
    try {
      const result = await this.adminStoresService.update(+id, updateStoreDto);
      return this.responseService.updated(
        result,
        'Tienda actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la tienda',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a store' })
  @ApiResponse({ status: 200, description: 'Store deleted successfully' })
  @ApiResponse({ status: 404, description: 'Store not found' })
  @ApiResponse({
    status: 409,
    description: 'Cannot delete store with existing data',
  })
  async remove(@Param('id') id: string) {
    try {
      await this.adminStoresService.remove(+id);
      return this.responseService.deleted('Tienda eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la tienda',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
