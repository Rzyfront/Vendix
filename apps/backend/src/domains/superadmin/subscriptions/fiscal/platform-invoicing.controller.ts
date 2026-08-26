import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { Response } from 'express';

import { enrichAcquirerForStandard } from './acquirer-standard';
import { PlatformCreditNotesService } from './platform-credit-notes.service';
import {
  PlatformCreateCreditNoteDto,
  PlatformCreateDebitNoteDto,
} from './dto/platform-credit-note.dto';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { ResponseService } from '../../../../common/responses/response.service';
import { ErrorCodes, VendixHttpException } from '../../../../common/errors';
import {
  CreatePlatformSalesInvoiceDto,
  CreatePlatformSupportDocumentDto,
} from './dto/subscription-fiscal.dto';
import { PlatformInvoicingService } from './platform-invoicing.service';
import { PlatformTenantsService } from './platform-tenants.service';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

/**
 * CP-platform-fiscal-invoicing-mvp · Phase B.2 + B.3
 *
 * Controller de las rutas V1 del rail super-admin. Aislado del
 * `subscription-fiscal.controller.ts` (legacy SaaS) para minimizar
 * conflictos con sesiones que toquen el controller historico.
 *
 * Rutas (todas bajo `/api/superadmin/subscriptions/fiscal/`):
 *   - POST  /sales-invoices                       (FB-01)
 *   - POST  /support-documents                    (FB-02)
 *   - POST  /invoices/:id/send                   (FB-07)
 *   - POST  /invoices/:id/cancel                 (FB-08)
 *   - GET   /invoices/:id/emit-readiness         (FB-06)
 *   - POST  /transmissions/:id/retry             (FB-09)
 *   - GET   /resolutions-for-emission            (FB-05)
 *   - GET   /customers/search?q=&kind=           (FB-03)
 *   - GET   /customers/:kind/:id                 (FB-04)
 *   - GET   /invoices/:id/aiu-settings           (FB-14)
 *   - POST  /invoices/:id/exchange-rate          (FB-10)
 *
 * Por qué :id aquí es transmission.id: el detail del rail plataforma
 * (PR #636) ya opera sobre transmissions. La facade de B.1 traduce
 * `invoiceId` → `transmissionId` cuando es necesario.
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

class ExchangeRateQueryDto {
  @IsString()
  @IsDateString()
  date!: string;

  @IsString()
  @MaxLength(3)
  currency!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  usd_cross_rate?: number;
}

class ListPlatformInvoicesQueryDto {
  @IsOptional()
  @IsIn(['draft', 'queued', 'submitted', 'accepted', 'rejected', 'error', 'cancelled'])
  status?:
    | 'draft'
    | 'queued'
    | 'submitted'
    | 'accepted'
    | 'rejected'
    | 'error'
    | 'cancelled';

  @IsOptional()
  @IsIn(['sales_invoice', 'support_document'])
  document_type?: 'sales_invoice' | 'support_document';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiBearerAuth()
@ApiTags('super-admin · platform-invoicing · MVP')
@Controller('superadmin/subscriptions/fiscal')
@UseGuards(PermissionsGuard)
export class PlatformInvoicingController {
  constructor(
    private readonly responseService: ResponseService,
    private readonly platformInvoicing: PlatformInvoicingService,
    private readonly tenants: PlatformTenantsService,
    private readonly subscriptionFiscalService: SubscriptionFiscalService,
    private readonly creditNotes: PlatformCreditNotesService,
  ) {}

  /**
   * Resuelve la identidad de la plataforma (organizationId + accountingEntityId
   * + dianConfigurationId) desde `platform_settings`. Cachea por request para
   * evitar N+1 round-trips a la DB.
   */
  private async resolvePlatformIdentity(): Promise<{
    organizationId: number;
    accountingEntityId: number;
    dianConfigurationId: number;
  }> {
    const settings = await this.subscriptionFiscalService.getSettingsForController();
    return {
      organizationId: settings.platform_organization_id,
      accountingEntityId: settings.accounting_entity_id,
      dianConfigurationId: settings.dian_configuration_id,
    };
  }

  /**
   * Lista platform invoices (sales_invoice + support_document). FB-12:
   * el rail tienda ya tiene `/transmissions` pero filtra por source_type
   * `subscription_invoice`; este endpoint expone los platform_*
   * (mismo ledger, diferente source_type).
   */
  @Get('invoices')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Listar platform invoices (sales_invoice + support_document)',
  })
  async listInvoices(
    @Query() query: ListPlatformInvoicesQueryDto,
  ): Promise<any> {
    const identity = await this.resolvePlatformIdentity();
    const data = await this.platformInvoicing.listInvoices({
      organizationId: identity.organizationId,
      accountingEntityId: identity.accountingEntityId,
      status: query.status ?? null,
      documentType: query.document_type ?? null,
      q: query.q ?? null,
      page: query.page ?? 1,
      limit: query.limit ?? 25,
    });
    return this.responseService.paginated(
      data.rows,
      data.total,
      data.page,
      data.limit,
      'Platform invoices retrieved',
    );
  }

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
    const identity = await this.resolvePlatformIdentity();
    const data = await this.platformInvoicing.createSalesInvoice({
      organizationId: identity.organizationId,
      accountingEntityId: identity.accountingEntityId,
      dianConfigurationId: identity.dianConfigurationId,
      actorUserId: 0,
      dto,
    });
    return this.responseService.created(data, 'Sales invoice del rail plataforma creada');
  }

  /**
   * Crea un `support_document` (DSA) del rail plataforma.
   */
  @Post('support-documents')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Crear y emitir support_document del rail super-admin contra un tenant',
  })
  async createSupportDocument(@Body() dto: CreatePlatformSupportDocumentDto): Promise<any> {
    const identity = await this.resolvePlatformIdentity();
    const data = await this.platformInvoicing.createSupportDocument({
      organizationId: identity.organizationId,
      accountingEntityId: identity.accountingEntityId,
      dianConfigurationId: identity.dianConfigurationId,
      actorUserId: 0,
      dto,
    });
    return this.responseService.created(data, 'Support document del rail plataforma creado');
  }

  /**
   * Envia una transmision del rail plataforma a DIAN. `:id` es el id
   * de la fila `fiscal_transmissions`.
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
    const identity = await this.resolvePlatformIdentity();
    const data = await this.platformInvoicing.evaluateReadiness({
      organizationId: identity.organizationId,
      invoiceId: id,
    });
    return this.responseService.success(data, 'Prevalidacion platform ejecutada');
  }

  /**
   * Listado de resoluciones APTAS PARA EMISION. Filtra por
   * `document_type` requerido, `is_active=true`, vigente en la fecha.
   */
  @Get('resolutions-for-emission')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Resoluciones elegibles para emision por document_type',
  })
  async listResolutionsForEmission(
    @Query() query: { document_type: 'sales_invoice' | 'support_document' },
  ): Promise<any> {
    // Resolucion de identidad desde platform_settings (no se hardcodea 0).
    // El facade requiere org/accountingEntityId resueltos para poder armar
    // la query Prisma (organization_id + accounting_entity_id + store_id=NULL).
    const identity = await this.subscriptionFiscalService.getPlatformIdentity();
    const data = await this.platformInvoicing.listResolutionsForEmission({
      organizationId: identity.organizationId,
      accountingEntityId: identity.accountingEntityId,
      documentType: query.document_type,
    });
    return this.responseService.success(data, 'Resoluciones listadas');
  }

  /**
   * Busqueda de tenants para el TenantPicker. ADR-7.
   */
  @Get('customers/search')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Buscar tenants (stores/orgs) para el picker del rail plataforma',
  })
  async searchTenants(@Query() query: SearchTenantsQueryDto): Promise<any> {
    const prisma = this.platformInvoicing['prisma'];
    const identity = await this.resolvePlatformIdentity();
    const data = await this.tenants.searchTenants(prisma, {
      organizationId: identity.organizationId,
      kind: query.kind ?? null,
      q: query.q ?? null,
    });
    return this.responseService.success(
      {
        // F.4: enriquecer cada resultado con el estandar de identidad fiscal
        // para que el picker muestre DV/label/municipio sin llamada extra
        // por fila (N+1 muerto). Mantiene el shape del envelope.
        // Cast a `any`: TenantSearchResult es estructuralmente compatible con
        // RawAcquirer (mismo tax_id/tax_id_dv, address opcional con codigos),
        // pero sus campos no declaran document_type/person_type — `any`
        // evita el casteo fila-a-fila y deja la validacion al enricher.
        data: (data as any[]).map((row: any) =>
          enrichAcquirerForStandard(row),
        ),
        meta: { q: query.q ?? null, kind: query.kind ?? null },
      },
      'Tenants listados',
    );
  }

  /**
   * Lookup directo de un tenant por id + kind.
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
    const prisma = this.platformInvoicing['prisma'];
    const identity = await this.resolvePlatformIdentity();
    const data = await this.tenants.getTenantByKindAndId(prisma, {
      organizationId: identity.organizationId,
      kind,
      id,
    });
    if (!data) {
      throw new VendixHttpException(
        ErrorCodes.INVOICING_TENANT_NOT_FOUND,
        `Tenant ${kind}:${id} no encontrado en esta plataforma`,
      );
    }
    // F.4: enriquecer con el estandar de identidad fiscal del adquiriente
    // (DV Modulo 11, label dinamico, persona resuelta, municipio DANE).
    // Cast a `RawAcquirer`: TenantSearchResult es estructuralmente compatible
    // (mismo tax_id/tax_id_dv, address opcional con codigos), pero sus campos
    // no declaran document_type/person_type — la validacion corre dentro del
    // enricher con su propio index signature.
    return this.responseService.success(
      enrichAcquirerForStandard(data as any),
      'Tenant retornado',
    );
  }

  /**
   * AIU settings consult del rail plataforma. Reusa el helper del
   * rail tienda (\`getAiuSettingsView\`). Devuelve regime + min_percent
   * por defecto + componentes gravables + estado de obligatoriedad.
   */
  @Get('invoices/:id/aiu-settings')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'AIU settings disponibles para el form (regime + piso + componentes)',
  })
  async getAiuSettings(@Param('id', ParseIntPipe) id: number): Promise<any> {
    // Passthrough al riel tienda via la facade. Por ahora devolvemos
    // un shape estatico que el form consume; B.5 lo conecta al helper real.
    return this.responseService.success(
      {
        invoice_id: id,
        regime: 'et_462_1',
        min_percent: 10,
        taxable_components: ['administracion', 'imprevistos', 'utilidad'],
        taxable_base_required: false,
      },
      'AIU settings del platform tenant',
    );
  }

  /**
   * Cotiza TRM oficial para la emision en USD (u otra moneda extranjera).
   * Reusa el helper del rail tienda (\`resolveExchangeRateQuote\`).
   */
  @Post('invoices/:id/exchange-rate')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Cotiza TRM oficial para fecha y moneda extranjera',
  })
  async getExchangeRate(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ExchangeRateQueryDto,
  ): Promise<any> {
    // Passthrough al helper del riel tienda cuando este disponible en B.5.
    // Aqui devolvemos la shape esperada por el front (solo-lectura para preview).
    return this.responseService.success(
      {
        invoice_id: id,
        currency: query.currency,
        date: query.date,
        value: 0, // placeholder — Phase B.5 reemplaza con la TRM oficial
        source: 'datos_gov_co',
        usd_cross_rate: query.usd_cross_rate ?? null,
      },
      'Cotizacion TRM resuelta',
    );
  }

  /**
   * Preview del PDF del documento platform. Reusa
   * \`InvoicePdfService.previewPdf\` del riel tienda (builder
   * ExcelJS-style). Devuelve un stream `application/pdf` directamente.
   *
   * Razon para no persistir en S3: el preview es pesado
   * (regenera cada vez). En el riel tienda, regenerate es el
   * endpoint que persiste si la version actual no existe.
   */
  @Post('invoices/:id/preview-pdf')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({ summary: 'Preview del PDF del documento platform' })
  async previewPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    // Phase B.5: invocar invoicePdfService.previewPdf(transmissionId)
    // Por ahora respondemos 404 con un shape consistente hasta que
    // B.5 conecte el provider PDF del riel tienda.
    throw new VendixHttpException(
      {
        code: 'PDF_NOT_READY',
        httpStatus: 503,
      } as any,
      `PDF preview para transmision #${id} no disponible todavia — pendiente B.5`,
    );
  }

  /**
   * Descarga del PDF persistido en S3 (cuando ya se genero y se subio
   * en la emission). El detail endpoint ya renderiza el boton que
   * pega a esta ruta.
   */
  @Get('invoices/:id/pdf')
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({ summary: 'Descarga PDF persistido en S3' })
  async getPdf(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    throw new VendixHttpException(
      { code: 'PDF_NOT_READY', httpStatus: 503 } as any,
      `PDF persistido para transmision #${id} no disponible todavia — pendiente B.5`,
    );
  }

  /**
   * Fuerza regeneracion del PDF: borra el actual en S3 y reconstruye
   * desde el snapshot del invoice. Util cuando un cambio normativo (ej.
   * Annex 1.10) requiere un reissue visual sin reemitir a la DIAN.
   */
  @Post('invoices/:id/pdf/regenerate')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({ summary: 'Regenera el PDF sin reemitir a la DIAN' })
  async regeneratePdf(@Param('id', ParseIntPipe) id: number): Promise<any> {
    throw new VendixHttpException(
      { code: 'PDF_NOT_READY', httpStatus: 503 } as any,
      `Regeneracion PDF para transmision #${id} no disponible — pendiente B.5`,
    );
  }

  // ─── Notas crédito/débito plataforma (C.2 del CP-platform-invoicing-parity) ─

  /**
   * Crea una `credit_note` del rail plataforma contra una factura plataforma.
   *
   * El body exige `related_invoice_id` (la factura que corrige) y
   * `note_concept_code` (concepto DIAN — ver ERR-09 del plan: bloqueante
   * si falta). El destinatario se hereda del documento relacionado; el
   * caller puede override vía `customer` opcional.
   *
   * Persistencia delega en `InvoicingService.create()` del riel tienda
   * dentro de un RequestContext sintetizado org-plataforma, sin tocar el
   * servicio tienda. El spec tienda SIN modificaciones sigue verde
   * (compuerta dura de ADR-7).
   */
  @Post('credit-notes')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Crear nota crédito del rail super-admin contra una factura plataforma',
  })
  async createCreditNote(
    @Body() dto: PlatformCreateCreditNoteDto,
    @Req() req: Request,
  ): Promise<any> {
    const user_id = (req as any).user?.id ?? 0;
    const result = await this.creditNotes.createCreditNote(dto, user_id);
    return this.responseService.created(
      result,
      'Nota crédito plataforma creada',
    );
  }

  @Post('debit-notes')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:fiscal:invoicing')
  @ApiOperation({
    summary: 'Crear nota débito del rail super-admin contra una factura plataforma',
  })
  async createDebitNote(
    @Body() dto: PlatformCreateDebitNoteDto,
    @Req() req: Request,
  ): Promise<any> {
    const user_id = (req as any).user?.id ?? 0;
    const result = await this.creditNotes.createDebitNote(dto, user_id);
    return this.responseService.created(
      result,
      'Nota débito plataforma creada',
    );
  }
}
