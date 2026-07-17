import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { DispatchNotesService } from './dispatch-notes.service';
import { DispatchNoteFlowService } from './dispatch-note-flow/dispatch-note-flow.service';
import { DispatchNotePdfService } from './pdf/dispatch-note-pdf.service';
import {
  CreateDispatchNoteDto,
  UpdateDispatchNoteDto,
  DispatchNoteQueryDto,
  CreateFromSalesOrderDto,
  CreateFromOrderDto,
  CreateFromOrdersBatchDto,
  VoidDispatchNoteDto,
  DeliverDispatchNoteDto,
  ConfirmDispatchNoteDto,
  CreateTransferDispatchDto,
  CreateReturnDispatchDto,
  CreatePurchaseReceiptDispatchDto,
} from './dto';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

@Controller('store/dispatch-notes')
@UseGuards(PermissionsGuard)
export class DispatchNotesController {
  private static readonly RECEIPT_SCAN_ALLOWED_MIMETYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ];

  private static readonly RECEIPT_SCAN_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB

  constructor(
    private readonly dispatchNotesService: DispatchNotesService,
    private readonly dispatchNoteFlowService: DispatchNoteFlowService,
    private readonly dispatchNotePdfService: DispatchNotePdfService,
    private readonly responseService: ResponseService,
  ) {}

  @Get()
  @Permissions('store:dispatch_notes:read')
  async findAll(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.findAll(query);
    return this.responseService.success(
      result,
      'Remisiones obtenidas exitosamente',
    );
  }

  @Post()
  @Permissions('store:dispatch_notes:create')
  async create(@Body() dto: CreateDispatchNoteDto) {
    const result = await this.dispatchNotesService.create(dto);
    return this.responseService.created(result, 'Remisión creada exitosamente');
  }

  @Get('stats')
  @Permissions('store:dispatch_notes:read')
  async getStats() {
    const result = await this.dispatchNotesService.getStats();
    return this.responseService.success(
      result,
      'Estadísticas de remisiones obtenidas',
    );
  }

  @Get('by-sales-order/:salesOrderId')
  @Permissions('store:dispatch_notes:read')
  async getBySalesOrder(
    @Param('salesOrderId', ParseIntPipe) sales_order_id: number,
  ) {
    const result =
      await this.dispatchNotesService.getBySalesOrder(sales_order_id);
    return this.responseService.success(
      result,
      'Remisiones por orden de venta obtenidas exitosamente',
    );
  }

  @Post('from-sales-order/:salesOrderId')
  @Permissions('store:dispatch_notes:create')
  async createFromSalesOrder(
    @Param('salesOrderId', ParseIntPipe) sales_order_id: number,
    @Body() dto: CreateFromSalesOrderDto,
  ) {
    const result = await this.dispatchNotesService.createFromSalesOrder(
      sales_order_id,
      dto,
    );
    return this.responseService.created(
      result,
      'Remisión creada desde orden de venta exitosamente',
    );
  }

  @Get('by-order/:orderId')
  @Permissions('store:dispatch_notes:read')
  async getByOrder(@Param('orderId', ParseIntPipe) order_id: number) {
    const result = await this.dispatchNotesService.getByOrder(order_id);
    return this.responseService.success(
      result,
      'Remisiones por orden obtenidas exitosamente',
    );
  }

  @Post('from-order/:orderId')
  @Permissions('store:dispatch_notes:create')
  async createFromOrder(
    @Param('orderId', ParseIntPipe) order_id: number,
    @Body() dto: CreateFromOrderDto,
  ) {
    const result = await this.dispatchNotesService.createFromOrder(
      order_id,
      dto,
    );
    return this.responseService.created(
      result,
      'Remisión creada desde orden exitosamente',
    );
  }

  /**
   * Plan Despacho Economía — FASE 7 paso 23.
   * Crea remisiones en lote desde N órdenes con resultado parcial por orden.
   */
  @Post('from-orders')
  @Permissions('store:dispatch_notes:create')
  async createFromOrdersBatch(@Body() dto: CreateFromOrdersBatchDto) {
    const result = await this.dispatchNotesService.createFromOrdersBatch(dto);
    return this.responseService.success(
      result,
      result.partial
        ? 'Batch procesado con resultados parciales'
        : 'Batch procesado completamente',
    );
  }

  /**
   * Validación en lote sin crear (2 agregaciones, no N×M).
   */
  @Post('from-orders/validate')
  @Permissions('store:dispatch_notes:read')
  async validateFromOrdersBatch(@Body() body: { order_ids: number[] }) {
    const result = await this.dispatchNotesService.validateFromOrdersBatch(
      body?.order_ids ?? [],
    );
    return this.responseService.success(
      result,
      result.ok
        ? 'Todas las órdenes tienen stock suficiente'
        : 'Hay órdenes con problemas de stock',
    );
  }

  @Get('reports/pending')
  @Permissions('store:dispatch_notes:read')
  async getPendingInvoicing(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.getPendingInvoicing(query);
    return this.responseService.success(
      result,
      'Reporte de remisiones pendientes de facturación obtenido',
    );
  }

  @Get('reports/by-customer')
  @Permissions('store:dispatch_notes:read')
  async getByCustomerReport(@Query() query: DispatchNoteQueryDto) {
    const result = await this.dispatchNotesService.getByCustomerReport(query);
    return this.responseService.success(
      result,
      'Reporte de remisiones por cliente obtenido',
    );
  }

  @Get('reports/profitability')
  @Permissions('store:dispatch_notes:read')
  async getProfitabilityReport(@Query() query: DispatchNoteQueryDto) {
    const result =
      await this.dispatchNotesService.getProfitabilityReport(query);
    return this.responseService.success(
      result,
      'Reporte de rentabilidad obtenido',
    );
  }

  // ── Bidirectional dispatch note endpoints ──────────────────────────

  /**
   * Create a transfer dispatch note (outbound transfer_out or inbound
   * transfer_in). Reuses the 'create' permission — internal gating by
   * direction/subtype is in the service (no separate inbound permission
   * to avoid a seed migration in v1).
   */
  @Post('transfer')
  @Permissions('store:dispatch_notes:create')
  async createTransfer(@Body() dto: CreateTransferDispatchDto) {
    const result = await this.dispatchNotesService.createTransfer(dto);
    return this.responseService.created(
      result,
      'Remisión de transferencia creada exitosamente',
    );
  }

  /**
   * Create a customer return dispatch note (inbound, subtype customer_return).
   * Reuses the 'create' permission — financial refund is decoupled (v1).
   */
  @Post('return')
  @Permissions('store:dispatch_notes:create')
  async createReturn(@Body() dto: CreateReturnDispatchDto) {
    const result = await this.dispatchNotesService.createReturn(dto);
    return this.responseService.created(
      result,
      'Remisión de devolución creada exitosamente',
    );
  }

  /**
   * Create a purchase receipt dispatch note (inbound, subtype purchase_receipt).
   * When purchase_order_id is present, delegates to PurchaseOrdersService.receive.
   * Reuses the 'create' permission.
   */
  @Post('purchase-receipt')
  @Permissions('store:dispatch_notes:create')
  async createPurchaseReceipt(@Body() dto: CreatePurchaseReceiptDispatchDto) {
    const result =
      await this.dispatchNotesService.createPurchaseReceipt(dto);
    return this.responseService.created(
      result,
      'Remisión de recepción de compra creada exitosamente',
    );
  }

  /**
   * R4c — Scan a purchase receipt / supplier invoice (multipart `file`) and
   * return AI-suggested line items + supplier, each matched (tenant-scoped)
   * against the store catalog. Reuses the dispatch-notes create permission.
   * No persistence — the frontend prefills the create wizard with the result.
   */
  @Post('receipt-scan')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_notes:create')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: DispatchNotesController.RECEIPT_SCAN_MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (
          !DispatchNotesController.RECEIPT_SCAN_ALLOWED_MIMETYPES.includes(
            file.mimetype,
          )
        ) {
          return cb(
            new VendixHttpException(
              ErrorCodes.DISPATCH_RECEIPT_SCAN_INVALID_FILE,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async receiptScan(@UploadedFile() file?: Express.Multer.File) {
    const result = await this.dispatchNotesService.scanReceipt(file);
    return this.responseService.success(
      result,
      'Recibo de compra escaneado exitosamente',
    );
  }

  @Get(':id')
  @Permissions('store:dispatch_notes:read:one')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNotesService.findOne(id);
    return this.responseService.success(
      result,
      'Remisión obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:dispatch_notes:update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDispatchNoteDto,
  ) {
    const result = await this.dispatchNotesService.update(id, dto);
    return this.responseService.updated(
      result,
      'Remisión actualizada exitosamente',
    );
  }

  @Delete(':id')
  @Permissions('store:dispatch_notes:delete')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dispatchNotesService.remove(id);
    return this.responseService.deleted('Remisión eliminada exitosamente');
  }

  @Post(':id/confirm')
  @Permissions('store:dispatch_notes:confirm')
  async confirm(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmDispatchNoteDto,
  ) {
    const result = await this.dispatchNoteFlowService.confirm(id, dto);
    return this.responseService.success(
      result,
      'Remisión confirmada exitosamente',
    );
  }

  @Post(':id/deliver')
  @Permissions('store:dispatch_notes:deliver')
  async deliver(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeliverDispatchNoteDto,
  ) {
    const result = await this.dispatchNoteFlowService.deliver(id, dto);
    return this.responseService.success(
      result,
      'Remisión entregada exitosamente',
    );
  }

  /**
   * Receive an inbound dispatch note (confirmed → received).
   * Reuses the 'deliver' permission — semantically equivalent (goods handed over).
   */
  @Post(':id/receive')
  @Permissions('store:dispatch_notes:deliver')
  async receive(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNoteFlowService.receive(id);
    return this.responseService.success(
      result,
      'Remisión recibida exitosamente',
    );
  }

  @Post(':id/void')
  @Permissions('store:dispatch_notes:void')
  async voidNote(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidDispatchNoteDto,
  ) {
    const result = await this.dispatchNoteFlowService.void(id, dto);
    return this.responseService.success(
      result,
      'Remisión anulada exitosamente',
    );
  }

  @Post(':id/invoice')
  @Permissions('store:dispatch_notes:invoice')
  async invoice(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dispatchNoteFlowService.invoice(id);
    return this.responseService.success(
      result,
      'Remisión facturada exitosamente',
    );
  }

  @Post(':id/pdf')
  @HttpCode(HttpStatus.OK)
  @Permissions('store:dispatch_notes:print')
  async generatePdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ) {
    const buffer = await this.dispatchNotePdfService.generatePdf(id);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="remision-${id}.pdf"`,
      'Content-Length': buffer.length.toString(),
    });
    res.end(buffer);
  }
}
