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
  UseInterceptors,
  UploadedFile,
  ParseIntPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DianConfigService } from './dian-config.service';
import { DianTestService } from './dian-test.service';
import { ResponseService } from '../../../../common/responses/response.service';
import { S3Service } from '../../../../common/services/s3.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ManualCertificateIssuerAdapter } from './certificates/manual-certificate-issuer.adapter';
import { buildDianCertificateS3Key } from './certificates/certificate-s3-key.util';

@Controller('store/invoicing/dian-config')
export class DianConfigController {
  constructor(
    private readonly dian_config_service: DianConfigService,
    private readonly dian_test_service: DianTestService,
    private readonly certificate_adapter: ManualCertificateIssuerAdapter,
    private readonly response_service: ResponseService,
    private readonly s3_service: S3Service,
  ) {}

  @Get('dashboard')
  @Permissions('invoicing:read')
  async getDashboard() {
    const result = await this.dian_config_service.getDashboard();
    return this.response_service.success(result);
  }

  @Get()
  @Permissions('invoicing:read')
  async getConfigs() {
    const result = await this.dian_config_service.getConfigs();
    return this.response_service.success(result);
  }

  @Get('audit-logs')
  @Permissions('invoicing:read')
  async getAuditLogs(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('config_id') config_id?: string,
  ) {
    const result = await this.dian_config_service.getAuditLogs(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      config_id ? parseInt(config_id, 10) : undefined,
    );
    return this.response_service.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Whether this store is actually issuing electronic invoices right now.
   * Declared BEFORE `@Get(':id')` on purpose: Nest matches in declaration order,
   * so the param route would otherwise swallow this path and ParseIntPipe would
   * reject it with a 400.
   */
  @Get('emission-status')
  @Permissions('invoicing:read')
  async getEmissionStatus() {
    const result = await this.dian_config_service.getEmissionStatus();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async getConfigById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.getConfigById(id);
    return this.response_service.success(result);
  }

  @Post()
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateDianConfigDto) {
    const result = await this.dian_config_service.create(dto);
    return this.response_service.success(result);
  }

