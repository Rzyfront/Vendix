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
  Logger,
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
import { ConfigurePaymentPlanDto } from './dto/configure-payment-plan.dto';
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

/**
 * CP-PURCHASE-TRANSPARENCY K — un fallo de compras dejó de responder 200.
 *
 * Cada handler de este controller estaba envuelto en un `try/catch` que
 * terminaba en `return this.responseService.error(...)`. Ese método RETORNA el
 * sobre `{success:false, statusCode}` en vez de lanzarlo, y `AllExceptionsFilter`
 * solo corre cuando la excepción SALE del handler: la respuesta viajaba con el
 * status del decorador —**200 en los `@Get`/`@Patch`/`@Delete`, 201 en los
 * `@Post`**— y el status real enterrado en el cuerpo.
 *
 * Para el cliente eso es indistinguible de un éxito a nivel de transporte: el
 * `HttpClient` de Angular resuelve por la rama de éxito, el interceptor de
 * errores no se dispara, y el componente pinta un fallo como si fuera un dato.
 * Verificado en caliente antes del cambio: `PATCH /:id/receive` con una
 * transacción caída devolvía `HTTP/1.1 200 OK`.
 *
 * El `catch` re-lanzaba ya las `HttpException` (QUI-486), así que los rechazos
 * de negocio salían bien. Lo que se colaba era el fallo GENÉRICO —un P2028, un
 * timeout, un `PrismaClientValidationError`—, que es justo el caso en que el
 * operador más necesita saber que no pasó nada. Y de propina el envoltorio
 * copiaba `error.message` al cuerpo: el mensaje crudo de Prisma reproduce la
 * invocación completa con la ruta interna del fichero, los nombres de tabla y
 * columna y el `store_id` del tenant. El filtro global deja eso en el log del
 * servidor y NUNCA en la respuesta (ver `http-exception.filter.ts`), así que
 * quitar el envoltorio cierra además una fuga de información.
 *
 * Precondición verificada antes de tocar nada: ningún `throw new Error(...)`
 * crudo alcanza un handler de este controller.
 *   · `purchase-orders.service.ts` → 0 ocurrencias.
 *   · `invoice-scanner.service.ts` → 3, ninguna alcanzable desde una ruta HTTP:
 *     las dos de `scanPaymentFromImage()` solo las ve el processor de la cola,
 *     y la de `normalizeOcrResponse()` la ataja `scanInvoice()`, que la traduce
 *     a `VendixHttpException(INV_SCAN_INCOMPLETE)`.
 *   · `s3.service.ts` → 2, en `downloadFile()` y en la generación de favicons;
 *     de S3 aquí solo se usan `uploadFile`/`signUrl`/`deleteFile`.
 * El resto de servicios de la cadena (stock, costeo, seriales, auditoría,
 * settings, fiscal, cuentas por pagar, IVA, AI engine) tienen 0.
 *
 * Forma del arreglo: el `catch` SOLO sobrevive donde aporta contexto de
 * diagnóstico que la excepción no lleva (el id de la orden, el tamaño del
 * lote, el nombre del fichero). Ahí registra y **re-lanza crudo**. Donde no
 * aportaba nada más que traducir el error, el `try/catch` se eliminó entero.
 */
