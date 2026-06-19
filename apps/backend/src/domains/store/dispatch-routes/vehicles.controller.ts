import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseIntPipe,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';

@Controller('store/vehicles')
@UseGuards(PermissionsGuard)
export class VehiclesController {
  constructor(
    private readonly vehiclesService: VehiclesService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:dispatch_fleet:read')
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('is_active') is_active?: string,
  ) {
    const result = await this.vehiclesService.findAll({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 10,
      search,
      is_active: is_active === undefined ? undefined : is_active === 'true',
    });
    return this.responseService.success(result, 'Vehículos obtenidos');
  }

  @Get(':id')
  @Permissions('store:dispatch_fleet:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.vehiclesService.findOne(id);
    return this.responseService.success(result, 'Vehículo obtenido');
  }

  @Post()
  @Permissions('store:dispatch_fleet:create')
  async create(@Body() dto: CreateVehicleDto) {
    const result = await this.vehiclesService.create(dto);
    return this.responseService.created(result, 'Vehículo creado');
  }

  @Patch(':id')
  @Permissions('store:dispatch_fleet:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateVehicleDto>,
  ) {
    const result = await this.vehiclesService.update(id, dto);
    return this.responseService.success(result, 'Vehículo actualizado');
  }

  @Delete(':id')
  @Permissions('store:dispatch_fleet:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.vehiclesService.remove(id);
    return this.responseService.success(result, 'Vehículo eliminado');
  }
}
