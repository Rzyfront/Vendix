import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';
import {
  CreatePlatformSalesInvoiceDto,
  CreatePlatformSupportDocumentDto,
  ListPlatformResolutionsQueryDto,
} from './dto/subscription-fiscal.dto';
import { PlatformInvoicingService } from './platform-invoicing.service';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase B.2a
 *
 * Controller de las rutas V1 del rail super-admin. Aislado del
 * `subscription-fiscal.controller.ts` (legacy SaaS) para minimizar
 * conflictos con sesiones que toquen el controller legacy.
 *
 * Rutas (todas bajo `/api/superadmin/subscriptions/fiscal/`):
 *   - POST /sales-invoices                      (FB-01)
 *   - POST /support-documents                   (FB-02)
 *   - POST /invoices/:id/send                  (FB-07) — :id = transmission.id
 *   - POST /invoices/:id/cancel                (FB-08)
 *   - GET  /invoices/:id/emit-readiness        (FB-06)
 *   - POST /transmissions/:id/retry            (FB-09, ya en legacy + extender)
 *   - GET  /resolutions-for-emission           (FB-05)
 *
 * Por qué :id aquí es transmission.id: el detail del rail plataforma
 * (PR #636) ya opera sobre transmissions. La facade de B.1 traduce
 * `invoiceId` → `transmissionId` cuando es necesario.
 */
@ApiBearerAuth()
@ApiTags('super-admin · platform-invoicing · MVP')
@Controller('superadmin/subscriptions/fiscal')
@UseGuards(PermissionsGuard)
export class PlatformInvoicingController {
  constructor(
    private readonly responseService: ResponseService,
    private readonly platformInvoicing: PlatformInvoicingService,
  ) {}

  /**
   * Crea una `sales_invoice` del rail plataforma. El `customer` del
   * body es un tenant (ADR-7: no es `users`). Emisor: la org plataforma
   * (Vendix Corp).
   */
  @Post('sales-invoices')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Crear y emitir sales_invoice del rail super-admin contra un tenant',
  })
  async createSalesInvoice(@Body() dto: CreatePlatformSalesInvoiceDto): Promise<any> {
    const data = await this.platformInvoicing.createSalesInvoice({
      organizationId: 0, // resuelto por getSettings() en la facade
      accountingEntityId: 0, // idem
      dianConfigurationId: 0, // idem
      actorUserId: 0, // relleno por el guard global cuando se wire el auth context
      dto,
    });
    return this.responseService.created(data, 'Sales invoice del rail plataforma creada');
  }

  /**
   * Crea un `support_document` (DSA) del rail plataforma. Misma
   * mecánica que `sales_invoice` pero con `document_type='support_document'`.
   */
  @Post('support-documents')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Crear y emitir support_document del rail super-admin contra un tenant',
  })
  async createSupportDocument(@Body() dto: CreatePlatformSupportDocumentDto): Promise<any> {
    const data = await this.platformInvoicing.createSupportDocument({
      organizationId: 0,
      accountingEntityId: 0,
      dianConfigurationId: 0,
      actorUserId: 0,
      dto,
    });
    return this.responseService.created(data, 'Support document del rail plataforma creado');
  }

  /**
   * Envia una transmision del rail plataforma a DIAN. `:id` es el id
   * de la fila `fiscal_transmissions`. La facade traduce a `invoice.id`.
   */
  @Post('invoices/:id/send')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({ summary: 'Emitir el documento platform a DIAN' })
  async sendInvoice(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const data = await this.platformInvoicing.sendInvoice({
      invoiceId: id,
      actorUserId: 0,
    });
    return this.responseService.success(data, 'Envio platform a DIAN aceptado');
  }

  /**
   * Cancela un documento platform en estado `draft`/`validated`.
   */
  @Post('invoices/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({ summary: 'Cancelar documento platform en draft/validated' })
  async cancelInvoice(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
  ): Promise<any> {
    const data = await this.platformInvoicing.cancelInvoice({
      invoiceId: id,
      actorUserId: 0,
      reason: body?.reason,
    });
    return this.responseService.success(data, 'Documento platform cancelado');
  }

  /**
   * Reporte de pre-validacion SIN emitir. Reusa la misma shape
   * `{blockers, warnings, computed}` que el rail tienda.
   */
  @Get('invoices/:id/emit-readiness')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Prevalidar el documento platform antes de emitir',
  })
  async emitReadiness(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const data = await this.platformInvoicing.evaluateReadiness({
      organizationId: 0,
      invoiceId: id,
    });
    return this.responseService.success(data, 'Prevalidacion platform ejecutada');
  }

  /**
   * Listado de resoluciones APTAS PARA EMISION. Filtra por
   * `document_type` requerido, `is_active=true`, vigente en la fecha.
   * Proyecta `technical_key_fingerprint` (nunca la ClTec plana).
   */
  @Get('resolutions-for-emission')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Resoluciones elegibles para emision por document_type',
  })
  async listResolutionsForEmission(
    @Query() query: { document_type: 'sales_invoice' | 'support_document' },
  ): Promise<any> {
    const data = await this.platformInvoicing.listResolutionsForEmission({
      organizationId: 0,
      accountingEntityId: 0,
      documentType: query.document_type,
    });
    return this.responseService.success(data, 'Resoluciones listadas');
  }
}
