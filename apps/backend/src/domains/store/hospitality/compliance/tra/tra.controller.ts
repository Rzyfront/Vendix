import { Body, Controller, Get, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { ReportColumn } from '@common/reports/report-column.types';
import { buildReportFilename, sendXlsxReport } from '@common/reports/report-response.util';
import { resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { RequestContextService } from '@common/context/request-context.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { LodgingTraService } from './tra-submissions.service';
import { TraIdsDto, TraListQueryDto, TraMarkReportedDto, TraTokenDto } from './tra.dto';
import { TRA_EVENT_LABELS, TraEvent } from './tra-record';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente',
  sent: 'Enviado',
  manual: 'Reportado en el portal',
  failed: 'Rechazado',
};

/** «2026-11-10» → «10/11/2026», as the TRA portal form asks. */
function dayMonthYear(date: string | undefined): string {
  if (!date) return '';
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
}

/** Hospitality Suite (H4.1) — TRA report of each check-in and check-out. */
@Controller('store/hospitality/compliance/tra')
@UseGuards(PermissionsGuard)
export class LodgingTraController {
  constructor(
    private readonly tra: LodgingTraService,
    private readonly prisma: StorePrismaService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'TRA: conteos, token y aviso del hotel' })
  @Get('summary')
  @Permissions('store:lodging:reservations:read')
  async summary() {
    return this.responseService.success(await this.tra.summary());
  }

  @ApiOperation({ summary: 'TRA: registros por huésped y evento' })
  @Get()
  @Permissions('store:lodging:reservations:read')
  async list(@Query() query: TraListQueryDto) {
    const { data, total, page, limit } = await this.tra.list(query);
    return this.responseService.paginated(data, total, page, limit);
  }

  @ApiOperation({ summary: 'TRA: volver a enviar los pendientes (o los indicados)' })
  @Post('retry')
  @Permissions('store:lodging:front_desk:operate')
  async retry(@Body() dto: TraIdsDto) {
    const result = await this.tra.retry(dto.ids);
    return this.responseService.success(result, 'Reenvío en curso');
  }

  @ApiOperation({ summary: 'TRA: marcar como reportados a mano en el portal' })
  @Post('mark-reported')
  @Permissions('store:lodging:front_desk:operate')
  async markReported(@Body() dto: TraMarkReportedDto) {
    const result = await this.tra.markReported(dto.ids);
    return this.responseService.success(result, 'Marcados como reportados en el portal');
  }

  @ApiOperation({ summary: 'TRA: guardar el token del MinCIT (cifrado) y probarlo' })
  @Put('token')
  @Permissions('store:lodging:channels:manage')
  async saveToken(@Body() dto: TraTokenDto) {
    const result = await this.tra.saveToken(dto.token);
    return this.responseService.success(result, 'Token TRA guardado');
  }

  @ApiOperation({ summary: 'TRA: probar la conexión con el token guardado' })
  @Post('token/test')
  @Permissions('store:lodging:channels:manage')
  async testToken() {
    return this.responseService.success(await this.tra.testConnection());
  }

  /** Assisted path: the TRA fields of the open records, to load in the portal. */
  @ApiOperation({ summary: 'TRA: exportar los registros pendientes (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reservations:read')
  async export(@Query() query: TraListQueryDto, @Res() res: Response): Promise<void> {
    const store_id = RequestContextService.getContext()?.store_id as number;
    const tz = await resolveStoreTimezone(this.prisma, store_id);
    const items = await this.tra.exportRows(query);
    const columns: ReportColumn[] = [
      { key: 'reservation', header: 'Reserva', type: 'text', width: 14 },
      { key: 'event', header: 'Evento', type: 'text', width: 12 },
      { key: 'status', header: 'Estado', type: 'text', width: 22 },
      { key: 'rnt', header: 'RNT', type: 'text', width: 12 },
      { key: 'guest_kind', header: 'Huésped', type: 'text', width: 12 },
      { key: 'document_type', header: 'Tipo de documento', type: 'text', width: 10 },
      { key: 'document_number', header: 'Número de documento', type: 'text', width: 18 },
      { key: 'first_name', header: 'Nombres', type: 'text', width: 20 },
      { key: 'last_name', header: 'Apellidos', type: 'text', width: 20 },
      { key: 'nationality', header: 'Nacionalidad', type: 'text', width: 12 },
      { key: 'residence_city', header: 'Ciudad de residencia', type: 'text', width: 20 },
      { key: 'origin_city', header: 'Ciudad de procedencia', type: 'text', width: 20 },
      { key: 'travel_purpose', header: 'Motivo de viaje', type: 'text', width: 26 },
      { key: 'check_in', header: 'Check-in', type: 'text', width: 12 },
      { key: 'check_out', header: 'Check-out', type: 'text', width: 12 },
      { key: 'unit_type', header: 'Tipo de acomodación', type: 'text', width: 20 },
      { key: 'room', header: 'Habitación', type: 'text', width: 12 },
      { key: 'amount', header: 'Valor pagado', type: 'currency' },
    ];
    const rows = items.map(({ row, record }) => ({
      reservation: row.reservation.reservation_number,
      event: TRA_EVENT_LABELS[row.event as TraEvent] ?? row.event,
      status: STATUS_LABELS[row.status] ?? row.status,
      rnt: record?.prestador.rnt ?? '',
      guest_kind: record ? (record.huesped.tipo_huesped === 'titular' ? 'Titular' : 'Acompañante') : '',
      document_type: record?.huesped.tipo_documento ?? '',
      document_number: record?.huesped.numero_documento ?? '',
      first_name: record?.huesped.nombres ?? row.guest_name,
      last_name: record?.huesped.apellidos ?? '',
      nationality: record?.huesped.nacionalidad ?? '',
      residence_city: record?.huesped.ciudad_residencia ?? '',
      origin_city: record?.huesped.ciudad_procedencia ?? '',
      travel_purpose: record?.huesped.motivo_viaje ?? '',
      check_in: dayMonthYear(record?.huesped.fecha_check_in),
      check_out: dayMonthYear(record?.huesped.fecha_check_out),
      unit_type: record?.unidad.tipo_acomodacion ?? '',
      room: record?.unidad.numero_habitacion ?? '',
      amount: record?.unidad.valor_pagado ?? null,
    }));
    const buffer = await buildReportBuffer({ sheets: [{ name: 'TRA', columns, rows, tz }] });
    sendXlsxReport(res, buffer, buildReportFilename('tra_registros', { tz }));
  }
}
