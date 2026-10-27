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
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UnitsService } from './units.service';
import { CreateUnitDto, CreateUnitsBulkDto, UpdateUnitDto } from './dto';

/**
 * Hospitality Suite (H0.3) — physical rooms of a hotel store. Shares the
 * room-inventory permissions with room types.
 */
@Controller('store/hospitality/units')
@UseGuards(PermissionsGuard)
export class UnitsController {
  constructor(
    private readonly unitsService: UnitsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar las habitaciones del hotel' })
  @Get()
  @Permissions('store:lodging:inventory:read')
  async findAll(@Query('unit_type_id') unitTypeId?: string) {
    const parsed = unitTypeId ? Number(unitTypeId) : undefined;
    const result = await this.unitsService.findAll(
      Number.isInteger(parsed) ? parsed : undefined,
    );
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Obtener una habitación' })
  @Get(':id')
  @Permissions('store:lodging:inventory:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.unitsService.findOne(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear una habitación' })
  @Post()
  @Permissions('store:lodging:inventory:write')
  async create(@Body() dto: CreateUnitDto) {
    const result = await this.unitsService.create(dto);
    return this.responseService.created(result, 'Habitación creada exitosamente');
  }

  @ApiOperation({ summary: 'Crear varias habitaciones del mismo tipo (máximo 100)' })
  @Post('bulk')
  @Permissions('store:lodging:inventory:write')
  async createBulk(@Body() dto: CreateUnitsBulkDto) {
    const result = await this.unitsService.createBulk(dto);
    return this.responseService.created(
      result,
      `${result.length} habitaciones creadas exitosamente`,
    );
  }

  @ApiOperation({ summary: 'Editar o desactivar una habitación' })
  @Patch(':id')
  @Permissions('store:lodging:inventory:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUnitDto,
  ) {
    const result = await this.unitsService.update(id, dto);
    return this.responseService.updated(result, 'Habitación actualizada exitosamente');
  }
}
