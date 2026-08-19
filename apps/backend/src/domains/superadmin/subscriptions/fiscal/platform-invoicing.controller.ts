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
import { PlatformTenantsService } from './platform-tenants.service';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO de query para /customers/search. Acepta `kind` discriminador y
 * `q` libre. La respuesta usa la shape `TenantSearchResult` del helper.
 */
class SearchTenantsQueryDto {
  @IsOptional()
  @IsIn(['store', 'organization'])
  kind?: 'store' | 'organization';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

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
    private readonly tenants: PlatformTenantsService,
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

  /**
   * Busqueda de tenants para el TenantPicker. ADR-7: el cliente del
   * rail super-admin son stores u organizations, NO users. La respuesta
   * trae `id` compuesto (`store:<n>` u `org:<n>`) que el form envia al
   * backend como `{kind, tenant_id}`.
   *
   * Sin DI todavia — B.5. Cuando la facade tenga la org_id
   * resuelta via getSettings(), la pasamos por argumento.
   */
  @Get('customers/search')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Buscar tenants (stores/orgs) para el picker del rail plataforma',
  })
  async searchTenants(@Query() query: SearchTenantsQueryDto): Promise<any> {
    const data = await this.tenants.searchTenants(this.platformInvoicing['deps']?.prisma ?? null, {
      organizationId: 0,
      kind: query.kind ?? null,
      q: query.q ?? null,
    });
    return this.responseService.success(
      { data, meta: { q: query.q ?? null, kind: query.kind ?? null } },
      'Tenants listados',
    );
  }

  /**
   * Lookup directo de un tenant por id + kind. Retorna null si no
   * pertenece a la plataforma. Usado por el picker para la preview.
   */
  @Get('customers/:kind/:id')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Detalle fiscal de un tenant del rail plataforma',
  })
  async getTenantByKindAndId(
    @Param('kind') kind: 'store' | 'organization',
    @Param('id', ParseIntPipe) id: number,
  ): Promise<any> {
    const data = await this.tenants.getTenantByKindAndId(
      this.platformInvoicing['deps']?.prisma ?? null,
      { organizationId: 0, kind, id },
    );
    if (!data) {
      throw new VendixHttpException(
        // Reusar error code generico: el picker renderiza 'no encontrado'.
        // Para 404 se usa un codigo nuevo en Phase B.5.
        // Por ahora generamos un 404 limpio.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { code: 'TENANT_NOT_FOUND', httpStatus: 404 } as any,
        `Tenant ${kind}:${id} no encontrado en esta plataforma`,
      );
    }
    return this.responseService.success(data, 'Tenant retornado');
  }
}
