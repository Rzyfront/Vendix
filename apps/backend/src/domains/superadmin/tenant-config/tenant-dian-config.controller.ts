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
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  TenantContextRunner,
  type ResolvedTenantScope,
} from '@common/context/tenant-context-runner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { ResponseService } from '@common/responses/response.service';
import { S3Service } from '@common/services/s3.service';

import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '../../auth/enums/user-role.enum';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { OrgDianConfigService } from '../../organization/invoicing/dian-config/dian-config.service';
import { buildDianCertificateS3Key } from '../../store/invoicing/dian-config/certificates/certificate-s3-key.util';
import type { CertificateValidationResult } from '../../store/invoicing/dian-config/certificates/certificate-issuer.interface';
import { ManualCertificateIssuerAdapter } from '../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { DianConfigService } from '../../store/invoicing/dian-config/dian-config.service';
import {
  buildTestSetCompositionView,
  resolveTestSetComposition,
  testSetSize,
} from '../../store/invoicing/dian-config/dian-test-set-composition';
import { DianTestService } from '../../store/invoicing/dian-config/dian-test.service';
import { UpdateDianConfigDto } from '../../store/invoicing/dian-config/dto/update-dian-config.dto';

import { CreateTenantDianConfigDto } from './dto/create-tenant-dian-config.dto';
import { toTenantTarget, type TenantScopeSegment } from './dto/tenant-scope-param.dto';

interface RequestWithUser {
  user?: { id?: number; email?: string };
}

/**
 * Superficie de ESCRITURA de configuraciones DIAN.
 *
 * Son exactamente las 5 mutaciones que se niegan a operar sobre una fila con
 * `store_id IS NULL` (`DianConfigService.create/update/updateCertificate/
 * setDefault/deleteConfig` lanzan 400 «managed at organization level»). El resto
 * del dominio —lecturas, conexión, set de pruebas, promoción— es indiferente al
 * alcance y no se bifurca.
 */
interface DianWriteSurface {
  create(dto: CreateTenantDianConfigDto): Promise<any>;
  update(id: number, dto: UpdateDianConfigDto): Promise<any>;
  updateCertificate(
    id: number,
    s3_key: string,
    password: string,
    expiry: Date | null,
    certificate_info?: CertificateValidationResult,
  ): Promise<any>;
  setDefault(id: number): Promise<any>;
  deleteConfig(id: number): Promise<void>;
}

/**
 * Rail DIAN de la consola de super admin: las 19 operaciones del panel de
 * facturación electrónica de una tienda, ejecutables sobre un tenant
 * arbitrario, más un `overview` que compone el estado en una sola llamada.
 *
 * NO REIMPLEMENTA NADA. `TenantContextRunner` resuelve
 * `(organization_id, store_id, fiscal_scope)` desde la URL, forja el
 * `RequestContext` del tenant y ejecuta dentro los servicios de tienda y
 * organización existentes, que leen el tenant del ALS. Cualquier divergencia
 * entre lo que ve el super admin y lo que ve el comerciante sería un defecto.
 *
 * Los segmentos de alcance van en PLURAL (`stores` / `organizations`):
 * `DomainScopeGuard` responde 403 a cualquier ruta que contenga el literal
 * `/store/` cuando el token es `VENDIX_ADMIN`.
 */
@ApiTags('Super Admin - Consola de tenants (DIAN)')
@Controller('superadmin/tenants/:scope/:tenantId/invoicing')
@UseGuards(PermissionsGuard, RolesGuard)
@Roles(UserRole.SUPER_ADMIN)
export class TenantDianConfigController {
  constructor(
    private readonly runner: TenantContextRunner,
    private readonly storeDian: DianConfigService,
    private readonly orgDian: OrgDianConfigService,
    private readonly dianTest: DianTestService,
    private readonly certificateAdapter: ManualCertificateIssuerAdapter,
    private readonly prisma: StorePrismaService,
    private readonly s3: S3Service,
    private readonly response: ResponseService,
  ) {}

  // ====================================================================
  // Lecturas — literales ANTES de `:configId`
  //
  // Nest resuelve en ORDEN DE DECLARACIÓN: si `:configId` se declarara antes,
  // `dashboard`, `emission-status` y `audit-logs` caerían en la ruta paramétrica
  // y `ParseIntPipe` las rechazaría con un 400 sobre el literal. El controlador
  // de tienda documenta el mismo cuidado en sus líneas 71-76.
  // ====================================================================

