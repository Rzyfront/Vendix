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
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingAllotmentsService } from './allotments.service';
import { CreateAllotmentDto, UpdateAllotmentDto } from './allotment.dto';

/** Hospitality Suite (H2.5) — allotments for agencies and companies (Tarifas → Cupos). */
@Controller('store/hospitality/allotments')
@UseGuards(PermissionsGuard)
export class LodgingAllotmentsController {
  constructor(
    private readonly allotmentsService: LodgingAllotmentsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar los cupos' })
  @Get()
  @Permissions('store:lodging:rates:read')
  async findAll() {
    const result = await this.allotmentsService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear un cupo' })
  @Post()
  @Permissions('store:lodging:rates:write')
  async create(@Body() dto: CreateAllotmentDto) {
    const result = await this.allotmentsService.create(dto);
    return this.responseService.created(result, 'Cupo creado exitosamente');
  }

  @ApiOperation({ summary: 'Editar o desactivar un cupo' })
  @Patch(':id')
  @Permissions('store:lodging:rates:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAllotmentDto,
  ) {
    const result = await this.allotmentsService.update(id, dto);
    return this.responseService.updated(
      result,
      'Cupo actualizado exitosamente',
    );
  }
}
