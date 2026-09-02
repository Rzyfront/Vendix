import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
// El MISMO DTO del riel de tiendas, no una copia: define que el cuerpo sólo
// SELECCIONA rangos por su par `(resolution_number, prefix)` y nunca acarrea la
// clave técnica. Un segundo DTO sería el sitio por donde esa regla se relaja.
import { ApplyNumberingRangesDto } from '../../../store/invoicing/dian-config/dto/apply-numbering-range.dto';
// Mismo criterio que el DTO de arriba: el de tiendas, no una copia. Define que
// `environment` es OPCIONAL y que ausente significa «el de la configuración», y
// una segunda declaración sería el sitio por donde los dos rieles empezarían a
// contestar cosas distintas a la misma pregunta.
import { QueryNumberingRangeDto } from '../../../store/invoicing/dian-config/dto/query-numbering-range.dto';
import { ResolutionScannerService } from '../../../store/invoicing/resolutions/resolution-scanner.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import {
  CreatePlatformInvoiceDto,
  CreatePlatformResolutionDto,
  ListPlatformResolutionsQueryDto,
  RetrySubscriptionFiscalDto,
  SubscriptionFiscalQueryDto,
  UpdatePlatformResolutionDto,
  UpsertSubscriptionFiscalConfigDto,
} from './dto/subscription-fiscal.dto';
import { SubscriptionFiscalService } from './subscription-fiscal.service';

/** Accepted by the resolution scanner; anything else is rejected before the AI. */
const SCAN_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
];

