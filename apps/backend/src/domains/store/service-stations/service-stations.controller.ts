import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '@common/responses/response.service';
import {
  CreateServiceStationDto,
  CreateStationExceptionDto,
  SetStationProvidersDto,
  SetStationSchedulesDto,
  SetStationServicesDto,
  UpdateServiceStationDto,
} from './dto/station.dto';
import { ServiceStationsService } from './service-stations.service';
import { StationListQueryDto } from './dto/station-list-query.dto';

@Controller('store/service-stations')
@UseGuards(PermissionsGuard)
export class ServiceStationsController {
  constructor(
    private readonly service: ServiceStationsService,
    private readonly response: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  async findAll(@Query() query: StationListQueryDto) {
    const result = await this.service.findAll(query);
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Estaciones obtenidas',
    );
  }

  @Post()
  @Permissions('store:reservations:update')
  async create(@Body() dto: CreateServiceStationDto) {
    return this.response.created(await this.service.create(dto), 'Estación creada');
  }

  @Put(':id/services')
  @Permissions('store:reservations:update')
  async setServices(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStationServicesDto,
  ) {
    return this.response.updated(await this.service.setServices(id, dto), 'Servicios de estación actualizados');
  }

  @Put(':id/providers')
  @Permissions('store:reservations:update')
  async setProviders(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStationProvidersDto,
  ) {
    return this.response.updated(await this.service.setProviders(id, dto), 'Proveedores de estación actualizados');
  }

  @Get(':id/schedules')
  @Permissions('store:reservations:read')
  async getSchedules(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.getSchedules(id));
  }

  @Put(':id/schedules')
  @Permissions('store:reservations:update')
  async setSchedules(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetStationSchedulesDto,
  ) {
    return this.response.updated(await this.service.setSchedules(id, dto), 'Horarios de estación actualizados');
  }

  @Get(':id/exceptions')
  @Permissions('store:reservations:read')
  async getExceptions(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.getExceptions(id));
  }

  @Post(':id/exceptions')
  @Permissions('store:reservations:update')
  async createException(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateStationExceptionDto,
  ) {
    return this.response.created(await this.service.createException(id, dto), 'Excepción de estación creada');
  }

  @Delete(':id/exceptions/:exceptionId')
  @Permissions('store:reservations:update')
  async deleteException(
    @Param('id', ParseIntPipe) id: number,
    @Param('exceptionId', ParseIntPipe) exceptionId: number,
  ) {
    return this.response.success(await this.service.deleteException(id, exceptionId));
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.response.success(await this.service.findOne(id));
  }

  @Patch(':id')
  @Permissions('store:reservations:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServiceStationDto,
  ) {
    return this.response.updated(await this.service.update(id, dto), 'Estación actualizada');
  }

  @Delete(':id')
  @Permissions('store:reservations:update')
  async deactivate(@Param('id', ParseIntPipe) id: number) {
    return this.response.updated(await this.service.deactivate(id), 'Estación desactivada');
  }
}
