import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Put,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { ProviderScheduleService } from './provider-schedule.service';
import { CreateProviderDto } from './dto/create-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
import { UpsertProviderScheduleDto } from './dto/upsert-provider-schedule.dto';
import { CreateProviderExceptionDto } from './dto/create-provider-exception.dto';
import { AssignServiceDto } from './dto/assign-service.dto';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/reservations/providers')
@UseGuards(PermissionsGuard)
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly providerScheduleService: ProviderScheduleService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:reservations:read')
  async findAll() {
    const result = await this.providersService.findAll();
    return this.responseService.success(result, 'Proveedores obtenidos exitosamente');
  }

  @Get('available-employees')
  @Permissions('store:reservations:read')
  async getAvailableEmployees() {
    const result = await this.providersService.getAvailableEmployees();
    return this.responseService.success(result, 'Empleados disponibles obtenidos exitosamente');
  }

  @Get('for-service/:productId')
  @Permissions('store:reservations:read')
  async getProvidersForService(@Param('productId', ParseIntPipe) productId: number) {
    const result = await this.providersService.getProvidersForService(productId);
    return this.responseService.success(result, 'Proveedores del servicio obtenidos exitosamente');
  }

  @Get(':id')
  @Permissions('store:reservations:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.providersService.findOne(id);
    return this.responseService.success(result, 'Proveedor obtenido exitosamente');
  }

  @Post()
  @Permissions('store:reservations:update')
  async create(@Body() dto: CreateProviderDto) {
    const result = await this.providersService.create(dto);
    return this.responseService.created(result, 'Proveedor creado exitosamente');
  }

  @Patch(':id')
  @Permissions('store:reservations:update')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProviderDto) {
    const result = await this.providersService.update(id, dto);
    return this.responseService.success(result, 'Proveedor actualizado exitosamente');
  }

  // --- Services ---

  @Post(':id/services')
  @Permissions('store:reservations:update')
  async assignService(@Param('id', ParseIntPipe) id: number, @Body() dto: AssignServiceDto) {
    const result = await this.providersService.assignService(id, dto.product_id);
    return this.responseService.created(result, 'Servicio asignado exitosamente');
  }

  @Delete(':id/services/:productId')
  @Permissions('store:reservations:update')
  async removeService(
    @Param('id', ParseIntPipe) id: number,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    await this.providersService.removeService(id, productId);
    return this.responseService.success(null, 'Servicio removido exitosamente');
  }

  // --- Schedules ---

  @Get(':id/schedules')
  @Permissions('store:reservations:read')
  async getSchedule(@Param('id', ParseIntPipe) id: number) {
    const result = await this.providerScheduleService.getSchedule(id);
    return this.responseService.success(result, 'Horario obtenido exitosamente');
  }

  @Put(':id/schedules')
  @Permissions('store:reservations:update')
  async upsertSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpsertProviderScheduleDto,
  ) {
    const result = await this.providerScheduleService.upsertSchedule(id, dto.items);
    return this.responseService.success(result, 'Horario guardado exitosamente');
  }

  // --- Exceptions ---

  @Get(':id/exceptions')
  @Permissions('store:reservations:read')
  async getExceptions(
    @Param('id', ParseIntPipe) id: number,
    @Query('date_from') dateFrom?: string,
    @Query('date_to') dateTo?: string,
  ) {
    const result = await this.providerScheduleService.getExceptions(id, dateFrom, dateTo);
    return this.responseService.success(result, 'Excepciones obtenidas exitosamente');
  }

  @Post(':id/exceptions')
  @Permissions('store:reservations:update')
  async createException(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateProviderExceptionDto,
  ) {
    const result = await this.providerScheduleService.createException(id, dto);
    return this.responseService.created(result, 'Excepcion creada exitosamente');
  }

  @Delete(':id/exceptions/:exId')
  @Permissions('store:reservations:update')
  async deleteException(@Param('exId', ParseIntPipe) exId: number) {
    await this.providerScheduleService.deleteException(exId);
    return this.responseService.success(null, 'Excepcion eliminada exitosamente');
  }
}
