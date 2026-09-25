import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  ParseIntPipe,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Public } from '@common/decorators/public.decorator';
import { OptionalAuth } from '@common/decorators/optional-auth.decorator';
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

  /**
   * Paso 4 (roku-shop-checkout-tarifa-detalle-orden) — clon guest de
   * `GET /ecommerce/payments/:paymentId/receipt-url`: URL firmada TTL 5 min
   * al comprobante de transferencia/voucher. `@OptionalAuth` (nunca JWT en
   * query para guest): la autorización es el binding server-side
   * token→orden→pago, con 404 ciego si no hay vínculo.
   */
  @OptionalAuth()
  @Get(':token/payments/:paymentId/receipt-url')
  async getGuestPaymentReceiptUrl(
    @Param('token') token: string,
    @Param('paymentId', ParseIntPipe) paymentId: number,
  ) {
    const data = await this.invoiceDataService.getGuestPaymentReceiptUrl(
      token,
      paymentId,
    );
    return this.responseService.success(data);
  }

  /**
   * Paso 4 — subida tardía del comprobante desde la vista guest. Mismo
   * contrato que el checkout: `multipart/form-data` con `file`, 5 MB
   * (multer corta con 413), MIME imagen/PDF, solo bank_transfer/voucher.
   */
  @OptionalAuth()
  @Post(':token/payments/:paymentId/receipt')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async uploadGuestPaymentReceipt(
    @Param('token') token: string,
    @Param('paymentId', ParseIntPipe) paymentId: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const data = await this.invoiceDataService.uploadGuestPaymentReceipt(
      token,
      paymentId,
      file,
    );
    return this.responseService.success(
      data,
      'Comprobante recibido. La tienda lo revisará para confirmar tu pago.',
    );
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
