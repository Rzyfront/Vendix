import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingIcalImportService } from './ical-import.service';
import { CreateIcalImportDto } from './ical-import.dto';

/** Hospitality Suite (H6.2) — Canales → iCal: calendars imported per room. */
@Controller('store/hospitality/channels/ical/imports')
@UseGuards(PermissionsGuard)
export class LodgingIcalImportController {
  constructor(
    private readonly icalImport: LodgingIcalImportService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Calendarios externos importados por habitación' })
  @Get()
  @Permissions('store:lodging:channels:manage')
  async list() {
    return this.responseService.success(await this.icalImport.list());
  }

  @ApiOperation({ summary: 'Importar el iCal de un canal en una habitación (sincroniza al guardar)' })
  @Post()
  @Permissions('store:lodging:channels:manage')
  async create(@Body() dto: CreateIcalImportDto) {
    return this.responseService.created(await this.icalImport.create(dto), 'Calendario importado');
  }

  @ApiOperation({ summary: 'Sincronizar ahora' })
  @Post(':id/sync')
  @Permissions('store:lodging:channels:manage')
  async sync(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.icalImport.syncNow(id), 'Calendario sincronizado');
  }

  @ApiOperation({ summary: 'Dejar de importar: libera los bloqueos que vienen de ese canal' })
  @Delete(':id')
  @Permissions('store:lodging:channels:manage')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.responseService.success(await this.icalImport.remove(id), 'Calendario quitado');
  }
}
