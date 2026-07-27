import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import {
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { ConfirmScannedInvoiceDto } from './dto/scan-invoice.dto';
import { CostPreviewDto } from './dto/cost-preview.dto';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';
import { RequestContextService } from '@common/context/request-context.service';
import {
  PaymentReceiptScanJob,
  PaymentReceiptScanJobStatusResult,
} from './payment-receipt-scan-job.interface';

/** Mimites permitidos para el scan de comprobante (calque del patrón
 *  dispatch-notes: sharp solo procesa imagen; PDF → ver skill `vendix-ai-queue` v2.2). */
const PAYMENT_RECEIPT_SCAN_ALLOWED_MIMETYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const PAYMENT_RECEIPT_SCAN_MAX_FILE_BYTES = 10 * 1024 * 1024;

@Controller('store/orders/purchase-orders')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly invoiceScannerService: InvoiceScannerService,
    private readonly responseService: ResponseService,
    // FASE TRACK B2 — cola dedicada `payment-receipt-scan` (registrada en
    // purchase-orders.module.ts). Calque del patrón expenses.
    @InjectQueue('payment-receipt-scan')
    private readonly paymentReceiptScanQueue: Queue<PaymentReceiptScanJob>,
  ) {}

  @Post()
  @Permissions('store:orders:purchase_orders:create')
  async create(@Body() createPurchaseOrderDto: CreatePurchaseOrderDto) {
    try {
      const result = await this.purchaseOrdersService.create(
        createPurchaseOrderDto,
      );
      return this.responseService.created(
        result,
        'Orden de compra creada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al crear la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get()
  @Permissions('store:orders:purchase_orders:read')
  async findAll(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findAll(query);
      if (result.data && result.meta) {
        return this.responseService.paginated(
          result.data,
          result.meta.total,
          result.meta.page,
          result.meta.limit,
          'Órdenes de compra obtenidas exitosamente',
        );
      }
      return this.responseService.success(
        result,
        'Órdenes de compra obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('draft')
  @Permissions('store:orders:purchase_orders:read')
  async findDrafts(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findByStatus(
        'draft',
        query,
      );
      return this.responseService.success(
        result,
        'Borradores de órdenes de compra obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los borradores de órdenes de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('approved')
  @Permissions('store:orders:purchase_orders:read')
  async findApproved(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findByStatus(
        'approved',
        query,
      );
      return this.responseService.success(
        result,
        'Órdenes de compra aprobadas obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra aprobadas',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('pending')
  @Permissions('store:orders:purchase_orders:read')
  async findPending(@Query() query: PurchaseOrderQueryDto) {
    try {
      const result = await this.purchaseOrdersService.findPending(query);
      return this.responseService.success(
        result,
        'Órdenes de compra pendientes obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra pendientes',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get('supplier/:supplierId')
  @Permissions('store:orders:purchase_orders:read')
  async findBySupplier(
    @Param('supplierId') supplierId: string,
    @Query() query: PurchaseOrderQueryDto,
  ) {
    try {
      const result = await this.purchaseOrdersService.findBySupplier(
        +supplierId,
        query,
      );
      return this.responseService.success(
        result,
        'Órdenes de compra del proveedor obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las órdenes de compra del proveedor',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== Invoice Scanner routes =====

  @Post('scan')
  @Permissions('store:orders:purchase_orders:create')
  @UseInterceptors(FileInterceptor('file'))
  async scanInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Query('orderType') orderType?: 'retail' | 'ingredient',
  ) {
    try {
      if (!file) {
        throw new VendixHttpException(ErrorCodes.INV_SCAN_NO_FILE);
      }
      const allowedTypes = [
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/pdf',
      ];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new VendixHttpException(ErrorCodes.INV_SCAN_INVALID_FILE);
      }
      // Fase 4: route to the matching AI app profile. Mixed-line orders
      // are out of scope; the caller picks one profile per scan.
      const result = await this.invoiceScannerService.scanInvoice(
        file,
        orderType === 'ingredient' ? 'ingredient' : 'retail',
      );
      return this.responseService.success(
        result,
        'Factura escaneada exitosamente',
      );
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al escanear la factura',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('scan/match')
  @Permissions('store:orders:purchase_orders:create')
  async matchProducts(@Body() scanResult: any) {
    try {
      const result = await this.invoiceScannerService.matchProducts(scanResult);
      return this.responseService.success(
        result,
        'Coincidencias de productos encontradas',
      );
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al buscar coincidencias de productos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('scan/confirm')
  @Permissions('store:orders:purchase_orders:create')
  @UseInterceptors(FileInterceptor('file'))
  async confirmScannedInvoice(
    @UploadedFile() file: Express.Multer.File,
    @Body() confirmDto: ConfirmScannedInvoiceDto,
  ) {
    try {
      const result = await this.invoiceScannerService.confirmAndCreatePO(
        confirmDto,
        file,
      );
      return this.responseService.created(
        result,
        'Orden de compra creada desde factura escaneada',
      );
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al confirmar la factura escaneada',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post('cost-preview')
  @Permissions('store:orders:purchase_orders:read')
  async getCostPreview(@Body() dto: CostPreviewDto) {
    try {
      const result = await this.purchaseOrdersService.getCostPreview(dto);
      return this.responseService.success(result, 'Preview de costos obtenido');
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener preview de costos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== Sub-resource routes (BEFORE :id to avoid route conflicts) =====

  @Get(':id/receptions')
  @Permissions('store:orders:purchase_orders:read')
  async getReceptions(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.getReceptions(+id);
      return this.responseService.success(
        result,
        'Recepciones obtenidas exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener las recepciones',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/cost-summary')
  @Permissions('store:orders:purchase_orders:read')
  async getCostSummary(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.getCostSummary(+id);
      return this.responseService.success(
        result,
        'Resumen de costos obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el resumen de costos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/timeline')
  @Permissions('store:orders:purchase_orders:read')
  async getTimeline(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.getTimeline(+id);
      return this.responseService.success(
        result,
        'Timeline obtenido exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener el timeline',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/attachments')
  @Permissions('store:orders:purchase_orders:attach')
  @UseInterceptors(FileInterceptor('file'))
  async addAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: AddAttachmentDto,
  ) {
    try {
      if (!file) {
        return this.responseService.error(
          'No se proporcionó un archivo',
          'File is required',
          400,
        );
      }
      const result = await this.purchaseOrdersService.addAttachment(
        +id,
        file,
        dto,
      );
      return this.responseService.created(
        result,
        'Archivo adjunto agregado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al agregar el archivo adjunto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/attachments')
  @Permissions('store:orders:purchase_orders:read')
  async getAttachments(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.getAttachments(+id);
      return this.responseService.success(
        result,
        'Archivos adjuntos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los archivos adjuntos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id/attachments/:attachmentId')
  @Permissions('store:orders:purchase_orders:attach')
  async removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    try {
      const result =
        await this.purchaseOrdersService.removeAttachment(+attachmentId);
      return this.responseService.success(
        result,
        'Archivo adjunto eliminado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar el archivo adjunto',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Post(':id/payments')
  @Permissions('store:orders:purchase_orders:pay')
  async registerPayment(
    @Param('id') id: string,
    @Body() dto: RegisterPaymentDto,
  ) {
    try {
      const result = await this.purchaseOrdersService.registerPayment(+id, dto);
      return this.responseService.created(
        result,
        'Pago registrado exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al registrar el pago',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Get(':id/payments')
  @Permissions('store:orders:purchase_orders:read')
  async getPayments(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.getPayments(+id);
      return this.responseService.success(
        result,
        'Pagos obtenidos exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener los pagos',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ===== Main :id route =====

  @Get(':id')
  @Permissions('store:orders:purchase_orders:read')
  async findOne(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.findOne(+id);
      return this.responseService.success(
        result,
        'Orden de compra obtenida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al obtener la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id')
  @Permissions('store:orders:purchase_orders:update')
  async update(
    @Param('id') id: string,
    @Body() updatePurchaseOrderDto: UpdatePurchaseOrderDto,
  ) {
    try {
      const result = await this.purchaseOrdersService.update(
        +id,
        updatePurchaseOrderDto,
      );
      return this.responseService.updated(
        result,
        'Orden de compra actualizada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al actualizar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/approve')
  @Permissions('store:orders:purchase_orders:approve')
  async approve(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.approve(+id);
      return this.responseService.success(
        result,
        'Orden de compra aprobada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al aprobar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/cancel')
  @Permissions('store:orders:purchase_orders:cancel')
  async cancel(@Param('id') id: string) {
    try {
      const result = await this.purchaseOrdersService.cancel(+id);
      return this.responseService.success(
        result,
        'Orden de compra cancelada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al cancelar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Patch(':id/receive')
  @Permissions('store:orders:purchase_orders:receive')
  async receive(@Param('id') id: string, @Body() dto: ReceivePurchaseOrderDto) {
    try {
      const result = await this.purchaseOrdersService.receive(+id, dto);
      return this.responseService.success(
        result,
        'Orden de compra recibida exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al recibir la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  @Delete(':id')
  @Permissions('store:orders:purchase_orders:delete')
  async remove(@Param('id') id: string) {
    try {
      await this.purchaseOrdersService.remove(+id);
      return this.responseService.deleted(
        'Orden de compra eliminada exitosamente',
      );
    } catch (error) {
      return this.responseService.error(
        error.message || 'Error al eliminar la orden de compra',
        error.response?.message || error.message,
        error.status || 400,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FASE TRACK B2 — AI scan ASYNC para comprobantes de pago (POP)
  // ═══════════════════════════════════════════════════════════════
  // Calque de dispatch-notes (`receipt-scan`) y expenses (`scan`).
  //   POST /:id/payments/scan        → 202 {job_id}     (enqueue)
  //   GET  /:id/payments/scan/:jobId → {status, result?} (poll con IDOR)
  //
  // El controller es dueño del preprocess (sharp resize → dataUri) y del
  // enqueue; el processor (payment-receipt-scan.processor.ts) restaura
  // RequestContextService.run y llama InvoiceScannerService.scanPaymentFromImage.

  @Post(':id/payments/scan')
  @Permissions('store:orders:purchase_orders:create')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: require('multer').memoryStorage(),
      limits: { fileSize: PAYMENT_RECEIPT_SCAN_MAX_FILE_BYTES },
      fileFilter: (_req, file, cb) => {
        if (!PAYMENT_RECEIPT_SCAN_ALLOWED_MIMETYPES.has(file.mimetype)) {
          return cb(
            new BadRequestException(
              `Tipo de archivo no soportado: ${file.mimetype}`,
            ),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async enqueuePaymentReceiptScan(
    @Param('id') purchaseOrderId: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException(
        'Archivo requerido (campo "file", image/* hasta 10MB).',
      );
    }

    // 1. Preprocess at ENQUEUE (multer buffer no cruza la frontera de la cola).
    const { base64, mimeType } =
      await this.invoiceScannerService.prepareImage(file);
    const dataUri = `data:${mimeType};base64,${base64}`;

    // 2. Capturar contexto tenant para que el processor restaure el scope.
    const ctx = RequestContextService.getContext();
    const store_id = (ctx as any)?.store_id ?? undefined;
    const organization_id = (ctx as any)?.organization_id ?? undefined;
    const user_id = (ctx as any)?.user_id ?? undefined;
    const request_id =
      (ctx as any)?.request_id ?? `payment-scan-${randomUUID()}`;

    if (store_id == null) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // 3. Enqueue (calque exacto del patrón expenses/receipt-scan).
    try {
      const job = await this.paymentReceiptScanQueue.add(
        'scan',
        { dataUri, mimeType, context: { store_id, organization_id, user_id, request_id } },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
        },
      );
      return this.responseService.success(
        { job_id: job.id, purchase_order_id: Number(purchaseOrderId) },
        'Scan de comprobante encolado',
      );
    } catch (err: any) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_001);
    }
  }

  @Get(':id/payments/scan/:jobId')
  @Permissions('store:orders:purchase_orders:read')
  async getPaymentReceiptScanStatus(
    @Param('id') purchaseOrderId: string,
    @Param('jobId') jobId: string,
  ): Promise<PaymentReceiptScanJobStatusResult> {
    const job = await this.paymentReceiptScanQueue.getJob(jobId);

    // 🔒 IDOR (MANDATORY per vendix-ai-queue v2.2). job.returnvalue NO está
    // cubierto por scoped-prisma — viene de Redis. Devolver el mismo 404 que
    // un job inexistente para no filtrar existencia cross-tenant.
    const callerStoreId = RequestContextService.getContext()?.store_id as
      | number
      | undefined;
    if (
      !job ||
      callerStoreId == null ||
      job.data?.context?.store_id !== callerStoreId
    ) {
      throw new VendixHttpException(ErrorCodes.AI_QUEUE_002);
    }

    return {
      status: (await job.getState()) as any,
      result: (job.returnvalue as any) ?? undefined,
      error: job.failedReason ?? undefined,
    };
  }
}
