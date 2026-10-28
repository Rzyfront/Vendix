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
import { LodgingSeasonsService } from './seasons.service';
import { CreateSeasonDto, UpdateSeasonDto } from './dto';

/** Hospitality Suite (H2.2) — demand seasons priced inside each rate plan. */
@Controller('store/hospitality/seasons')
@UseGuards(PermissionsGuard)
export class LodgingSeasonsController {
  constructor(
    private readonly seasonsService: LodgingSeasonsService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Listar las temporadas' })
  @Get()
  @Permissions('store:lodging:rates:read')
  async findAll() {
    const result = await this.seasonsService.findAll();
    return this.responseService.success(result);
  }

  @ApiOperation({ summary: 'Crear una temporada' })
  @Post()
  @Permissions('store:lodging:rates:write')
  async create(@Body() dto: CreateSeasonDto) {
    const result = await this.seasonsService.create(dto);
    return this.responseService.created(result, 'Temporada creada exitosamente');
  }

  @ApiOperation({ summary: 'Editar o desactivar una temporada' })
  @Patch(':id')
  @Permissions('store:lodging:rates:write')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSeasonDto) {
    const result = await this.seasonsService.update(id, dto);
    return this.responseService.updated(result, 'Temporada actualizada exitosamente');
  }
}