@ApiTags('Superadmin Subscriptions - Fiscal Billing')
@Controller('superadmin/subscriptions/fiscal')
@UseGuards(RolesGuard, PermissionsGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SubscriptionFiscalController {
  constructor(
    private readonly fiscalService: SubscriptionFiscalService,
    private readonly responseService: ResponseService,
    private readonly resolutionScanner: ResolutionScannerService,
  ) {}

  @Get('status')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Get platform DIAN fiscal billing status' })
  async getStatus(): Promise<any> {
    const status = await this.fiscalService.getStatus();
    return this.responseService.success(status, 'Fiscal billing status retrieved');
  }

  @Patch('config')
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Create or update platform DIAN fiscal billing config' })
  async upsertConfig(
    @Body() dto: UpsertSubscriptionFiscalConfigDto,
  ): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const status = await this.fiscalService.upsertConfig(dto, userId);
    return this.responseService.updated(status, 'Fiscal billing configuration saved');
  }

  @Post('certificate')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Upload platform DIAN certificate' })
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
  ): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const result = await this.fiscalService.uploadCertificate({
      file,
      password,
      userId,
    });
    return this.responseService.updated(result, 'Certificate uploaded');
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Test platform DIAN connection' })
  async testConnection(): Promise<any> {
    const userId = RequestContextService.getUserId() ?? null;
    const result = await this.fiscalService.testConnection(userId);
    return this.responseService.success(
      result,
      result.ok ? 'Test exitoso' : 'Test fallido',
    );
  }

  /**
   * Qué falta para que la plataforma emita en producción.
   *
   * Espeja `GET store/invoicing/dian-config/:id/production-readiness`. Este riel
   * tenía `habilitation_readiness` —«¿puedo empezar?»— y no este reporte —«¿puedo
   * salir a producción?»—, que es el que trae el chequeo `test_set_evidence`.
   * Solo lectura: no muta nada y se puede consultar en cualquier estado.
   */
  @Get('production-readiness')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({
    summary: 'Production readiness checklist for the platform DIAN config',
  })
  async getProductionReadiness(): Promise<any> {
    const report = await this.fiscalService.getProductionReadiness();
    return this.responseService.success(
      report,
      'Production readiness retrieved',
    );
  }

  /**
   * Pasa la plataforma a producción, con la guarda completa de readiness.
   *
   * Es la ÚNICA vía. `PATCH config` rechaza `environment: 'production'` desde que
   * se descubrió que volteaba el ambiente de la configuración —el que usa el
   * proveedor para firmar y transmitir— sin comprobar que la DIAN hubiera
   * aprobado el set de habilitación.
   */
  @Post('promote-to-production')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Promote the platform DIAN config to production' })
  async promoteToProduction(): Promise<any> {
    const result = await this.fiscalService.promoteToProduction();
    return this.responseService.updated(
      result,
      'Plataforma promovida a producción',
    );
  }

  // ─────────────────────────────────────────────────────────
  // DIAN test set (habilitación) for the platform's own NIT
  // ─────────────────────────────────────────────────────────

  /**
   * Encola el set y responde 202 con el id del job.
   *
   * Era sincrónico y tardaba ~107 s; nginx corta el `location /` de la API a los
   * 60 s, así que los envíos del 2026-08-05 devolvieron 504 al navegador mientras
   * el backend los completaba. El mensaje de éxito ahora dice «encolado», no
   * «enviado», porque en este punto todavía no salió nada hacia la DIAN.
   */
  @Post('test-set')
  @HttpCode(HttpStatus.ACCEPTED)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Enqueue the 50-document DIAN test set for the platform NIT' })
  @ApiQuery({
    name: 'smoke',
    required: false,
    description:
      'Vía de humo: emite UNA factura y gasta UN consecutivo, para comprobar si la DIAN ingiere el envío sin quemar los 50. No habilita.',
  })
  @ApiQuery({
    name: 'validate',
    required: false,
    description:
      'Vía de validación: emite el MISMO documento y lo somete a SendBillSync, que responde en la misma llamada con IsValid y la lista completa de reglas violadas. No lleva testSetId, así que no puede rechazar el set ni consumir un intento de habilitación.',
  })
  async runTestSet(
    @Query('smoke') smoke?: string,
    @Query('validate') validate?: string,
  ): Promise<any> {
    const isSmoke = smoke === 'true' || smoke === '1';
    const isValidateOnly = validate === 'true' || validate === '1';
    const result = await this.fiscalService.runTestSet({
      smoke: isSmoke,
      validate_only: isValidateOnly,
    });
    return this.responseService.success(
      result,
      isValidateOnly
        ? 'Validación encolada: 1 documento por SendBillSync, sin enviar al set de pruebas'
        : isSmoke
          ? 'Prueba de humo encolada: 1 documento, 1 consecutivo'
          : 'Set de pruebas encolado: se está construyendo y firmando',
    );
  }

  @Get('test-set/job/:jobId')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Poll the async platform test-set submission job' })
  async getTestSetJobStatus(@Param('jobId') jobId: string): Promise<any> {
    const result = await this.fiscalService.getTestSetJobStatus(jobId);
    return this.responseService.success(result, 'Estado del envío');
  }

  @Get('test-set/status')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Re-poll the DIAN verdict for the platform test set' })
  async checkTestSetStatus(): Promise<any> {
    const result = await this.fiscalService.checkTestSetStatus();
    return this.responseService.success(result, 'Estado del set de pruebas consultado');
  }

  @Get('test-set/documents')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({
    summary:
      'Ask DIAN per-document (by CUFE) whether the test set documents were registered',
  })
  async getTestSetDocuments(
    @Query('sample_size') sampleSize?: string,
  ): Promise<any> {
    const parsed = sampleSize ? Number(sampleSize) : undefined;
    const result = await this.fiscalService.getTestSetDocuments(
      Number.isFinite(parsed) && parsed! > 0 ? parsed : undefined,
    );
    return this.responseService.success(result, 'Diagnóstico por documento');
  }

  @Post('test-set/abandon')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Discard the stuck platform test set so a new one can be sent' })
  async abandonTestSet(): Promise<any> {
    const result = await this.fiscalService.abandonTestSet();
    return this.responseService.success(result, 'Lote descartado');
  }

  // ─────────────────────────────────────────────────────────
  // Numeración autorizada por la DIAN para el NIT de la plataforma
  // ─────────────────────────────────────────────────────────

  /**
   * Rangos que la DIAN tiene AUTORIZADOS, cruzados con lo guardado.
   *
   * Espeja `GET store/invoicing/dian-config/:id/numbering-ranges`, con la MISMA
   * forma de ruta a propósito: el panel compartido
   * (`app-dian-numbering-range-panel`) arma la URL como
   * `{basePath}/dian-config/{configId}/numbering-ranges`, así que reapuntar
   * `DIAN_API_CONTEXT` a este riel es todo lo que hace falta para montarlo sin
   * tocarlo.
   *
   * `:read` y no `:write`: no escribe nada, no emite documentos y no reserva un
   * solo consecutivo. Es una consulta al web service `GetNumberingRange`.
   *
   * LA ClTec NO VIAJA. La respuesta de la DIAN la trae en claro; la comparación
   * contra la guardada ocurre en el servidor y de ella sólo sale
   * `technical_key_matches`.
   *
   * ── `?environment=` NO CAMBIA EL PERMISO ───────────────────────────────────
   *
   * Sigue siendo `:read`. El ambiente no altera QUÉ se lee ni de quién —este
   * riel opera sobre UNA sola configuración, la de la plataforma, y
   * `requirePlatformDianConfig` rechaza cualquier otro id— sino únicamente a qué
   * catálogo de la DIAN se dirige la pregunta. Y hace falta aquí por lo mismo
   * que en tiendas: la resolución y la ClTec con las que Vendix factura sus
   * propias suscripciones se seguían tecleando del portal MUISCA mientras la
   * consulta no pudiera mirar el catálogo de producción desde habilitación.
   *
   * Ausente ⇒ el ambiente de la configuración, que es el comportamiento previo.
   */
  @Get('dian-config/:id/numbering-ranges')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({
    summary: 'DIAN-authorized numbering ranges for the platform NIT vs. stored',
  })
  @ApiQuery({
    name: 'environment',
    required: false,
    enum: ['test', 'production'],
    description:
      'Catálogo de la DIAN al que se consulta. Ausente: el de la configuración.',
  })
  async getNumberingRanges(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryNumberingRangeDto,
  ): Promise<any> {
    const result = await this.fiscalService.queryPlatformNumberingRanges(
      id,
      query.environment,
    );
    return this.responseService.success(
      result,
      'Rangos de numeración consultados a la DIAN',
    );
  }

  /**
   * Trae de la DIAN a `invoice_resolutions` los rangos SELECCIONADOS.
   *
   * 200 aunque algún elemento falle, igual que el riel de tiendas: el estado HTTP
   * describe la PETICIÓN, y la petición se atendió —la consulta a la DIAN se hizo
   * y cada rango marcado obtuvo su desenlace en `results[].ok`—. Un 4xx porque uno
   * de veinte no entró haría que el cliente descartara la única constancia de
   * cuáles diecinueve SÍ quedaron escritos.
   *
   * Sin `try/catch`: lo que invalida el lote entero —configuración ajena, la DIAN
   * sin responder, cuerpo mal formado— sube al `AllExceptionsFilter`, que emite el
   * estado y el `error_code` reales.
   *
   * `environment` en el cuerpo tampoco cambia el permiso: sigue siendo `:write`
   * porque sigue escribiendo lo mismo —las resoluciones de la plataforma— y sólo
   * cambia a qué catálogo de la DIAN se le piden los valores. La fila resultante
   * no habilita nada por sí sola: `assertElectronicEmissionLive` exige
   * `environment === 'production' && enablement_status === 'enabled'` sobre la
   * CONFIGURACIÓN, y esta ruta no toca ninguna de esas dos columnas.
   */
  @Post('dian-config/:id/numbering-ranges/apply')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({
    summary: 'Sync the selected DIAN-authorized ranges into platform resolutions',
  })
  async applyNumberingRanges(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyNumberingRangesDto,
  ): Promise<any> {
    const result = await this.fiscalService.applyPlatformNumberingRanges(
      id,
      dto,
    );
    return this.responseService.updated(
      result,
      'Numeración sincronizada con la DIAN',
    );
  }

  @Get('transmissions')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'List platform SaaS fiscal transmissions' })
  async listTransmissions(
    @Query() query: SubscriptionFiscalQueryDto,
  ): Promise<any> {
    const result = await this.fiscalService.listTransmissions(query);
    return this.responseService.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
      'Fiscal transmissions retrieved',
    );
  }

  /**
   * ¿Puede emitirse esta factura, SIN emitirla?
   *
   * Es un `GET` y una lectura: no crea transmisión, no asigna consecutivo, no
   * cambia ningún estado. Existe para que nadie tenga que gastar un número
   * autorizado para descubrir que faltaba un dato — el 17/08/2026 eso fue
   * exactamente lo que pasó con la primera factura de suscripción.
   *
   * Devuelve `blockers[]` con el `fix` de cada uno, `warnings[]`, los importes
   * que el XML va a declarar (`computed`) y el consecutivo que se asignaría
   * (`document_number_preview`). Espejo de `GET /store/invoicing/:id/emit-readiness`.
   */
  // Renombrado a `/saas-invoices/:id/emit-readiness` para no colisionar con
  // `PlatformInvoicingController.invoices/:id/emit-readiness` (FB-06), que
  // cubre el rail plataforma. NestJS resuelve por orden de registro y este
  // controller se registra antes, así que la ruta duplicada le ganaba al
  // nuevo rail plataforma. LaSaaS sigue funcionando bajo el nuevo path.
  @Get('saas-invoices/:id/emit-readiness')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({
    summary:
      'Check whether a SaaS invoice can be issued electronically, without issuing it',
  })
  async invoiceEmitReadiness(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<any> {
    const result = await this.fiscalService.getEmitReadiness(id);
    return this.responseService.success(result, 'Fiscal emit readiness computed');
  }

  @Post('invoices/:id/issue')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Manually issue a paid SaaS invoice electronically' })
  async issueInvoice(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const result = await this.fiscalService.issueForInvoice(id, {
      manual: true,
      source: 'manual',
    });
    return this.responseService.success(result, 'Fiscal invoice issue requested');
  }

  @Post('transmissions/:id/retry')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Retry a SaaS fiscal transmission' })
  async retryTransmission(
    @Param('id', ParseIntPipe) id: number,
    @Body() _dto: RetrySubscriptionFiscalDto,
  ): Promise<any> {
    const result = await this.fiscalService.retryTransmission(id);
    return this.responseService.success(result, 'Fiscal transmission retry requested');
  }

  @Post('sweep')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({
    summary: 'Sweep paid SaaS invoices without an accepted fiscal transmission',
  })
  async sweepPendingInvoices(): Promise<any> {
    const result = await this.fiscalService.sweepPendingInvoices();
    return this.responseService.success(result, 'Fiscal sweep completed');
  }

  @Get('invoices/:id')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Get SaaS invoice detail with transmissions and evidences' })
  async getSubscriptionInvoiceDetail(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const data = await this.fiscalService.getSubscriptionInvoiceDetail(id);
    if (!data) {
      // Un id inexistente no es un error de validación del cliente: la URL
      // señala un documento que no está. 404, no 400.
      throw new NotFoundException('Subscription invoice not found');
    }
    return this.responseService.success(data, 'Subscription invoice detail retrieved');
  }

  /**
   * Detalle de platform-invoice en ruta separada. Aquí se monta el id de
   * la `fiscal_transmissions` fila, no el de `subscription_invoices`:
   * las dos tablas son secuencias independientes y compartir `/invoices/:id`
   * daba id colisión (dos facturas con mismo número, una de cada riel).
   */
  @Get('platform-invoices/:id')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Get platform invoice detail by transmission id' })
  async getPlatformInvoiceDetail(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const data = await this.fiscalService.getPlatformInvoiceDetail(id);
    if (!data) {
      throw new NotFoundException('Platform invoice not found');
    }
    return this.responseService.success(data, 'Platform invoice detail retrieved');
  }

  /**
   * XML firmado de la factura de plataforma. Ruta propia y no un campo del
   * detalle: el documento pesa entre 100 y 500 KB y el detalle se abre para
   * mirar estados, no para descargar la prueba ante la DIAN.
   *
   * Se responde `application/xml` en crudo, sin el sobre `ResponseService`:
   * el consumidor es una descarga del navegador, y envolver el XML en JSON
   * obligaría al cliente a desescapar una cadena de medio megabyte para
   * volver a obtener el mismo archivo.
   */
  @Get('platform-invoices/:id/xml')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'Download the signed XML of a platform invoice' })
  async getPlatformInvoiceXml(
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.fiscalService.getPlatformInvoiceXml(id);
    if (!result) {
      // Sin XML no hay documento que descargar. Un 200 con cuerpo vacío haría
      // que el navegador guardara un archivo de 0 bytes con nombre de factura.
      throw new NotFoundException(
        'Esta factura de plataforma todavía no tiene XML firmado.',
      );
    }
    const filename = `${result.document_number.replace(/[^A-Za-z0-9_-]/g, '') || `factura-${id}`}.xml`;
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.xml);
  }

  @Post('invoices')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({
    summary: 'Create a platform invoice (services not tied to subscription)',
  })
  async createPlatformInvoice(@Body() dto: CreatePlatformInvoiceDto): Promise<any> {
    const result = await this.fiscalService.createPlatformInvoice(dto);
    return this.responseService.created(result, 'Platform invoice created');
  }

  @Get('resolutions')
  @Permissions('superadmin:subscriptions:fiscal:read')
  @ApiOperation({ summary: 'List platform DIAN invoice resolutions' })
  async listResolutions(
    @Query() query: ListPlatformResolutionsQueryDto,
  ): Promise<any> {
    const data = await this.fiscalService.listResolutions(query);
    return this.responseService.success(data, 'Platform resolutions retrieved');
  }

  /**
   * Reads a resolution document and answers the extracted fields. Persists
   * nothing: the super-admin reviews the result and then calls
   * `POST resolutions` or `PATCH resolutions/:id`, so an OCR slip can never
   * reach the platform numbering by itself.
   */
  @Post('resolutions/scan')
  @Permissions('superadmin:subscriptions:fiscal:write')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({
    summary:
      'Extract DIAN resolution fields from a photo/PDF (returns data, persists nothing)',
  })
  async scanResolution(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<any> {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.RESOLUTION_SCAN_NO_FILE);
    }
    if (!SCAN_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      throw new VendixHttpException(ErrorCodes.RESOLUTION_SCAN_INVALID_FILE);
    }

    const result = await this.resolutionScanner.scanResolutionDocument(file);
    return this.responseService.success(result, 'Platform resolution scanned');
  }

  @Post('resolutions')
  @HttpCode(HttpStatus.CREATED)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Create a platform DIAN invoice resolution' })
  async createResolution(
    @Body() dto: CreatePlatformResolutionDto,
  ): Promise<any> {
    const result = await this.fiscalService.createResolution(dto);
    return this.responseService.created(result, 'Platform resolution created');
  }

  @Patch('resolutions/:id')
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({ summary: 'Update a platform DIAN invoice resolution' })
  async updateResolution(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePlatformResolutionDto,
  ): Promise<any> {
    const result = await this.fiscalService.updateResolution(id, dto);
    return this.responseService.updated(result, 'Platform resolution updated');
  }

  @Delete('resolutions/:id')
  @HttpCode(HttpStatus.OK)
  @Permissions('superadmin:subscriptions:fiscal:write')
  @ApiOperation({
    summary:
      'Delete a pristine platform DIAN resolution (used ones must be deactivated)',
  })
  async deleteResolution(@Param('id', ParseIntPipe) id: number): Promise<any> {
    const result = await this.fiscalService.deleteResolution(id);
    return this.responseService.success(result, 'Platform resolution deleted');
  }
}
