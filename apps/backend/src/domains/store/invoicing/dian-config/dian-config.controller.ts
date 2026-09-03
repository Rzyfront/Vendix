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
  UploadedFiles,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { DianConfigService } from './dian-config.service';
import { DianTestService } from './dian-test.service';
import { DianNumberingRangeService } from './dian-numbering-range.service';
import {
  DianHabilitationScannerService,
  MAX_HABILITATION_SCAN_FILES,
} from './dian-habilitation-scanner.service';
import { assertScannableFiles } from './habilitation-scan-files.util';
import { ResponseService } from '../../../../common/responses/response.service';
import { S3Service } from '../../../../common/services/s3.service';
import { Permissions } from '../../../auth/decorators/permissions.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../../auth/guards/permissions.guard';
import { UserRole } from '../../../auth/enums/user-role.enum';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { ApplyNumberingRangesDto } from './dto/apply-numbering-range.dto';
import { QueryNumberingRangeDto } from './dto/query-numbering-range.dto';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { ManualCertificateIssuerAdapter } from './certificates/manual-certificate-issuer.adapter';
import { buildDianCertificateS3Key } from './certificates/certificate-s3-key.util';
import { DIAN_IDENTITY_DOCUMENT_MAX_BYTES } from './certificates/identity-documents.contract';
import { RequestContextService } from '../../../../common/context/request-context.service';

/*
 * NOTA sobre el guard: hasta este cambio la clase no declaraba `PermissionsGuard`,
 * así que los `@Permissions` de abajo eran decoración inerte —Nest sólo los lee si
 * hay un guard que los consulte—. Verificado empíricamente: un usuario de rol
 * `cashier` sin un solo permiso `invoicing:*` obtenía 200 en las lecturas y
 * alcanzaba la capa de servicio en los `DELETE` (404 con `error_code` de dominio,
 * prueba de que la autorización no se evaluaba). No es un permiso nuevo ni una
 * restricción nueva: es hacer efectiva la que el archivo ya declaraba. Mismo
 * criterio que `pos/pos-fiscal.controller.ts`.
 */
