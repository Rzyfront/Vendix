import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PurchaseOrdersService } from './purchase-orders.service';
import { InvoiceScannerService } from './invoice-scanner.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { PurchaseOrderQueryDto } from './dto/purchase-order-query.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { RegisterPaymentDto } from './dto/register-payment.dto';
import { AddAttachmentDto } from './dto/add-attachment.dto';
import { ConfirmScannedInvoiceDto } from './dto/scan-invoice.dto';
import { ResponseService } from '@common/responses/response.service';
import { VendixHttpException, ErrorCodes } from '@common/errors';

@Controller('store/orders/purchase-orders')
@UseGuards(PermissionsGuard)
export class PurchaseOrdersController {
  constructor(
    private readonly purchaseOrdersService: PurchaseOrdersService,
    private readonly invoiceScannerService: InvoiceScannerService,
    private readonly responseService: ResponseService,
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
  async scanInvoice(@UploadedFile() file: Express.Multer.File) {
    try {
      if (!file) {
        throw new VendixHttpException(ErrorCodes.INV_SCAN_NO_FILE);
      }
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!allowedTypes.includes(file.mimetype)) {
        throw new VendixHttpException(ErrorCodes.INV_SCAN_INVALID_FILE);
      }
      const result = await this.invoiceScannerService.scanInvoice(file);
      return this.responseService.success(result, 'Factura escaneada exitosamente');
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
      return this.responseService.success(result, 'Coincidencias de productos encontradas');
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
      const result = await this.invoiceScannerService.confirmAndCreatePO(confirmDto, file);
      return this.responseService.created(result, 'Orden de compra creada desde factura escaneada');
    } catch (error) {
      if (error instanceof VendixHttpException) throw error;
      return this.responseService.error(
        error.message || 'Error al confirmar la factura escaneada',
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
      const result = await this.purchaseOrdersService.addAttachment(+id, file, dto);
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
      const result = await this.purchaseOrdersService.removeAttachment(+attachmentId);
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
  async receive(
    @Param('id') id: string,
    @Body() dto: ReceivePurchaseOrderDto,
  ) {
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
}
