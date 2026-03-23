import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { InvoicingService } from './invoicing.service';
import { InvoiceFlowService } from './invoice-flow/invoice-flow.service';
import { CreditNotesService } from './credit-notes/credit-notes.service';
import { InvoicePdfService } from './services/invoice-pdf.service';
import { ResponseService } from '../../../common/responses/response.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { QueryInvoiceDto } from './dto/query-invoice.dto';
import { CreateCreditNoteDto, CreateDebitNoteDto } from './credit-notes/dto/create-credit-note.dto';

@Controller('store/invoicing')
export class InvoicingController {
  constructor(
    private readonly invoicing_service: InvoicingService,
    private readonly invoice_flow_service: InvoiceFlowService,
    private readonly credit_notes_service: CreditNotesService,
    private readonly invoice_pdf_service: InvoicePdfService,
    private readonly response_service: ResponseService,
  ) {}

  @Get()
  @Permissions('invoicing:read')
  async findAll(@Query() query_dto: QueryInvoiceDto) {
    const result = await this.invoicing_service.findAll(query_dto);
    return this.response_service.paginated(
      result.data,
      result.meta.total,
      result.meta.page,
      result.meta.limit,
    );
  }

  // --- Static Routes (MUST be before :id) ---

  @Get('stats')
  @Permissions('invoicing:read')
  async getStats(
    @Query('date_from') date_from?: string,
    @Query('date_to') date_to?: string,
  ) {
    const result = await this.invoicing_service.getStats(date_from, date_to);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() create_dto: CreateInvoiceDto) {
    const result = await this.invoicing_service.create(create_dto);
    return this.response_service.success(result, 'Invoice created successfully');
  }

  @Post('from-order/:orderId')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createFromOrder(@Param('orderId') orderId: string) {
    const result = await this.invoicing_service.createFromOrder(+orderId);
    return this.response_service.success(
      result,
      'Invoice created from order successfully',
    );
  }

  @Post('from-sales-order/:salesOrderId')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createFromSalesOrder(@Param('salesOrderId') salesOrderId: string) {
    const result = await this.invoicing_service.createFromSalesOrder(
      +salesOrderId,
    );
    return this.response_service.success(
      result,
      'Invoice created from sales order successfully',
    );
  }

  @Post('credit-notes')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createCreditNote(@Body() create_dto: CreateCreditNoteDto) {
    const result = await this.credit_notes_service.createCreditNote(create_dto);
    return this.response_service.success(
      result,
      'Credit note created successfully',
    );
  }

  @Post('debit-notes')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async createDebitNote(@Body() create_dto: CreateDebitNoteDto) {
    const result = await this.credit_notes_service.createDebitNote(create_dto);
    return this.response_service.success(
      result,
      'Debit note created successfully',
    );
  }

  // --- Parameter Routes (MUST be last) ---

  @Get(':id/pdf')
  @Permissions('invoicing:read')
  async getInvoicePdf(@Param('id') id: string) {
    const url = await this.invoice_pdf_service.getPdf(+id);
    return this.response_service.success({ url });
  }

  @Post(':id/pdf/regenerate')
  @Permissions('invoicing:write')
  async regenerateInvoicePdf(@Param('id') id: string) {
    const result = await this.invoice_pdf_service.generatePdf(+id);
    return this.response_service.success(result, 'Invoice PDF regenerated');
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async findOne(@Param('id') id: string) {
    const result = await this.invoicing_service.findOne(+id);
    return this.response_service.success(result);
  }

  @Patch(':id')
  @Permissions('invoicing:write')
  async update(@Param('id') id: string, @Body() update_dto: UpdateInvoiceDto) {
    const result = await this.invoicing_service.update(+id, update_dto);
    return this.response_service.success(result, 'Invoice updated successfully');
  }

  @Patch(':id/validate')
  @Permissions('invoicing:write')
  async validate(@Param('id') id: string) {
    const result = await this.invoice_flow_service.validate(+id);
    return this.response_service.success(
      result,
      'Invoice validated successfully',
    );
  }

  @Patch(':id/send')
  @Permissions('invoicing:write')
  async send(@Param('id') id: string) {
    const result = await this.invoice_flow_service.send(+id);
    return this.response_service.success(result, 'Invoice sent successfully');
  }

  @Patch(':id/accept')
  @Permissions('invoicing:write')
  async accept(@Param('id') id: string) {
    const result = await this.invoice_flow_service.accept(+id);
    return this.response_service.success(
      result,
      'Invoice accepted successfully',
    );
  }

  @Patch(':id/reject')
  @Permissions('invoicing:write')
  async reject(@Param('id') id: string) {
    const result = await this.invoice_flow_service.reject(+id);
    return this.response_service.success(
      result,
      'Invoice rejected successfully',
    );
  }

  @Patch(':id/cancel')
  @Permissions('invoicing:write')
  async cancel(@Param('id') id: string) {
    const result = await this.invoice_flow_service.cancel(+id);
    return this.response_service.success(
      result,
      'Invoice cancelled successfully',
    );
  }

  @Patch(':id/void')
  @Permissions('invoicing:write')
  async voidInvoice(@Param('id') id: string) {
    const result = await this.invoice_flow_service.void(+id);
    return this.response_service.success(result, 'Invoice voided successfully');
  }

  @Delete(':id')
  @Permissions('invoicing:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.invoicing_service.remove(+id);
    return this.response_service.success(null, 'Invoice deleted successfully');
  }
}
