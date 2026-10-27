import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UnitTypesService } from './unit-types.service';
import { CreateUnitTypeDto, UpdateUnitTypeDto } from './dto';

/**
 * Hospitality Suite (H0.2) — room types of a hotel store. Handlers do not
 * catch: VendixHttpException reaches the global filter with its real status.
 */
@Controller('store/hospitality/unit-types')
@UseGuards(PermissionsGuard)
export class UnitTypesController {
  constructor(
    private readonly unitTypesService: UnitTypesService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar los tipos de habitación del hotel' })
  @Get()
  @Permissions('store:lodging:inventory:read')
  async findAll() {
    const result = await this.unitTypesService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Obtener un tipo de habitación' })
  @Get(':id')
  @Permissions('store:lodging:inventory:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.unitTypesService.findOne(id);
    return this.responseService.success(result);
  }

  @ApiOperation({
    summary:
      'Crear un tipo de habitación con capacidad, camas y precio base; crea su servicio "Noche – {tipo}"',
  })
  @Post()
  @Permissions('store:lodging:inventory:write')
  async create(@Body() dto: CreateUnitTypeDto) {
    const result = await this.unitTypesService.create(dto);
    return this.responseService.created(
      result,
      'Tipo de habitación creado exitosamente',
    );
  }

  @ApiOperation({ summary: 'Editar un tipo de habitación' })
  @Patch(':id')
  @Permissions('store:lodging:inventory:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUnitTypeDto,
  ) {
    const result = await this.unitTypesService.update(id, dto);
    return this.responseService.updated(
      result,
      'Tipo de habitación actualizado exitosamente',
    );
  }
}
