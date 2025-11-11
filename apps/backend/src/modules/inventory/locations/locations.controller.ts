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
import { LocationsService } from './locations.service';
import { CreateLocationDto } from './dto/create-location.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationQueryDto } from './dto/location-query.dto';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest } from '../../../common/interfaces/authenticated-request.interface';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('inventory/locations')
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  async create(
    @Body() createLocationDto: CreateLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.locationsService.create(createLocationDto);
      return this.responseService.created(
        result,
        'Ubicación creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  async findAll(
    @Query() query: LocationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.locationsService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Ubicaciones obtenidas exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Ubicaciones obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las ubicaciones',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    try {
      const result = await this.locationsService.findOne(+id);
      return this.responseService.success(
        result,
        'Ubicación obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    try {
      const result = await this.locationsService.update(+id, updateLocationDto);
      return this.responseService.updated(
        result,
        'Ubicación actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    try {
      await this.locationsService.remove(+id);
      return this.responseService.deleted('Ubicación eliminada exitosamente');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la ubicación',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }
}