  @Patch(':id')
  @Permissions('invoicing:write')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateDianConfigDto,
  ) {
    const result = await this.dian_config_service.update(id, dto);
    return this.response_service.success(result);
  }

  @Delete(':id')
  @Permissions('invoicing:write')
  async deleteConfig(@Param('id', ParseIntPipe) id: number) {
    await this.dian_config_service.deleteConfig(id);
    return this.response_service.success(null, 'Configuration deleted');
  }

  @Patch(':id/set-default')
  @Permissions('invoicing:write')
  async setDefault(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.setDefault(id);
    return this.response_service.success(result);
  }

  /**
   * Upload a .p12 certificate file.
   * Validates the certificate and stores it encrypted.
   */
  @Post('upload-certificate')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  async uploadCertificate(
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
    @Body('config_id') config_id: string,
  ) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001);
    }

    if (!password) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_002,
        'Certificate password is required',
      );
    }

    const config_id_int = parseInt(config_id, 10);
    const config = await this.dian_config_service.getConfigById(config_id_int);

    const validation = await this.certificate_adapter.validateCertificate({
      p12_buffer: file.buffer,
      password,
      expected_tax_id: config.nit,
      expected_dv: config.nit_dv,
    });

    if (!validation.valid) {
      if (validation.error?.includes('tax identifier')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_004);
      }
      if (validation.error?.includes('expired')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_003);
      }
      if (validation.error?.includes('password')) {
        throw new VendixHttpException(ErrorCodes.DIAN_CERT_002);
      }
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001, validation.error);
    }

    // Clave con el dueño en el prefijo: sin ella el bucket no dice de quién es
    // cada certificado ni permite purgar los de un tenant dado de baja.
    const s3_key = buildDianCertificateS3Key({
      organization_id: config.organization_id,
      store_id: config.store_id,
      dian_configuration_id: config_id_int,
    });
    await this.s3_service.uploadFile(
      file.buffer,
      s3_key,
      'application/x-pkcs12',
    );

    const result = await this.dian_config_service.updateCertificate(
      config_id_int,
      s3_key,
      password,
      validation.expires || null,
      validation,
    );

    return this.response_service.success({
      ...result,
      certificate_info: {
        subject: validation.subject,
        issuer: validation.issuer,
        expires: validation.expires,
        fingerprint: validation.fingerprint,
        serial_number: validation.serial_number,
        tax_id: validation.tax_id,
      },
    });
  }

  @Post(':id/test-connection')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async testConnection(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.testConnection(id);
    return this.response_service.success(result);
  }

  /**
   * Encola el set de pruebas y responde 202 con el id del job.
   *
   * Era sincrónico y tardaba ~107 s, así que nginx lo cortaba a los 60 s con un
   * 504 mientras el backend lo completaba bien: la UI se quedaba con el estado de
   * antes del envío y avisaba «no se pudo enviar» sobre un lote que sí se había
   * enviado y ya había quemado su bloque de consecutivos.
   */
  @Post(':id/run-test-set')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.ACCEPTED)
  async runTestSet(
    @Param('id', ParseIntPipe) id: number,
    @Body('resolution_id', ParseIntPipe) resolution_id: number,
    // Vía de humo: 1 documento, 1 consecutivo. Diagnostica si la DIAN ingiere el
    // envío sin quemar los 50 que exige el set. No habilita.
    @Query('smoke') smoke?: string,
    // Vía de validación: el MISMO documento por `SendBillSync`, que responde en la
    // misma llamada con `IsValid` y las reglas violadas. No lleva `testSetId`, así
    // que no puede rechazar el set ni consumir un intento de habilitación.
    @Query('validate') validate?: string,
  ) {
    const result = await this.dian_test_service.enqueueTestSet(
      id,
      resolution_id,
      {
        smoke: smoke === 'true' || smoke === '1',
        validate_only: validate === 'true' || validate === '1',
      },
    );
    return this.response_service.success(result);
  }

  /**
   * Sondeo del job encolado. El `id` de la configuración viaja en la ruta y es lo
   * que autoriza la lectura: los ids de BullMQ son enteros globales sobre una cola
   * compartida por todos los tenants, y `job.returnvalue` sale de Redis, donde el
   * cliente Prisma scopeado no llega.
   */
  @Get(':id/run-test-set/:jobId')
  @Permissions('invoicing:read')
  async getTestSetJobStatus(
    @Param('id', ParseIntPipe) id: number,
    @Param('jobId') job_id: string,
  ) {
    const result = await this.dian_test_service.getTestSetJobStatus(job_id, id);
    return this.response_service.success(result);
  }

  @Get(':id/test-results')
  @Permissions('invoicing:read')
  async getTestResults(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.getTestResults(id);
    return this.response_service.success(result);
  }

  /**
   * Re-polls GetStatusZip for the stored test-set ZipKey. Resolves a verdict
   * that was still "in process" when run-test-set returned, without re-sending
   * the 50 documents.
   */
  @Get(':id/test-set-status')
  @Permissions('invoicing:read')
  async checkTestSetStatus(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.checkTestSetStatus(id);
    return this.response_service.success(result);
  }

  /**
   * Asks DIAN, document by document, whether the submitted batch reached its
   * records. Separates "queued" from "never classified" — a distinction the
   * ZipKey alone cannot express. Read-only: never re-sends anything.
   */
  @Get(':id/test-set-documents')
  @Permissions('invoicing:read')
  async getTestSetDocuments(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.getTestSetDocumentStatus(id);
    return this.response_service.success(result);
  }

  /**
   * Transmite las notas que la fase 2 dejó GENERADAS, FIRMADAS Y SIN ENVIAR.
   *
   * Las lee de `last_test_result.note_phase.deferred[]` y las manda TAL CUAL:
   * el consecutivo entra en el `SoftwareSecurityCode` y en el CUDE, así que
   * renumerar exigiría volver a firmar y produciría otro documento. No reserva
   * numeración nueva ni regenera nada.
   *
   * Es REANUDABLE: cada nota con ZipKey sale de `deferred`, así que una llamada
   * cortada por el `proxy_read_timeout` de nginx se retoma invocando de nuevo y
   * solo viajan las que faltan. `limit` permite partirla a mano si el bloque
   * retenido es grande.
   *
   * `invoicing:write` y no `:read` porque envía documentos a la DIAN contra
   * consecutivos autorizados: es la operación de escritura más costosa de este
   * controlador, aunque no consuma numeración nueva.
   */
  @Post(':id/transmit-deferred-notes')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async transmitDeferredNotes(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ) {
    const parsed = limit ? parseInt(limit, 10) : undefined;
    const result = await this.dian_test_service.transmitDeferredNotes(
      id,
      Number.isFinite(parsed) && (parsed as number) > 0 ? parsed : undefined,
    );
    return this.response_service.success(result, result.message);
  }

  /**
   * Discards a batch DIAN never judged so a new test set can be sent. Write
   * operation: it releases the re-send guard that otherwise leaves the
   * configuration stuck behind a dead ZipKey.
   */
  @Post(':id/abandon-test-set')
  @Permissions('invoicing:write')
  async abandonTestSet(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_test_service.abandonTestSet(id);
    return this.response_service.success(result);
  }

  /**
   * Read-only checklist of everything still missing before this configuration can
   * emit real invoices. Same predicates as the emission gate, so the UI cannot
   * promise production readiness the backend would then refuse.
   */
  @Get(':id/production-readiness')
  @Permissions('invoicing:read')
  async getProductionReadiness(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.getProductionReadiness(id);
    return this.response_service.success(result);
  }

  /** Promotes the configuration to production once the checklist is clean. */
  @Post(':id/promote-to-production')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async promoteToProduction(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.promoteToProduction(id);
    return this.response_service.success(
      result,
      'Configuración DIAN promovida a producción',
    );
  }
}
