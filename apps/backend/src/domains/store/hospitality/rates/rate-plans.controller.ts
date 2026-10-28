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
import { LodgingRatePlansService } from './rate-plans.service';
import { CreateRatePlanDto, UpdateRatePlanDto } from './dto';

/** Hospitality Suite (H2.1) — rate plans and their nightly prices. */
@Controller('store/hospitality/rate-plans')
@UseGuards(PermissionsGuard)
export class LodgingRatePlansController {
  constructor(
    private readonly ratePlansService: LodgingRatePlansService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar los planes tarifarios con sus precios' })
  @Get()
  @Permissions('store:lodging:rates:read')
  async findAll() {
    const result = await this.ratePlansService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Obtener un plan tarifario' })
  @Get(':id')
  @Permissions('store:lodging:rates:read')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.ratePlansService.findOne(id);
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear un plan tarifario con precios por tipo y día de semana' })
  @Post()
  @Permissions('store:lodging:rates:write')
  async create(@Body() dto: CreateRatePlanDto) {
    const result = await this.ratePlansService.create(dto);
    return this.responseService.created(result, 'Plan tarifario creado exitosamente');
  }

  @ApiOperation({ summary: 'Editar un plan tarifario; los precios enviados reemplazan los anteriores' })
  @Patch(':id')
  @Permissions('store:lodging:rates:write')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateRatePlanDto) {
    const result = await this.ratePlansService.update(id, dto);
    return this.responseService.updated(result, 'Plan tarifario actualizado exitosamente');
  }
}
