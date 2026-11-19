import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { IndustryModuleGuard } from '../../../../common/guards/industry-module.guard';
import { IndustryModule } from '../../../../common/decorators/industry-module.decorator';
import { ManufacturingPlantsService } from './manufacturing-plants.service';
import {
  CreateManufacturingPlantDto,
  ManufacturingPlantManagersQueryDto,
  ManufacturingPlantQueryDto,
  UpdateManufacturingPlantDto,
} from '../dto';

/**
 * QUI-1013 — production plants. Managed from "Configuración de planta"
 * (`settings:*`); the list is also readable with `orders:read` because the
 * order form and the production session pick a plant from it.
 */
@Controller('store/manufacturing/plants')
@UseGuards(PermissionsGuard, IndustryModuleGuard)
@IndustryModule('manufacturing_settings')
export class ManufacturingPlantsController {
  constructor(
    private readonly plantsService: ManufacturingPlantsService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:manufacturing:settings:read', 'store:manufacturing:orders:read')
  async findAll(@Query() query: ManufacturingPlantQueryDto) {
    const result = await this.plantsService.findAll(query);
    return this.responseService.success(result, 'Plantas obtenidas exitosamente');
  }

  /** Static path, declared before `:id`. */
  @Get('managers')
  @Permissions('store:manufacturing:settings:update')
  async managers(@Query() query: ManufacturingPlantManagersQueryDto) {
    const result = await this.plantsService.managers(query);
    return this.responseService.success(result, 'Responsables disponibles obtenidos');
  }

  @Get(':id')
  @Permissions('store:manufacturing:settings:read', 'store:manufacturing:orders:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.plantsService.findOne(id);
    return this.responseService.success(result, 'Planta obtenida exitosamente');
  }

  @Post()
  @Permissions('store:manufacturing:settings:update')
  async create(@Body() dto: CreateManufacturingPlantDto) {
    const result = await this.plantsService.create(dto);
    return this.responseService.created(result, 'Planta creada exitosamente');
  }

  @Patch(':id')
  @Permissions('store:manufacturing:settings:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateManufacturingPlantDto,
  ) {
    const result = await this.plantsService.update(id, dto);
    return this.responseService.updated(result, 'Planta actualizada exitosamente');
  }
}
