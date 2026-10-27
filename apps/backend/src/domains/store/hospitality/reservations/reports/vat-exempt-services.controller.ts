import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation } from '@nestjs/swagger';
import { ResponseService } from '@common/responses/response.service';
import { PermissionsGuard } from '../../../../auth/guards/permissions.guard';
import { Permissions } from '../../../../auth/decorators/permissions.decorator';
import { LodgingVatExemptServicesService } from './vat-exempt-services.service';
import { VatExemptServicesQueryDto } from './vat-exempt-services.dto';

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
}
