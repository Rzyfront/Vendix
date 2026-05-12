import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';

import { Permissions } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { ResponseService } from '../../../common/responses/response.service';
import { OrgInvoicingService } from './invoicing.service';
import { QueryOrgInvoiceDto } from './dto/query-org-invoice.dto';

@Controller('organization/invoicing')
@UseGuards(PermissionsGuard)
export class OrgInvoicingController {
  constructor(
    private readonly invoicingService: OrgInvoicingService,
    private readonly responseService: ResponseService,
  ) {}

  @Get('summary')
  @Permissions('organization:invoicing:read')
  async getSummary(@Query() query: QueryOrgInvoiceDto) {
    const data = await this.invoicingService.getSummary(query);
    return this.responseService.success(data, 'Resumen de facturación obtenido');
  }

  @Get('invoices')
  @Permissions('organization:invoicing:read')
  async findAll(@Query() query: QueryOrgInvoiceDto) {
    const result = await this.invoicingService.findAll(query);
    return this.responseService.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
      'Facturas obtenidas',
    );
  }

  @Get('invoices/:id')
  @Permissions('organization:invoicing:read')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('store_id') storeIdRaw?: string,
  ) {
    const storeId = storeIdRaw ? Number(storeIdRaw) : undefined;
    const data = await this.invoicingService.findOne(id, storeId);
    return this.responseService.success(data, 'Factura obtenida');
  }

}
