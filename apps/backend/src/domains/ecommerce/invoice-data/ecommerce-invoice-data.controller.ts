import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { Public } from '@common/decorators/public.decorator';
import { InvoiceDataRequestsService } from '../../store/invoicing/invoice-data-requests/invoice-data-requests.service';
import { SubmitInvoiceDataDto } from '../../store/invoicing/invoice-data-requests/dto/submit-invoice-data.dto';
import { ResponseService } from '@common/responses/response.service';

@Controller('ecommerce/invoice-data')
export class EcommerceInvoiceDataController {
  constructor(
    private readonly invoiceDataService: InvoiceDataRequestsService,
    private readonly responseService: ResponseService,
  ) {}

  @Public()
  @Get(':token/order-summary')
  async getOrderSummary(@Param('token') token: string) {
    const summary = await this.invoiceDataService.getOrderSummaryByToken(token);
    return this.responseService.success(summary);
  }

  @Public()
  @Get(':token')
  async getRequestInfo(@Param('token') token: string) {
    const request = await this.invoiceDataService.getByToken(token);
    return this.responseService.success(request);
  }

  @Public()
  @Post(':token/submit')
  async submitData(
    @Param('token') token: string,
    @Body() dto: SubmitInvoiceDataDto,
  ) {
    const result = await this.invoiceDataService.submitData(token, dto);
    return this.responseService.success(
      result,
      'Datos de facturación recibidos correctamente',
    );
  }
}