@Controller('store/invoicing/dian-config')
@UseGuards(PermissionsGuard)
export class DianConfigController {
  constructor(
    private readonly dian_config_service: DianConfigService,
    private readonly dian_test_service: DianTestService,
    private readonly dian_numbering_range_service: DianNumberingRangeService,
    private readonly certificate_adapter: ManualCertificateIssuerAdapter,
    private readonly response_service: ResponseService,
    private readonly s3_service: S3Service,
    private readonly habilitation_scanner_service: DianHabilitationScannerService,
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

  /**
   * Estado de LAS CUATRO habilitaciones DIAN de la entidad fiscal, en una sola
   * respuesta y con los cuatro ejes SIEMPRE presentes.
   *
   * `:id/production-readiness` solo sabe contestar por una configuración que ya
   * existe, así que los ejes sin configurar —documento soporte, nómina,
   * documento equivalente— no tenían forma de aparecer, y lo que no aparece se
   * lee como «no aplica». Aquí el eje sin configuración se reporta como
   * `not_started`, que es un estado, no una ausencia.
   *
   * Declarada ANTES de `@Get(':id')` a propósito, por el mismo motivo que
   * `emission-status`: Nest resuelve en orden de declaración y la ruta
   * paramétrica se tragaría este path, dejando que `ParseIntPipe` respondiera
   * 400 sobre un texto que nunca fue un id.
   */
  @Get('fiscal-readiness')
  @Permissions('invoicing:read')
  async getFiscalReadiness() {
    const result = await this.dian_config_service.getFiscalReadiness();
    return this.response_service.success(result);
  }

  @Get(':id')
  @Permissions('invoicing:read')
  async getConfigById(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.getConfigById(id);
    return this.response_service.success(result);
  }

  /**
   * Lee 1-3 documentos de la habilitación DIAN (pantalla del set de pruebas y,
   * opcionalmente, la resolución de pruebas) y devuelve los campos del
   * formulario anotados con si son confiables.
   *
   * No escribe nada: guardar sigue siendo el `POST`/`PATCH` que el usuario
   * dispara después de revisar, así que una lectura equivocada nunca aterriza
   * sola en la configuración fiscal.
   */
  @Post('scan-habilitation')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  // Holgura de 1 a propósito: si multer corta en el tope exacto responde
  // "Unexpected field - files" sin error_code, y el frontend no puede
  // traducirlo. Dejándolo pasar, `assertScannableFiles` devuelve
  // HABILITATION_SCAN_TOO_MANY_FILES con su mensaje en español.
  @UseInterceptors(FilesInterceptor('files', MAX_HABILITATION_SCAN_FILES + 1))
  async scanHabilitation(@UploadedFiles() files: Express.Multer.File[]) {
    const result = await this.habilitation_scanner_service
      .scanHabilitationDocuments(assertScannableFiles(files));
    return this.response_service.success(
      result,
      'Documentos de habilitación escaneados exitosamente',
    );
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
   * Rangos de numeración que la DIAN tiene AUTORIZADOS, cruzados con lo guardado.
   *
   * `invoicing:read` y no `:write` porque no escribe nada: no emite documentos,
   * no reserva un solo consecutivo y no toca el set de pruebas. Es una consulta
   * al web service `GetNumberingRange`.
   *
   * LA ClTec NO VIAJA. La respuesta de la DIAN la trae en claro; la comparación
   * contra la almacenada ocurre en el servidor y de ella sólo sale
   * `technical_key_matches`. Es el mismo criterio que ya aplican
   * `RESOLUTION_PUBLIC_SELECT` y el prefill del asistente fiscal.
   *
   * ── `?environment=` NO CAMBIA EL PERMISO ───────────────────────────────────
   *
   * Sigue siendo `invoicing:read`, y no porque se haya pasado por alto: el
   * ambiente no altera QUÉ se lee ni de quién —la configuración de la ruta, sus
   * resoluciones, su NIT— sino únicamente a qué catálogo de la DIAN se dirige la
   * pregunta. No hay dato de otro tenant al alcance, no se escribe nada y no se
   * promueve nada. Exigir `:write` para consultar el catálogo de producción
   * habría reproducido dentro del permiso el mismo ciclo cerrado que el
   * parámetro viene a romper: quien puede ver no podría diagnosticar.
   *
   * Ausente ⇒ el ambiente de la configuración, que es el comportamiento previo.
   */
  @Get(':id/numbering-ranges')
  @Permissions('invoicing:read')
  async getNumberingRanges(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: QueryNumberingRangeDto,
  ) {
    const result = await this.dian_numbering_range_service.queryRanges(
      id,
      query.environment,
    );
    return this.response_service.success(result);
  }

  /**
   * Trae de la DIAN a `invoice_resolutions` los rangos SELECCIONADOS.
   *
   * El cuerpo sólo SELECCIONA los rangos por su par `(resolution_number,
   * prefix)`: el servicio consulta a la DIAN y escribe lo que ella conteste. La
   * ClTec no se acepta del cliente en ninguna circunstancia, ni sale en la
   * respuesta.
   *
   * ── POR QUÉ 200 AUNQUE ALGÚN ELEMENTO FALLE ────────────────────────────────
   *
   * Porque el estado HTTP describe la PETICIÓN, y la petición se atendió: la
   * consulta a la DIAN se hizo y cada rango marcado obtuvo un desenlace. Ese
   * desenlace viaja por elemento en `results[].ok` y `results[].error`, con
   * `applied` y `failed` como resumen. Devolver 4xx porque uno de veinte no se
   * pudo aplicar haría que el cliente descartara la respuesta entera y con ella
   * la única constancia de cuáles diecinueve SÍ quedaron escritos. Es el mismo
   * criterio de las demás operaciones masivas del repositorio.
   *
   * Sin `try/catch`: lo que sí invalida el lote entero —configuración
   * inexistente, la DIAN sin responder, cuerpo mal formado— sube al
   * `AllExceptionsFilter`, que emite el estado y el `error_code` reales.
   *
   * `environment` en el cuerpo tampoco cambia el permiso: sigue siendo
   * `invoicing:write` porque sigue escribiendo exactamente lo mismo —las
   * resoluciones de ESTA configuración— y sólo cambia a qué catálogo de la DIAN
   * se le piden los valores. La fila resultante no habilita nada por sí sola:
   * `assertElectronicEmissionLive` exige `environment === 'production' &&
   * enablement_status === 'enabled'` sobre la CONFIGURACIÓN antes de cualquier
   * emisión, y esta ruta no toca ninguna de esas dos columnas.
   */
  @Post(':id/numbering-ranges/apply')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async applyNumberingRanges(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyNumberingRangesDto,
  ) {
    const result = await this.dian_numbering_range_service.applyRanges(id, dto);
    return this.response_service.updated(result);
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

  // =====================================================================
  // QUI-657 — rama "no tengo certificado": documentos de identidad.
  //
  // El gate de emisión NO se relaja por ninguno de estos endpoints. Mientras
  // `certificate_s3_key` esté vacío, `fiscal-production-readiness` sigue
  // bloqueando, que es exactamente lo que debe pasar: un expediente entregado
  // no es un certificado.
  // =====================================================================

  /**
   * Sube un documento de identidad (RUT, cédula, certificado de existencia).
   *
   * `limits.fileSize` en el interceptor y no solo en el servicio: sin él,
   * Multer bufferiza el archivo entero en memoria ANTES de que el servicio
   * pueda opinar, así que un envío de 100 MB se paga en RAM aunque se rechace
   * después. El servicio revalida igual — el interceptor es la primera puerta,
   * no la única.
   */
  @Post(':id/identity-documents')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('document', {
      limits: { fileSize: DIAN_IDENTITY_DOCUMENT_MAX_BYTES },
    }),
  )
  async uploadIdentityDocument(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('document_type') document_type: string,
  ) {
    const context = RequestContextService.getContext();
    const result = await this.dian_config_service.uploadIdentityDocument({
      config_id: id,
      document_type,
      file,
      uploaded_by_user_id: context?.user_id ?? null,
    });
    return this.response_service.success(result, 'Documento cargado');
  }

  /**
   * Estado del expediente: qué se subió, qué falta, si ya se puede enviar.
   *
   * Las URLs firmadas se piden con `?include_urls=true` y no vienen por
   * defecto: firmar crea un enlace que abre un documento de identidad a
   * cualquiera que lo tenga, y eso no debe ser el efecto colateral de un
   * listado que solo quería contar archivos.
   */
  @Get(':id/identity-documents')
  @Permissions('invoicing:read')
  async getIdentityDocuments(
    @Param('id', ParseIntPipe) id: number,
    @Query('include_urls') include_urls?: string,
  ) {
    const result = await this.dian_config_service.getIdentityDocumentStatus(
      id,
      { include_urls: include_urls === 'true' || include_urls === '1' },
    );
    return this.response_service.success(result);
  }

  @Delete(':id/identity-documents/:documentId')
  @Permissions('invoicing:write')
  async deleteIdentityDocument(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) document_id: number,
  ) {
    const result = await this.dian_config_service.deleteIdentityDocument(
      id,
      document_id,
    );
    return this.response_service.success(result, 'Documento eliminado');
  }

  /** El tenant da por entregado el expediente: entra a la cola de plataforma. */
  @Post(':id/identity-documents/submit')
  @Permissions('invoicing:write')
  @HttpCode(HttpStatus.OK)
  async submitIdentityDocuments(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.submitIdentityDocuments(id);
    return this.response_service.success(
      result,
      'Documentos enviados. Te avisaremos cuando el certificado esté listo.',
    );
  }
}

/**
 * QUI-657 — cola de plataforma para tramitar certificados de firma.
 *
 * Controlador aparte y no más rutas en el de arriba porque el prefijo, la
 * audiencia y el permiso son otros: acá se cruza el límite de tenant a
 * propósito (es una cola de operación de plataforma).
 *
 * PERMISO: se reutiliza `superadmin:*` en lugar de crear
 * `superadmin:fiscal:read-identity-docs` (decisión de producto, 2026-08-13).
 * CONTRADICE la dirección de QUI-603 —permisos granulares, hoy en In Review— y
 * se acepta a sabiendas: partirlo después es una migración de seed, no un
 * cambio de forma de estos endpoints.
 */
@Controller('super-admin/fiscal/certificates-pending')
@UseGuards(RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class SuperAdminCertificatesPendingController {
  constructor(
    private readonly dian_config_service: DianConfigService,
    private readonly certificate_adapter: ManualCertificateIssuerAdapter,
    private readonly response_service: ResponseService,
    private readonly s3_service: S3Service,
  ) {}

  /** Expedientes esperando trámite, el más antiguo primero. */
  @Get()
  @Permissions('superadmin:read')
  async listPending(@Query('status') status?: string) {
    const result = await this.dian_config_service.listPendingCertificateRequests(
      { statuses: status ? status.split(',').map((s) => s.trim()) : undefined },
    );
    return this.response_service.success(result);
  }

  /** URL firmada de vida corta (5 min) para abrir UN documento. */
  @Get(':id/documents/:documentId')
  @Permissions('superadmin:read')
  async getDocumentUrl(
    @Param('id', ParseIntPipe) id: number,
    @Param('documentId', ParseIntPipe) document_id: number,
  ) {
    const result =
      await this.dian_config_service.getIdentityDocumentDownloadUrl(
        id,
        document_id,
      );
    return this.response_service.success(result);
  }

  /** Marca el expediente como en trámite ante la entidad emisora. */
  @Post(':id/mark-issuing')
  @Permissions('superadmin:write')
  @HttpCode(HttpStatus.OK)
  async markIssuing(@Param('id', ParseIntPipe) id: number) {
    const result = await this.dian_config_service.markCertificateIssuing(id);
    return this.response_service.success(result, 'Expediente en trámite');
  }

  /** Devuelve el expediente al tenant con un motivo. */
  @Post(':id/reject')
  @Permissions('superadmin:write')
  @HttpCode(HttpStatus.OK)
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
  ) {
    const result = await this.dian_config_service.rejectCertificateRequest(
      id,
      reason,
    );
    return this.response_service.success(result, 'Expediente devuelto');
  }

  /**
   * Carga el `.p12` que la entidad emisora expidió.
   *
   * Se valida contra el NIT de la configuración igual que cualquier otro cert:
   * cargar un cert ajeno acá sería peor que en el flujo del tenant, porque lo
   * hace un operador que no es el dueño de la identidad fiscal.
   */
  @Post(':id/upload-certificate')
  @Permissions('superadmin:write')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('certificate'))
  async uploadIssuedCertificate(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: Express.Multer.File,
    @Body('password') password: string,
  ) {
    if (!file) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_001);
    }
    if (!password?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_002,
        'La contraseña del certificado es obligatoria.',
      );
    }

    const pending = await this.dian_config_service.listPendingCertificateRequests(
      { statuses: ['documents_submitted', 'issuing', 'documents_pending'] },
    );
    const target = pending.find((row) => row.id === id);
    if (!target) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_001,
        'La configuración no está en la cola de certificados por tramitar.',
      );
    }

    const validation = await this.certificate_adapter.validateCertificate({
      p12_buffer: file.buffer,
      password,
      expected_tax_id: target.nit,
      expected_dv: target.nit_dv,
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

    const s3_key = buildDianCertificateS3Key({
      organization_id: target.organization_id,
      store_id: target.store_id,
      dian_configuration_id: id,
    });
    await this.s3_service.uploadFile(
      file.buffer,
      s3_key,
      'application/x-pkcs12',
    );

    const result = await this.dian_config_service.uploadIssuedCertificate({
      config_id: id,
      s3_key,
      password,
      expiry: validation.expires || null,
      certificate_info: validation,
    });

    return this.response_service.success(
      result,
      'Certificado cargado. La tienda ya puede emitir.',
    );
  }
}