@Controller('store/orders/purchase-orders')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  private readonly logger = new Logger(PurchaseOrdersController.name);

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
      // QUI-486 — los errores de negocio DEBEN salir como HTTP 4xx. Ese
      // ticket arregló la mitad tipada re-lanzando toda `HttpException`; los
      // errores NO-HTTP seguían saliendo con status 201 y `success:false` en
      // el cuerpo, que es exactamente el mismo "falso éxito" un peldaño más
      // abajo. Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la
      // clase: ahora se registra y se re-lanza crudo, sin distinguir tipo.
      //
      // El `catch` se conserva solo por el log: el proveedor y el número de
      // líneas son el dato con el que se reconstruye qué se intentó crear, y
      // la excepción no lo lleva.
      this.logger.error(
        `Purchase order create failed (supplier=${createPurchaseOrderDto?.supplier_id ?? 'n/a'}, items=${createPurchaseOrderDto?.items?.length ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
    }
  }

  @Get()
  @Permissions('store:orders:purchase_orders:read')
  async findAll(@Query() query: PurchaseOrderQueryDto) {
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
  }

  @Get('draft')
  @Permissions('store:orders:purchase_orders:read')
  async findDrafts(@Query() query: PurchaseOrderQueryDto) {
    const result = await this.purchaseOrdersService.findByStatus(
      'draft',
      query,
    );
    return this.responseService.success(
      result,
      'Borradores de órdenes de compra obtenidos exitosamente',
    );
  }

  @Get('approved')
  @Permissions('store:orders:purchase_orders:read')
  async findApproved(@Query() query: PurchaseOrderQueryDto) {
    const result = await this.purchaseOrdersService.findByStatus(
      'approved',
      query,
    );
    return this.responseService.success(
      result,
      'Órdenes de compra aprobadas obtenidas exitosamente',
    );
  }

  @Get('pending')
  @Permissions('store:orders:purchase_orders:read')
  async findPending(@Query() query: PurchaseOrderQueryDto) {
    const result = await this.purchaseOrdersService.findPending(query);
    return this.responseService.success(
      result,
      'Órdenes de compra pendientes obtenidas exitosamente',
    );
  }

  @Get('supplier/:supplierId')
  @Permissions('store:orders:purchase_orders:read')
  async findBySupplier(
    @Param('supplierId') supplierId: string,
    @Query() query: PurchaseOrderQueryDto,
  ) {
    const result = await this.purchaseOrdersService.findBySupplier(
      +supplierId,
      query,
    );
    return this.responseService.success(
      result,
      'Órdenes de compra del proveedor obtenidas exitosamente',
    );
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
      // Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la clase.
      // Este catch era además el más estrecho del fichero: filtraba por
      // `VendixHttpException`, así que una `BadRequestException` de Nest
      // —la que levanta el `FileInterceptor` cuando el multipart viene mal—
      // también acababa dentro del sobre con status 200.
      //
      // El log se queda porque el tipo y el tamaño del fichero son lo único
      // que explica un OCR caído, y no viajan en la excepción.
      this.logger.error(
        `Invoice scan failed (mimetype=${file?.mimetype ?? 'n/a'}, size=${file?.size ?? 0}, profile=${orderType ?? 'retail'}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
    }
  }

  @Post('scan/match')
  @Permissions('store:orders:purchase_orders:create')
  async matchProducts(@Body() scanResult: any) {
    const result = await this.invoiceScannerService.matchProducts(scanResult);
    return this.responseService.success(
      result,
      'Coincidencias de productos encontradas',
    );
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
      // Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la clase.
      // Aquí el falso éxito era el más caro del fichero: `confirmAndCreatePO`
      // crea la orden y sus líneas dentro de una transacción; si se cae, el
      // modal de confirmación del escáner celebraba una OC que no existe.
      this.logger.error(
        `Scanned invoice confirmation failed (supplier=${confirmDto?.supplier_id ?? 'n/a'}, items=${confirmDto?.items?.length ?? 0}, hasFile=${!!file}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
    }
  }

  @Post('cost-preview')
  @Permissions('store:orders:purchase_orders:read')
  async getCostPreview(@Body() dto: CostPreviewDto) {
    const result = await this.purchaseOrdersService.getCostPreview(dto);
    return this.responseService.success(result, 'Preview de costos obtenido');
  }

  // ===== Sub-resource routes (BEFORE :id to avoid route conflicts) =====

  @Get(':id/receptions')
  @Permissions('store:orders:purchase_orders:read')
  async getReceptions(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.getReceptions(+id);
    return this.responseService.success(
      result,
      'Recepciones obtenidas exitosamente',
    );
  }

  @Get(':id/cost-summary')
  @Permissions('store:orders:purchase_orders:read')
  async getCostSummary(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.getCostSummary(+id);
    return this.responseService.success(
      result,
      'Resumen de costos obtenido exitosamente',
    );
  }

  @Get(':id/timeline')
  @Permissions('store:orders:purchase_orders:read')
  async getTimeline(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.getTimeline(+id);
    return this.responseService.success(
      result,
      'Timeline obtenido exitosamente',
    );
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
        // Esta guarda ni siquiera estaba en un `catch`: devolvía el sobre
        // directamente, así que subir el formulario sin fichero respondía
        // **HTTP 201 Created** con `success:false`. `MEDIA_FILE_REQUIRED_001`
        // es el código ya registrado para esto (400), el mismo que usan el
        // resto de subidas del repo.
        throw new VendixHttpException(ErrorCodes.MEDIA_FILE_REQUIRED_001);
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
      // Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la clase.
      // El log conserva el nombre y el tamaño del fichero: un fallo de S3 no
      // los lleva, y sin ellos no se sabe qué adjunto quedó sin subir.
      this.logger.error(
        `Attachment upload failed (po=${id}, name=${file?.originalname ?? 'n/a'}, size=${file?.size ?? 0}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
    }
  }

  @Get(':id/attachments')
  @Permissions('store:orders:purchase_orders:read')
  async getAttachments(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.getAttachments(+id);
    return this.responseService.success(
      result,
      'Archivos adjuntos obtenidos exitosamente',
    );
  }

  @Delete(':id/attachments/:attachmentId')
  @Permissions('store:orders:purchase_orders:attach')
  async removeAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    const result =
      await this.purchaseOrdersService.removeAttachment(+attachmentId);
    return this.responseService.success(
      result,
      'Archivo adjunto eliminado exitosamente',
    );
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
      // Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la clase.
      // Un pago que se cae y responde 201 es dinero que el operador da por
      // registrado: el monto y el método son lo que permite reconciliarlo
      // contra el extracto, y la excepción no los lleva.
      this.logger.error(
        `Purchase payment registration failed (po=${id}, amount=${dto?.amount ?? 'n/a'}, method=${dto?.payment_method ?? 'n/a'}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
    }
  }

  @Get(':id/payments')
  @Permissions('store:orders:purchase_orders:read')
  async getPayments(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.getPayments(+id);
    return this.responseService.success(result, 'Pagos obtenidos exitosamente');
  }

  // ===== Main :id route =====

  @Get(':id')
  @Permissions('store:orders:purchase_orders:read')
  async findOne(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.findOne(+id);
    return this.responseService.success(
      result,
      'Orden de compra obtenida exitosamente',
    );
  }

  @Patch(':id')
  @Permissions('store:orders:purchase_orders:update')
  async update(
    @Param('id') id: string,
    @Body() updatePurchaseOrderDto: UpdatePurchaseOrderDto,
  ) {
    const result = await this.purchaseOrdersService.update(
      +id,
      updatePurchaseOrderDto,
    );
    return this.responseService.updated(
      result,
      'Orden de compra actualizada exitosamente',
    );
  }

  @Patch(':id/approve')
  @Permissions('store:orders:purchase_orders:approve')
  async approve(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.approve(+id);
    return this.responseService.success(
      result,
      'Orden de compra aprobada exitosamente',
    );
  }

  @Patch(':id/cancel')
  @Permissions('store:orders:purchase_orders:cancel')
  async cancel(@Param('id') id: string) {
    const result = await this.purchaseOrdersService.cancel(+id);
    return this.responseService.success(
      result,
      'Orden de compra cancelada exitosamente',
    );
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
      // QUI-486 — sin re-lanzar, la recepción fallida vuelve como HTTP 200 con
      // `success:false` y `po-receive-modal` la celebra con "Mercancia recibida
      // correctamente" sin que haya entrado una sola unidad. Ese es el origen
      // real de la "recepción silenciosa" del ticket.
      //
      // QUI-486 solo re-lanzaba `HttpException`, y por eso curaba los guards
      // (sobre-recepción, variantes) pero NO el caso peor: `receive()` corre
      // dentro de una transacción que mueve stock, escribe capas de costo y
      // emite eventos contables. Si ESA transacción se cae —un P2028, un
      // deadlock, un timeout— el error no es una `HttpException` y salía por
      // el envoltorio: 200, modal en verde, bodega intacta. Verificado en
      // caliente antes del cambio. Ahora se re-lanza crudo, sin filtrar tipo.
      this.logger.error(
        `Purchase order reception failed (po=${id}, lines=${dto?.items?.length ?? 0}, invoice=${dto?.supplier_invoice_number ?? 'n/a'}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
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
      // Ver la nota de CP-PURCHASE-TRANSPARENCY K en la cabecera de la clase.
      // El borrado es irreversible: un 200 sobre un borrado que no ocurrió
      // hace que el operador quite la orden de su lista mental y no vuelva.
      this.logger.error(
        `Purchase order delete failed (po=${id}): ${error?.message || error}`,
        error?.stack,
      );
      throw error;
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
        {
          dataUri,
          mimeType,
          context: { store_id, organization_id, user_id, request_id },
        },
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

  /**
   * QUI-647 — Configurar el plan de pago de una OC ya creada (PATCH).
   *
   * Permite desde el detalle de la OC elegir el modo (inmediato / abono
   * parcial / diferido / crédito con cuotas) y los montos/fechas asociados.
   * El service valida que la orden admita el cambio (no recibida/cerrada
   * y sin pagos reales que bloqueen) y aplica la matriz anti-doble-registro.
   */
  @Patch(':id/payment-plan')
  @Permissions('store:orders:purchase_orders:update')
  async configurePaymentPlan(
    @Param('id') id: string,
    @Body() dto: ConfigurePaymentPlanDto,
  ) {
    const order = await this.purchaseOrdersService.configurePaymentPlan(
      Number(id),
      dto,
      RequestContextService.getUserId(),
    );
    return this.responseService.created({
      data: order,
      message: 'Plan de pago actualizado exitosamente',
    });
  }
}
