import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
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
import { AuthenticatedRequest } from '@common/interfaces/authenticated-request.interface';
import { ResponseService } from '@common/responses/response.service';

/**
 * Sin try/catch por handler a propósito: `responseService.error()` RETORNA el
 * sobre en lugar de lanzarlo, así que un fallo salía con HTTP 200 y
 * `success: false`. La excepción tiene que llegar a `AllExceptionsFilter` para
 * que el status y el código tipado sean los reales.
 */
@Controller('store/inventory/locations')
@UseGuards(PermissionsGuard)
export class LocationsController {
  constructor(
    private readonly locationsService: LocationsService,
    private readonly responseService: ResponseService,
  ) {}

  @Post()
  @Permissions('store:inventory:locations:create')
  async create(
    @Body() createLocationDto: CreateLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.locationsService.create(createLocationDto);
    return this.responseService.created(
      result,
      'Ubicación creada exitosamente',
    );
  }

  @Get()
  @Permissions('store:inventory:locations:read')
  async findAll(
    @Query() query: LocationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
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
  }

  @Get(':id')
  @Permissions('store:inventory:locations:read')
  async findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    const result = await this.locationsService.findOne(+id);
    return this.responseService.success(
      result,
      'Ubicación obtenida exitosamente',
    );
  }

  @Patch(':id/set-default')
  @Permissions('store:inventory:set-default-location')
  async setAsDefault(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.locationsService.setAsDefault(+id);
    return this.responseService.updated(
      result,
      'Ubicación principal actualizada exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:inventory:locations:update')
  async update(
    @Param('id') id: string,
    @Body() updateLocationDto: UpdateLocationDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.locationsService.update(+id, updateLocationDto);
    return this.responseService.updated(
      result,
      'Ubicación actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:inventory:locations:delete')
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    await this.locationsService.remove(+id);
    return this.responseService.deleted('Ubicación eliminada exitosamente');
  }
}