  @Get('dian-config')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Configuraciones DIAN del tenant' })
  async getConfigs(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getConfigs(),
    );
    return this.response.success(
      this.redactMany(result),
      'Configuraciones DIAN obtenidas',
    );
  }

  @Get('dian-config/dashboard')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({
    summary: 'Métricas DIAN agregadas del tenant',
    description:
      'Envíos, tasa de éxito, últimas 20 transmisiones y estado del certificado.',
  })
  async getDashboard(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getDashboard(),
    );
    return this.response.success(result, 'Panel DIAN del tenant obtenido');
  }

  @Get('dian-config/emission-status')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({
    summary: '¿Este tenant está emitiendo facturas electrónicas ahora mismo?',
    description:
      'Mismo predicado que aplica la ruta de emisión (production + enabled), no el estado del asistente fiscal.',
  })
  async getEmissionStatus(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getEmissionStatus(),
    );
    return this.response.success(result, 'Estado de emisión obtenido');
  }

  @Get('dian-config/audit-logs')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Bitácora DIAN del tenant' })
  async getAuditLogs(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('config_id') config_id?: string,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getAuditLogs(
        this.toPositiveInt(page, 1),
        Math.min(this.toPositiveInt(limit, 20), 100),
        config_id ? this.toPositiveInt(config_id, 0) || undefined : undefined,
      ),
    );
    return this.response.paginated(
      result.data,
      result.total,
      result.page,
      result.limit,
    );
  }

  /**
   * Estado DIAN del tenant en una sola llamada.
   *
   * Existe porque la ficha de soporte necesita las tres respuestas a la vez y
   * encadenarlas desde el cliente multiplica por tres el forjado de contexto —y
   * abre la ventana para que las tres lecturas describan momentos distintos del
   * mismo tenant. Aquí comparten un único `runAsTenant`.
   */
  @Get('overview')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({
    summary: 'Panel + estado de emisión + veredicto del set de pruebas',
  })
  async getOverview(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, async (tenant) => {
      const [dashboard, emission] = await Promise.all([
        this.storeDian.getDashboard(),
        this.storeDian.getEmissionStatus(),
      ]);

      // El veredicto del set solo tiene sentido para la configuración que la
      // ruta de emisión ya eligió: pedirlo para otra describiría una
      // habilitación que no es la que gobierna la facturación del tenant.
      const test_set = emission.configuration_id
        ? await this.dianTest.getTestResults(emission.configuration_id)
        : null;

      return {
        scope: {
          organization_id: tenant.organization_id,
          store_id: tenant.store_id,
          fiscal_scope: tenant.fiscal_scope,
          operating_scope: tenant.operating_scope,
          organization_name: tenant.organization_name,
          store_name: tenant.store_name,
        },
        dashboard,
        emission,
        test_set,
      };
    });

    return this.response.success(result, 'Resumen DIAN del tenant obtenido');
  }

  @Get('dian-config/:configId')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Configuración DIAN por id' })
  async getConfigById(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getConfigById(configId),
    );
    return this.response.success(
      this.redact(result),
      'Configuración DIAN obtenida',
    );
  }

  @Get('dian-config/:configId/production-readiness')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({
    summary: 'Checklist de lo que falta para emitir en producción',
  })
  async getProductionReadiness(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.getProductionReadiness(configId),
    );
    return this.response.success(result, 'Checklist de producción obtenido');
  }

  @Get('dian-config/:configId/test-results')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Último resultado del set de pruebas' })
  async getTestResults(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.getTestResults(configId),
    );
    return this.response.success(result, 'Resultado del set de pruebas obtenido');
  }

  /**
   * Reconsulta `GetStatusZip` con el ZipKey ya almacenado. Es un GET que
   * escribe `last_test_result` —igual que en tienda— pero NO reenvía los
   * documentos, así que no consume numeración.
   */
  @Get('dian-config/:configId/test-set-status')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Reconsultar el veredicto del lote en la DIAN' })
  async checkTestSetStatus(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.checkTestSetStatus(configId),
    );
    return this.response.success(result, 'Estado del set de pruebas consultado');
  }

  @Get('dian-config/:configId/test-set-documents')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({
    summary: 'Diagnóstico documento a documento del lote enviado',
    description:
      'Separa «en cola» de «nunca clasificado», distinción que el ZipKey por sí solo no puede expresar. Solo lectura.',
  })
  async getTestSetDocuments(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.getTestSetDocumentStatus(configId),
    );
    return this.response.success(result, 'Diagnóstico por documento obtenido');
  }

  @Get('dian-config/:configId/run-test-set/:jobId')
  @Permissions('superadmin:tenants:dian:read')
  @ApiOperation({ summary: 'Sondeo del job del set de pruebas' })
  async getTestSetJobStatus(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
    @Param('jobId') jobId: string,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.getTestSetJobStatus(jobId, configId),
    );
    return this.response.success(result, 'Estado del job obtenido');
  }

  // ====================================================================
  // Escrituras
  // ====================================================================

  @Post('dian-config')
  @Permissions('superadmin:tenants:dian:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear configuración DIAN para el tenant',
    description:
      'El ancla (`store_id` o `NULL`) la fija el fiscal_scope de la organización, no el payload.',
  })
  async create(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Body() dto: CreateTenantDianConfigDto,
  ) {
    const result = await this.runAs(req, scope, tenantId, (tenant) => {
      this.assertStoreIdAgreesWithScope(dto.store_id, tenant);
      // El pre-chequeo de duplicados vive en los servicios delegados y ya usa el
      // eje del índice único PARCIAL —`(store_id, nit, configuration_type)` con
      // tienda y `(organization_id, nit, configuration_type)` con `store_id
      // IS NULL`—, nunca `accounting_entity_id`. Duplicarlo aquí solo añadiría
      // una segunda verdad que puede desincronizarse.
      return this.writeSurface(tenant).create(dto);
    });
    return this.response.created(
      this.redact(result),
      'Configuración DIAN creada',
    );
  }

  /**
   * Subida del certificado `.p12`.
   *
   * Fuera del rail de escritura general: manipula la clave privada de la
   * identidad fiscal del contribuyente, así que lleva su propio permiso.
   */
  @Post('dian-config/upload-certificate')
  @Permissions('superadmin:tenants:dian:certificate:write')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('certificate'))
  @ApiOperation({ summary: 'Cargar el certificado .p12 del tenant' })
  async uploadCertificate(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
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
        'La contraseña del certificado es obligatoria',
      );
    }

    // `FileInterceptor` deja el resto del multipart como texto, así que este
    // campo llega siempre como string y el `ValidationPipe` global no lo mira.
    const configId = this.toPositiveInt(config_id, 0);
    if (!configId) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'config_id debe ser un entero positivo',
      );
    }

    const result = await this.runAs(req, scope, tenantId, async (tenant) => {
      // Resolver la configuración PRIMERO es lo que ata el certificado al
      // tenant de la URL: `getConfigById` filtra por el alcance forjado, así que
      // una configuración de otro comerciante devuelve 404 antes de que el
      // archivo se valide o se suba.
      const config = await this.storeDian.getConfigById(configId);

      const validation = await this.certificateAdapter.validateCertificate({
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
        throw new VendixHttpException(
          ErrorCodes.DIAN_CERT_001,
          validation.error,
        );
      }

      const s3_key = buildDianCertificateS3Key({
        organization_id: tenant.organization_id,
        store_id: tenant.store_id,
        dian_configuration_id: configId,
      });
      await this.s3.uploadFile(file.buffer, s3_key, 'application/x-pkcs12');

      const updated = await this.writeSurface(tenant).updateCertificate(
        configId,
        s3_key,
        password,
        validation.expires || null,
        validation,
      );

      return {
        ...this.redact(updated),
        certificate_info: {
          subject: validation.subject,
          issuer: validation.issuer,
          expires: validation.expires,
          fingerprint: validation.fingerprint,
          serial_number: validation.serial_number,
          tax_id: validation.tax_id,
        },
      };
    });

    return this.response.success(result, 'Certificado cargado');
  }

  @Patch('dian-config/:configId')
  @Permissions('superadmin:tenants:dian:write')
  @ApiOperation({ summary: 'Actualizar configuración DIAN del tenant' })
  async update(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
    @Body() dto: UpdateDianConfigDto,
  ) {
    const result = await this.runAs(req, scope, tenantId, (tenant) =>
      this.writeSurface(tenant).update(configId, dto),
    );
    return this.response.updated(
      this.redact(result),
      'Configuración DIAN actualizada',
    );
  }

  @Delete('dian-config/:configId')
  @Permissions('superadmin:tenants:dian:write')
  @ApiOperation({ summary: 'Eliminar configuración DIAN del tenant' })
  async deleteConfig(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    await this.runAs(req, scope, tenantId, (tenant) =>
      this.writeSurface(tenant).deleteConfig(configId),
    );
    return this.response.deleted('Configuración DIAN eliminada');
  }

  @Patch('dian-config/:configId/set-default')
  @Permissions('superadmin:tenants:dian:write')
  @ApiOperation({ summary: 'Marcar la configuración como predeterminada' })
  async setDefault(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, (tenant) =>
      this.writeSurface(tenant).setDefault(configId),
    );
    return this.response.updated(
      this.redact(result),
      'Configuración marcada como predeterminada',
    );
  }

  @Post('dian-config/:configId/test-connection')
  @Permissions('superadmin:tenants:dian:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Probar conectividad con los servicios de la DIAN' })
  async testConnection(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.testConnection(configId),
    );
    return this.response.success(result, 'Prueba de conexión ejecutada');
  }

  /**
   * Encola el set de pruebas de habilitación. 202 + `job_id`.
   *
   * DOS COSAS QUE NO SON DETALLE:
   *
   * 1. `enqueueTestSet` se llama DENTRO del callback de `runAsTenant`.
   *    `DianTestService` snapshotea el ALS en el payload del job y
   *    `DianTestSetProcessor` lo restaura; encolar fuera guardaría la
   *    organización del super admin y el worker resolvería la entidad fiscal
   *    equivocada — es decir, enviaría a la DIAN documentos con el NIT de otro
   *    contribuyente.
   *
   * 2. La respuesta declara el bloque de consecutivos que el envío va a quemar.
   *    Son consecutivos AUTORIZADOS y no se recuperan: sin ese dato la consola
   *    no puede advertirlo antes de que el operador confirme.
   */
  @Post('dian-config/:configId/run-test-set')
  @Permissions('superadmin:tenants:dian:write')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Encolar el set de pruebas DIAN del tenant',
    description:
      'Consume un bloque irrecuperable de consecutivos autorizados; la respuesta declara cuál.',
  })
  async runTestSet(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
    @Body('resolution_id', ParseIntPipe) resolutionId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, async () => {
      const config = await this.storeDian.getConfigById(configId);
      // Se proyecta ANTES de encolar: después, el worker ya puede haber
      // reservado el bloque y `current_number` diría el rango siguiente.
      const consumes = await this.projectConsumedRange(config, resolutionId);
      const job = await this.dianTest.enqueueTestSet(configId, resolutionId);
      return { ...job, consumes };
    });

    return this.response.success(result, 'Set de pruebas encolado');
  }

  @Post('dian-config/:configId/abandon-test-set')
  @Permissions('superadmin:tenants:dian:write')
  @ApiOperation({
    summary: 'Descartar un lote sin veredicto para poder reenviar',
    description:
      'Libera la guarda de reenvío que deja la configuración encerrada tras un ZipKey muerto.',
  })
  async abandonTestSet(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.dianTest.abandonTestSet(configId),
    );
    return this.response.success(result, 'Lote descartado');
  }

  @Post('dian-config/:configId/promote-to-production')
  @Permissions('superadmin:tenants:dian:promote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Promover la configuración a producción',
    description:
      'Mismas reglas que aplica la ruta de emisión: rechaza con el checklist completo si falta algo.',
  })
  async promoteToProduction(
    @Req() req: RequestWithUser,
    @Param('scope') scope: TenantScopeSegment,
    @Param('tenantId', ParseIntPipe) tenantId: number,
    @Param('configId', ParseIntPipe) configId: number,
  ) {
    const result = await this.runAs(req, scope, tenantId, () =>
      this.storeDian.promoteToProduction(configId),
    );
    return this.response.updated(
      this.redact(result),
      'Configuración DIAN promovida a producción',
    );
  }

  // ====================================================================
  // Internos
  // ====================================================================

  /**
   * Forja el contexto del tenant y ejecuta `fn` dentro.
   *
   * El actor se lee ANTES de forjar: dentro del callback el ALS ya describe al
   * tenant, y confundir ambas identidades es exactamente lo que haría que un
   * log de auditoría atribuyera la acción al comerciante.
   */
  private runAs<T>(
    req: RequestWithUser,
    scope: string,
    tenantId: number,
    fn: (tenant: ResolvedTenantScope) => Promise<T>,
  ): Promise<T> {
    const actor = { user_id: req.user?.id, email: req.user?.email };
    const permissions = RequestContextService.getContext()?.permissions ?? [];

    return this.runner.runAsTenant(
      toTenantTarget(scope, tenantId),
      { actor, permissions },
      fn,
    );
  }

  /**
   * Elige el servicio que sabe escribir el ancla de este tenant.
   *
   * Las 5 mutaciones de `DianConfigService` rechazan explícitamente una fila con
   * `store_id === null`, porque una configuración de alcance organización no le
   * pertenece a ninguna tienda. `OrgDianConfigService` es su gemelo para ese
   * caso. Las LECTURAS no se bifurcan nunca: `DianConfigService` ya resuelve
   * ambos alcances en su `where`, y usarlo siempre mantiene estable la forma de
   * la respuesta.
   */
  private writeSurface(scope: ResolvedTenantScope): DianWriteSurface {
    return scope.fiscal_scope === 'ORGANIZATION' ? this.orgDian : this.storeDian;
  }

  /**
   * Un `store_id` en el payload que contradiga a la URL es un error del cliente,
   * no una preferencia: honrarlo escribiría la configuración bajo otro NIT.
   */
  private assertStoreIdAgreesWithScope(
    store_id: number | undefined,
    scope: ResolvedTenantScope,
  ): void {
    if (store_id === undefined) return;

    if (scope.store_id === null) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'Esta organización factura con un NIT único: su configuración DIAN se ancla a la organización y no admite store_id.',
        { store_id, organization_id: scope.organization_id },
      );
    }

    if (store_id !== scope.store_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `El store_id del cuerpo (${store_id}) no coincide con la tienda de la ruta (${scope.store_id}).`,
        { store_id, expected_store_id: scope.store_id },
      );
    }
  }

  /**
   * Bloque de consecutivos que el envío va a quemar.
   *
   * Réplica exacta de la aritmética del worker (`DianTestService.executeTestSet`):
   * el primer número es `max(range_from, current_number + 1)` y el último se
   * desplaza por el tamaño del set del modo de operación. Es una PROYECCIÓN, no
   * una reserva: quien reserva es el worker, de forma atómica.
   *
   * La resolución se lee con el cliente de tienda YA dentro del contexto
   * forjado, así que la lectura queda acotada a la entidad fiscal del tenant.
   */
  private async projectConsumedRange(
    config: { operation_mode?: string | null },
    resolution_id: number,
  ) {
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id: resolution_id },
      select: {
        id: true,
        prefix: true,
        resolution_number: true,
        range_from: true,
        range_to: true,
        current_number: true,
      },
    });

    if (!resolution) return null;

    const operation_mode = config.operation_mode as any;
    const total = testSetSize(resolveTestSetComposition(operation_mode));
    const number_from = Math.max(
      resolution.range_from,
      (resolution.current_number ?? 0) + 1,
    );

    return {
      resolution_id: resolution.id,
      prefix: resolution.prefix,
      resolution_number: resolution.resolution_number,
      composition: buildTestSetCompositionView(operation_mode),
      number_from,
      number_to: number_from + total - 1,
      range_to: resolution.range_to,
      /** Los consecutivos autorizados que se consuman no se recuperan. */
      irreversible: true,
    };
  }

  /**
   * Los servicios delegados ya enmascaran `software_pin_encrypted` y
   * `certificate_password_encrypted` con `maskSensitiveFields`, pero NO
   * `certificate_s3_key`. Una clave de objeto no es la clave privada, pero
   * nombra dónde vive: en una consola cross-tenant se reporta su presencia, no
   * su ubicación.
   */
  private redact<T>(config: T): T {
    if (!config || typeof config !== 'object') return config;

    const { certificate_s3_key, ...rest } = config as Record<string, any>;
    return {
      ...rest,
      certificate_present: Boolean(certificate_s3_key),
    } as T;
  }

  private redactMany<T>(configs: T[]): T[] {
    return Array.isArray(configs)
      ? configs.map((config) => this.redact(config))
      : configs;
  }

  private toPositiveInt(value: string | undefined, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
