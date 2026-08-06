import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';

import { ErrorCodes, VendixHttpException } from '@common/errors';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { ResolutionScannerService } from '../../../store/invoicing/resolutions/resolution-scanner.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import {
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
