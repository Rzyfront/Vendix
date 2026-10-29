import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { ResponseService } from '@common/responses/response.service';
import { buildReportBuffer } from '@common/reports/report-builder';
import { ReportColumn } from '@common/reports/report-column.types';
import { buildReportFilename, sendXlsxReport } from '@common/reports/report-response.util';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingVatExemptServicesService } from './vat-exempt-services.service';
import { VatExemptServicesQueryDto } from './vat-exempt-services.dto';
import { entryPermitLabel } from '../guests/lodging-vat-exemption';

const COUNTRY_NAMES = new Intl.DisplayNames(['es'], { type: 'region' });

/** "US" → "Estados Unidos"; an unknown code stays as stored. */
function countryLabel(code: string | null): string | null {
  if (!code) return null;
  try {
    return COUNTRY_NAMES.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** Hospitality Suite (H3.9) — "Servicios exentos" report. */
@Controller('store/hospitality/reports/vat-exempt-services')
@UseGuards(PermissionsGuard)
export class LodgingVatExemptServicesController {
  constructor(
    private readonly vatExemptServices: LodgingVatExemptServicesService,
    private readonly responseService: ResponseService,
  ) {}

  @ApiOperation({ summary: 'Servicios exentos: facturas con alojamiento exento de IVA (art. 481 lit. d ET)' })
  @Get()
  @Permissions('store:lodging:reports:read')
  async list(@Query() query: VatExemptServicesQueryDto) {
    const result = await this.vatExemptServices.list(query);
    return this.responseService.success(result);
  }

  /** U18 — same dataset and totals as the screen, as XLSX, with country and permit by name. */
  @ApiOperation({ summary: 'Exportar servicios exentos (XLSX)' })
  @Get('export')
  @Permissions('store:lodging:reports:read')
  async export(@Query() query: VatExemptServicesQueryDto, @Res() res: Response): Promise<void> {
    const report = await this.vatExemptServices.list(query);
    const tz = report.timezone;
    const columns: ReportColumn[] = [
      { key: 'invoice_number', header: 'Factura', type: 'text' },
      { key: 'issue_date', header: 'Fecha', type: 'date', tz },
      { key: 'reservation_number', header: 'Reserva', type: 'text' },
      { key: 'guest_name', header: 'Huésped', type: 'text', width: 28 },
      { key: 'document_type', header: 'Tipo de documento', type: 'text' },
      { key: 'document_number', header: 'Número de documento', type: 'text' },
      { key: 'nationality', header: 'Nacionalidad', type: 'text', width: 22 },
      { key: 'entry_permit', header: 'Permiso de ingreso', type: 'text', width: 40 },
      { key: 'exempt_base', header: 'Base exenta', type: 'currency' },
      { key: 'invoice_total', header: 'Total factura', type: 'currency' },
    ];
    const rows = report.rows.map((row) => ({
      ...row,
      nationality: countryLabel(row.nationality_country_code),
      entry_permit: entryPermitLabel(row.entry_permit_type),
    }));
    const buffer = await buildReportBuffer({
      sheets: [
        {
          name: 'Servicios exentos',
          columns,
          rows,
          tz,
          totals: {
            invoice_number: `Total: ${rows.length} facturas`,
            exempt_base: rows.reduce((sum, row) => sum + row.exempt_base, 0),
            invoice_total: rows.reduce((sum, row) => sum + row.invoice_total, 0),
          },
        },
      ],
    });
    sendXlsxReport(res, buffer, buildReportFilename('servicios_exentos', { tz }));
  }
}
