import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { CertificateValidationResult } from './certificates/certificate-issuer.interface';
import { certificateNitMatches } from './certificates/nit-match.util';
import {
  FiscalProductionReadinessService,
  ProductionReadinessCheck,
  isBlockingCheck,
  isActionableCheck,
} from '../providers/fiscal-production-readiness.service';
import { isHabilitacionResolution } from '@common/interfaces/fiscal-status.interface';
import {
  DIAN_CONFIGURATION_TYPES,
  defaultDocumentTypeFor,
  documentTypesFor,
  requirementsFor,
  type DianConfigurationType,
} from '../fiscal-document-requirements';
import type {
  FiscalReadinessAxis,
  FiscalReadinessResponse,
} from './dto/fiscal-readiness.dto';

/**
 * Lo que `getFiscalReadiness` selecciona de `dian_configurations`.
 *
 * Se declara explícito —y no se infiere del `select`— para que quitar un campo
 * de la consulta rompa la COMPILACIÓN y no la evaluación en producción.
 * `enablement_evidence` y `last_test_result` son los dos que más caro cuesta
 * olvidar: sin la evidencia, `resolveTestSetProof` cae al último lote y lee «no
 * pasó» sobre una habilitación que la DIAN ya concedió.
 */
type FiscalReadinessConfigRow = {
  id: number;
  organization_id: number;
  store_id: number | null;
  accounting_entity_id: number;
  configuration_type: DianConfigurationType;
  operation_mode: string;
  environment: string;
  enablement_status: string;
  software_id: string | null;
  software_pin_encrypted: string | null;
  certificate_s3_key: string | null;
  certificate_password_encrypted: string | null;
  certificate_kms_key_id: string | null;
  certificate_expiry: Date | null;
  certificate_fingerprint: string | null;
  certificate_nit: string | null;
  enablement_evidence: unknown;
  test_set_id: string | null;
  last_test_result: unknown;
  nit: string | null;
  nit_dv: string | null;
};

@Injectable()
export class DianConfigService {
  private readonly logger = new Logger(DianConfigService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly fiscalScope: FiscalScopeService,
    private readonly readiness: FiscalProductionReadinessService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private requireOrganizationId(value: number | undefined): number {
    if (typeof value !== 'number') {
      throw new BadRequestException('Organization context is required');
    }
    return value;
  }

  private requireStoreId(value: number | undefined): number {
    if (typeof value !== 'number') {
      throw new BadRequestException('Store context is required');
    }
    return value;
  }

  private maskSensitiveFields(config: any) {
    return {
      ...config,
      software_pin_encrypted: config.software_pin_encrypted ? '****' : null,
      certificate_password_encrypted: config.certificate_password_encrypted
        ? '****'
        : null,
    };
  }

  private onlyDigits(value?: string | null): string {
    return String(value ?? '').replace(/\D/g, '');
  }

  /**
   * Gets a dashboard with aggregated DIAN metrics from audit_logs.
   * Returns stats cards + last 20 submissions + certificate indicator.
   */
  async getDashboard() {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    // Get all configs for this store
    const configs = await this.prisma.withoutScope().dian_configurations.findMany({
      where:
        fiscalScope === 'ORGANIZATION'
          ? { organization_id, store_id: null }
          : { store_id: context.store_id },
      select: {
        id: true,
        name: true,
        certificate_expiry: true,
        enablement_status: true,
        environment: true,
      },
    });

    const config_ids = configs.map((c) => c.id);

    if (config_ids.length === 0) {
      return {
        stats: {
          total_sent: 0,
          total_success: 0,
          total_errors: 0,
          success_rate: 0,
        },
        recent_submissions: [],
        certificate_status: null,
        configs_summary: [],
      };
    }

    const where_clause = { dian_configuration_id: { in: config_ids } };

    // Aggregate stats from audit logs
    const [total_sent, total_success, total_errors] = await Promise.all([
      this.prisma.dian_audit_logs.count({ where: where_clause }),
      this.prisma.dian_audit_logs.count({
        where: { ...where_clause, status: 'success' },
      }),
      this.prisma.dian_audit_logs.count({
        where: { ...where_clause, status: 'error' },
      }),
    ]);

    const success_rate =
      total_sent > 0 ? Math.round((total_success / total_sent) * 100) : 0;

    // Last 20 submissions
    const recent_submissions = await this.prisma.dian_audit_logs.findMany({
      where: where_clause,
      orderBy: { created_at: 'desc' },
      take: 20,
      select: {
        id: true,
        action: true,
        document_type: true,
        document_number: true,
        status: true,
        error_message: true,
        cufe: true,
        duration_ms: true,
        created_at: true,
        dian_configuration_id: true,
      },
    });

    // Certificate status — find the nearest expiry
    const default_config = configs.find((c) => c.certificate_expiry) || null;
    let certificate_status: {
      expires: Date | null;
      days_remaining: number | null;
      status: 'valid' | 'expiring_soon' | 'expired' | 'not_configured';
    } | null = null;

    if (default_config?.certificate_expiry) {
      const now = new Date();
      const expiry = new Date(default_config.certificate_expiry);
      const diff_ms = expiry.getTime() - now.getTime();
      const days_remaining = Math.ceil(diff_ms / (1000 * 60 * 60 * 24));

      let status: 'valid' | 'expiring_soon' | 'expired' = 'valid';
      if (days_remaining <= 0) status = 'expired';
      else if (days_remaining <= 30) status = 'expiring_soon';

      certificate_status = {
        expires: expiry,
        days_remaining,
        status,
      };
    } else {
      certificate_status = {
        expires: null,
        days_remaining: null,
        status: 'not_configured',
      };
    }

    return {
      stats: {
        total_sent,
        total_success,
        total_errors,
        success_rate,
      },
      recent_submissions,
      certificate_status,
      configs_summary: configs.map((c) => ({
        id: c.id,
        name: c.name,
        environment: c.environment,
        enablement_status: c.enablement_status,
      })),
    };
  }

  /**
   * Gets all DIAN configurations for the current store.
   * Ordered by: default first, then by creation date.
   */
  async getConfigs() {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    const configs = await this.prisma.withoutScope().dian_configurations.findMany({
      where:
        fiscalScope === 'ORGANIZATION'
          ? { organization_id, store_id: null }
          : { store_id: context.store_id },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });

    return configs.map((c) => this.maskSensitiveFields(c));
  }

  /**
   * Gets a single DIAN configuration by ID.
   */
  async getConfigById(id: number) {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    const config = await this.prisma.withoutScope().dian_configurations.findFirst({
      where:
        fiscalScope === 'ORGANIZATION'
          ? { id, organization_id, store_id: null }
          : { id, store_id: context.store_id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return this.maskSensitiveFields(config);
  }

  /**
   * Creates a new DIAN configuration for the current store.
   * Allows multiple configurations per store (multi-NIT).
   */
  async create(dto: CreateDianConfigDto) {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const store_id = this.requireStoreId(context.store_id);

    // Block store-level creation when fiscal_scope=ORGANIZATION: the DIAN
    // configuration is owned at the organization level in that case and must
    // be managed via the org wizard (OrgDianConfigService).
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );
    if (fiscalScope === 'ORGANIZATION') {
      throw new BadRequestException(
        'DIAN configuration is managed at organization level for this organization. Use the organization-level wizard.',
      );
    }

    // Check if this is the first config for this store
    const configuration_type = dto.configuration_type || 'invoicing';
    const operation_mode = dto.operation_mode || 'own_software';

    // La base restringe estas filas con el índice parcial
    // `dian_configurations_store_scope_uq` sobre
    // `(store_id, nit, configuration_type) WHERE store_id IS NOT NULL`. Sin este
    // pre-chequeo el duplicado llegaba a Postgres y volvía como P2002 crudo, que
    // el filtro global traduce a un 500 sin decir qué fila estorba.
    const duplicate = await this.prisma.dian_configurations.findFirst({
      where: { store_id, nit: dto.nit, configuration_type },
      select: { id: true, name: true },
    });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_002,
        `Ya existe una configuración DIAN con el NIT ${dto.nit} para ${
          configuration_type === 'invoicing'
            ? 'facturación electrónica'
            : configuration_type
        } en esta tienda ("${duplicate.name}"). Edítala en vez de crear otra.`,
        { configuration_id: duplicate.id, nit: dto.nit, configuration_type },
      );
    }

    const existing_count = await this.prisma.dian_configurations.count({
      where: { store_id, configuration_type },
    });

    const should_be_default = dto.is_default || existing_count === 0;
    const accounting_entity_id = await this.resolveAccountingEntityId(
      organization_id,
      store_id,
    );

    const config = await this.prisma.dian_configurations.create({
      data: {
        organization_id,
        store_id,
        accounting_entity_id,
        name: dto.name,
        nit: dto.nit,
        nit_type: dto.nit_type || 'NIT',
        nit_dv: dto.nit_dv,
        is_default: should_be_default,
        configuration_type,
        operation_mode,
        software_id: dto.software_id,
        software_pin_encrypted: this.encryption.encrypt(dto.software_pin),
        environment: dto.environment || 'test',
        enablement_status: 'not_started',
        test_set_id: dto.test_set_id,
        certificate_kms_key_id: dto.certificate_kms_key_id || null,
      },
    });

    if (should_be_default) {
      await this.ensureSingleDefault(config.id);
    }

    this.logger.log(
      `DIAN config "${dto.name}" created for store ${store_id}`,
    );

    return this.maskSensitiveFields(config);
  }

  /**
   * Updates a DIAN configuration.
   */
  async update(id: number, dto: UpdateDianConfigDto) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    if (config.store_id === null) {
      throw new BadRequestException(
        'DIAN configuration is managed at organization level for this organization.',
      );
    }

    const update_data: any = {};

    if (dto.name !== undefined) update_data.name = dto.name;
    if (dto.nit !== undefined) update_data.nit = dto.nit;
    if (dto.nit_type !== undefined) update_data.nit_type = dto.nit_type;
    if (dto.nit_dv !== undefined) update_data.nit_dv = dto.nit_dv;
    if (dto.is_default !== undefined) update_data.is_default = dto.is_default;
    if (dto.configuration_type !== undefined) {
      update_data.configuration_type = dto.configuration_type;
    }
    if (dto.operation_mode !== undefined) {
      update_data.operation_mode = dto.operation_mode;
    }
    if (dto.software_id !== undefined)
      update_data.software_id = dto.software_id;
    // Skip if masked sentinel — frontend sends '****' to indicate "no change"
    if (dto.software_pin !== undefined && dto.software_pin !== '****')
      update_data.software_pin_encrypted = this.encryption.encrypt(
        dto.software_pin,
      );
    // `environment` NO SUBE A PRODUCCIÓN POR AQUÍ.
    //
    // El camino correcto es `promoteToProduction`, que exige `readiness.ready` y
    // escribe TRES cosas: `environment`, `enablement_status: 'enabled'` y
    // `enabled_at`. Este PATCH plano escribía solo la primera, así que dejaba la
    // configuración apuntando a `vpfe.dian.gov.co` con `enablement_status` todavía
    // en habilitación — y la emisión acepta ese estado. Resultado: cada documento
    // se rechazaba por software no habilitado, gastando un consecutivo autorizado
    // irrecuperable por intento.
    //
    // Bajar a 'test' sí se permite: apunta al endpoint de pruebas, no puede
    // producir una emisión productiva falsa, y es el camino para repetir la
    // habilitación.
    //
    // Y solo se bloquea el CAMBIO real: si ya está en producción, reenviar
    // 'production' es un no-op. Rechazarlo sin esa condición rompería cualquier
    // PATCH del formulario que devuelva el objeto completo con su valor actual.
    if (dto.environment !== undefined) {
      if (
        dto.environment === 'production' &&
        config.environment !== 'production'
      ) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_ENABLEMENT_001,
          'El paso a producción no se hace editando la configuración. Usa ' +
            'promoteToProduction, que verifica la habilitación (readiness) y marca ' +
            'enablement_status antes de cambiar el ambiente.',
          { dian_configuration_id: config.id, attempted: dto.environment },
        );
      }
      update_data.environment = dto.environment;
    }
    if (dto.test_set_id !== undefined)
      update_data.test_set_id = dto.test_set_id;
    // Empty string means "go back to in-process custody", so it must reach the
    // column as NULL rather than as `''`. An empty-string ARN would make KMS
    // reject every signature with no way to withdraw it from the panel.
    if (dto.certificate_kms_key_id !== undefined) {
      update_data.certificate_kms_key_id =
        dto.certificate_kms_key_id === '' ? null : dto.certificate_kms_key_id;
    }
    if (
      dto.nit !== undefined ||
      dto.nit_type !== undefined ||
      dto.nit_dv !== undefined
    ) {
      update_data.accounting_entity_id = await this.resolveAccountingEntityId(
        config.organization_id,
        config.store_id,
      );
    }

    const updated = await this.prisma.dian_configurations.update({
      where: { id },
      data: update_data,
    });

    if (dto.is_default === true) {
      await this.ensureSingleDefault(id);
    }

    this.logger.log(`DIAN config ${id} updated`);

    return this.maskSensitiveFields(updated);
  }

  private async resolveAccountingEntityId(
    organization_id: number,
    store_id: number,
  ): Promise<number> {
    const entity = await this.fiscalScope.resolveAccountingEntityForFiscal({
      organization_id,
      store_id,
    });
    return entity.id;
  }

  /**
   * Stores the certificate password (encrypted) and S3 key after upload.
   */
  async updateCertificate(
    id: number,
    s3_key: string,
    password: string,
    expiry: Date | null,
    certificate_info?: CertificateValidationResult,
  ) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    if (config.store_id === null) {
      throw new BadRequestException(
        'DIAN configuration is managed at organization level for this organization.',
      );
    }

    const config_nit = this.onlyDigits(config.nit);
    const certificate_nit = this.onlyDigits(certificate_info?.tax_id);
    if (config_nit && !certificate_nit) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined, {
        dian_configuration_id: id,
        expected_nit: config_nit,
        certificate_nit: null,
      });
    }
    if (
      config_nit &&
      certificate_nit &&
      !certificateNitMatches({
        certificateTaxId: certificate_info?.tax_id,
        nit: config.nit,
        dv: config.nit_dv,
      })
    ) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined, {
        dian_configuration_id: id,
        expected_nit: config_nit,
        certificate_nit,
      });
    }

    const updated = await this.prisma.dian_configurations.update({
      where: { id },
      data: {
        certificate_s3_key: s3_key,
        certificate_password_encrypted: this.encryption.encrypt(password),
        certificate_expiry: expiry,
        certificate_fingerprint: certificate_info?.fingerprint,
        certificate_subject: certificate_info?.subject,
        certificate_issuer: certificate_info?.issuer,
        certificate_serial_number: certificate_info?.serial_number,
        certificate_nit: certificate_info?.tax_id,
        certificate_source: 'manual_upload_validated',
        certificate_uploaded_at: new Date(),
      },
    });

    this.logger.log(`Certificate updated for DIAN config ${id}`);

    return this.maskSensitiveFields(updated);
  }

  /**
   * Updates the enablement status of a DIAN configuration.
   */
  async updateStatus(
    id: number,
    status:
      | 'not_started'
      | 'testing'
      | 'test_set_passed'
      | 'enabled'
      | 'suspended'
      | 'expired',
  ) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    if (status === 'enabled') {
      // `enabled` REGISTRA UN HECHO DE LA DIAN, no concede permiso de emitir.
      //
      // Aquí se exigía `assertProductionReady`, que incluye tener la resolución de
      // numeración de PRODUCCIÓN. La DIAN separa las dos cosas y su propio correo de
      // habilitación lo dice: «ha finalizado el proceso de pruebas y actualmente se
      // encuentra en estado habilitado», y a continuación pide, como paso
      // POSTERIOR, «asociar y crear la numeración necesaria». Exigir la numeración
      // para registrar el estado dejaba al campo incapaz de expresar la realidad:
      // la plataforma estaba habilitada por la DIAN y en base seguía en
      // `test_set_passed`.
      //
      // La compuerta de emisión productiva no se relaja: sigue en
      // `promoteToProduction`, que exige `readiness.ready`, y en el gate que corre
      // antes de cada emisión. Lo que se separa es el REGISTRO del hecho.
      // Sobre la prueba DURABLE. Con el último lote, un reenvío fallido posterior
      // impedía marcar `enabled` una configuración que la DIAN ya había aprobado —
      // y descartar ese lote la degradaba, que es lo que pasó el 2026-08-09.
      if (!this.readiness.hasPassedTestSetForConfig(config)) {
        throw new VendixHttpException(
          ErrorCodes.DIAN_ENABLEMENT_001,
          'No se puede marcar la configuración como habilitada: la DIAN todavía no ' +
            'aprobó el set de pruebas. Ejecuta el set y espera su veredicto.',
          { dian_configuration_id: config.id },
        );
      }
    }

    return this.prisma.dian_configurations.update({
      where: { id },
      data: {
        enablement_status: status,
        enabled_at: status === 'enabled' ? new Date() : null,
      },
    });
  }

  /**
   * Answers a single question for the whole store: is this merchant ACTUALLY
   * issuing electronic invoices right now?
   *
   * The predicate is deliberately the same one the emission path enforces —
   * `environment='production'` AND `enablement_status='enabled'`, which is what
   * `promoteToProduction` sets. It is NOT the fiscal wizard's
   * `fiscal_status.invoicing.state`: that only says the wizard was completed, so
   * a store whose DIAN test set is still queued would look "active" while being
   * unable to issue anything. Callers that gate merchant-facing copy or the sale
   * document itself must use this, never the wizard state.
   *
   * Takes no id because the caller (the settings page, the POS) does not know
   * which configuration applies to it — resolving that is part of the answer.
   */
  async getEmissionStatus() {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          ...(fiscalScope === 'ORGANIZATION'
            ? { organization_id, store_id: null }
            : { store_id: context.store_id }),
          configuration_type: 'invoicing',
        },
        orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      });

    if (!config) {
      return {
        is_live: false,
        configuration_id: null,
        environment: null,
        enablement_status: null,
        reason:
          'Esta tienda todavía no tiene configuración de facturación electrónica.',
        blockers: [] as ProductionReadinessCheck[],
        warnings: [] as ProductionReadinessCheck[],
        actionable: [] as ProductionReadinessCheck[],
        waiting_on_dian: [] as ProductionReadinessCheck[],
      };
    }

    const is_live =
      config.environment === 'production' &&
      config.enablement_status === 'enabled';

    // Only pay for the checklist when the answer is "no" — that is the only case
    // where the caller needs to explain why.
    const readiness = is_live ? null : await this.getProductionReadiness(config.id);

    return {
      is_live,
      configuration_id: config.id,
      environment: config.environment,
      enablement_status: config.enablement_status,
      reason: is_live
        ? null
        : config.enablement_status === 'test_set_passed'
          ? 'La DIAN aprobó el set de pruebas. Falta activar producción.'
          : config.enablement_status === 'testing'
            ? 'El set de pruebas está en curso ante la DIAN.'
            : 'La configuración DIAN aún no está habilitada para producción.',
      // Solo lo que realmente bloquea: una alerta anticipada (certificado por
      // vencer, rango por agotarse) NO es un blocker — hoy se puede emitir.
      blockers: (readiness?.checks ?? []).filter(
        (c) => !c.satisfied && isBlockingCheck(c),
      ),
      warnings: (readiness?.checks ?? []).filter(
        (c) => !c.satisfied && !isBlockingCheck(c),
      ),
      // Mismo corte que el checklist de producción: lo que el comercio puede
      // hacer hoy, separado de lo que solo la DIAN puede resolver.
      actionable: (readiness?.checks ?? []).filter(
        (c) => !c.satisfied && isBlockingCheck(c) && isActionableCheck(c),
      ),
      waiting_on_dian: (readiness?.checks ?? []).filter(
        (c) => !c.satisfied && isBlockingCheck(c) && !isActionableCheck(c),
      ),
    };
  }

  /**
   * Read-only production readiness report for a configuration. Evaluated as if
   * the config were already in production + enabled, so the merchant sees the
   * prerequisites that remain *besides* the promotion itself.
   */
  async getProductionReadiness(id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });
    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    // La clave técnica del rango la asigna la DIAN por NIT: si está compartida con
    // otro NIT, el CUFE que calculamos no coincide con el que la DIAN recomputa y
    // el documento se rechaza con el consecutivo gastado. Se resuelve antes de
    // evaluar porque el evaluador es sincrónico por diseño.
    const shared_technical_key =
      await this.readiness.findResolutionsSharingTechnicalKey(
        {
          organization_id: config.organization_id,
          store_id: config.store_id,
          accounting_entity_id: config.accounting_entity_id,
          configuration_type: config.configuration_type,
        },
        // La evaluación se hace COMO SI fuera producción, así que el detector
        // también: en habilitación la ClTec compartida es lo normal.
        'production',
      );

    const report = this.readiness.evaluateProductionReadiness({
      ...config,
      environment: 'production',
      enablement_status: 'enabled',
      shared_technical_key,
    });

    const resolutions = await this.prisma.invoice_resolutions.findMany({
      where: { is_active: true, document_type: 'sales_invoice' },
      select: {
        id: true,
        prefix: true,
        resolution_number: true,
        range_from: true,
        range_to: true,
        current_number: true,
        valid_from: true,
        valid_to: true,
        technical_key: true,
      },
      orderBy: [{ id: 'desc' }],
    });

    const now = new Date();
    // The habilitación range (SETP 990000000-995000000) is DIAN's sandbox
    // numbering: it is NOT billable. Production needs an "Autorización de
    // Numeración de Facturación" obtained through Muisca, with its own prefix
    // and technical key — so a tenant whose only resolution is SETP is not ready
    // even when every credential check passes.
    const production_resolutions = resolutions
      .filter((r) => !isHabilitacionResolution(r.prefix))
      .filter((r) => r.valid_from <= now && r.valid_to >= now)
      .filter((r) => r.current_number < r.range_to);

    const resolution_check: ProductionReadinessCheck = {
      key: 'production_resolution',
      label: 'Resolución de numeración de producción vigente',
      satisfied: production_resolutions.length > 0,
      action:
        'Solicita la Autorización de Numeración de Facturación en Muisca y registra su prefijo, rango y clave técnica. El rango SETP de habilitación no sirve para facturar.',
      owner: 'tenant',
    };

    // Alerta de rango: se mide sobre la resolución de producción vigente con MÁS
    // recorrido restante. Avisar por la más agotada produciría una alerta
    // permanente en cuanto el tenant tuviera dos rangos y uno quedara casi
    // vacío, aunque el otro cubriera meses de facturación.
    const range_warning = production_resolutions.length
      ? production_resolutions
          .map((r) => this.readiness.buildResolutionRangeWarning(r))
          .sort(
            (a, b) => (b.percent_remaining ?? 0) - (a.percent_remaining ?? 0),
          )[0]
      : null;

    const checks = [
      ...report.checks,
      resolution_check,
      ...(range_warning ? [range_warning] : []),
    ];
    const unsatisfied = checks.filter((c) => !c.satisfied);
    const missing = unsatisfied.filter(isBlockingCheck).map((c) => c.key);
    const warnings = unsatisfied.filter((c) => !isBlockingCheck(c));
    const blocking = unsatisfied.filter(isBlockingCheck);

    return {
      ...report,
      warnings,
      actionable: blocking.filter(isActionableCheck),
      waiting_on_dian: blocking.filter((c) => !isActionableCheck(c)),
      // Report the CURRENT state, not the hypothetical one used to evaluate.
      environment: config.environment,
      enablement_status: config.enablement_status,
      ready: missing.length === 0,
      checks,
      missing,
      resolutions: resolutions.map((r) => ({
        ...r,
        is_habilitacion_range: isHabilitacionResolution(r.prefix),
        is_expired: r.valid_to < now,
        is_exhausted: r.current_number >= r.range_to,
      })),
    };
  }

  /**
   * Estado agregado de LAS CUATRO habilitaciones DIAN de la entidad fiscal.
   *
   * ## Qué contesta que `:id/production-readiness` no puede
   *
   * El checklist por `configId` exige saber de antemano que la configuración
   * existe. Los ejes que todavía NO se han configurado no tienen id por el que
   * preguntar, así que la pregunta que el comerciante realmente se hace al
   * abrir el panel —«¿qué me falta en cada eje?»— no tenía endpoint.
   *
   * La consecuencia no era teórica: el documento soporte, la nómina y el
   * documento equivalente quedaban invisibles hasta que alguien los creaba, y
   * nadie los creaba porque no se veían. Por eso LOS CUATRO EJES SE DEVUELVEN
   * SIEMPRE y el que no tiene configuración se reporta con
   * `enablement_status: 'not_started'` y `config_id: null` — un eje ausente de
   * la lista se lee como «no aplica», que es exactamente la lectura errónea
   * que hay que evitar.
   *
   * La lista de ejes sale de `DIAN_CONFIGURATION_TYPES`, no de un literal
   * local: añadir una habilitación al enum de Prisma la hace aparecer aquí
   * sola, sin que nadie tenga que acordarse de esta pantalla.
   */
  async getFiscalReadiness(): Promise<FiscalReadinessResponse> {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    // MISMO predicado que `getConfigs`. Es el que decide de quién es la
    // configuración: con `fiscal_scope=ORGANIZATION` vive en la organización
    // (`store_id: null`) y con `STORE` cuelga de la tienda del contexto.
    // Saltárselo mostraría la habilitación de una tienda dentro de otra.
    const configs = await this.prisma
      .withoutScope()
      .dian_configurations.findMany({
        where:
          fiscalScope === 'ORGANIZATION'
            ? { organization_id, store_id: null }
            : { store_id: context.store_id },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
        // Selección explícita y no la fila entera: deja auditable que
        // `enablement_evidence` y `last_test_result` viajan (los exige
        // `resolveTestSetProof`; sin la evidencia caería al último lote y
        // leería «no pasó» sobre una habilitación ya concedida) y que los dos
        // secretos cifrados se leen SOLO para comprobar su presencia — nunca
        // se copian a la respuesta, que solo lleva el informe de booleanos.
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          accounting_entity_id: true,
          configuration_type: true,
          operation_mode: true,
          environment: true,
          enablement_status: true,
          software_id: true,
          software_pin_encrypted: true,
          certificate_s3_key: true,
          certificate_password_encrypted: true,
          certificate_kms_key_id: true,
          certificate_expiry: true,
          certificate_fingerprint: true,
          certificate_nit: true,
          enablement_evidence: true,
          test_set_id: true,
          last_test_result: true,
          nit: true,
          nit_dv: true,
        },
      });

    const axes = await Promise.all(
      DIAN_CONFIGURATION_TYPES.map((configuration_type) =>
        this.buildFiscalReadinessAxis(
          configuration_type,
          // `find` sobre la lista YA ordenada: la predeterminada primero y, a
          // igualdad, la más antigua. Mismo criterio de desempate que
          // `getConfigs`, para que el panel y el listado no señalen a
          // configuraciones distintas cuando un eje tiene varias.
          configs.find((c) => c.configuration_type === configuration_type) ??
            null,
        ),
      ),
    );

    return { fiscal_scope: fiscalScope, axes };
  }

  /** Un eje del estado fiscal agregado. Ver {@link getFiscalReadiness}. */
  private async buildFiscalReadinessAxis(
    configuration_type: DianConfigurationType,
    config: FiscalReadinessConfigRow | null,
  ): Promise<FiscalReadinessAxis> {
    // El rótulo se deriva del contrato en vez de escribirse aquí: un rótulo
    // duplicado es un rótulo que termina desincronizado. El documento por
    // defecto del eje es el que lo representa (`equivalent_document` →
    // «Documento equivalente POS», nunca la factura de venta).
    const label = requirementsFor(
      defaultDocumentTypeFor(configuration_type),
    ).label;

    if (!config) {
      return {
        configuration_type,
        label,
        config_id: null,
        environment: null,
        // EXISTE y está sin empezar. No es lo mismo que no aparecer.
        enablement_status: 'not_started',
        readiness: null,
        resolutions: [],
      };
    }

    // La ClTec del rango la asigna la DIAN por NIT y alimenta el CUFE: si está
    // compartida con otro NIT, el CUFE que calculamos no coincide con el que la
    // DIAN recomputa y el documento se rechaza con el consecutivo ya gastado.
    //
    // Se resuelve AQUÍ y se pasa como dato porque `evaluateProductionReadiness`
    // es sincrónico a propósito. Omitirlo lo dejaría en `undefined`, que la
    // comprobación distingue de `null`: `null` es «comprobado y limpio»,
    // `undefined` es «no comprobado» y falla en abierto.
    const shared_technical_key =
      await this.readiness.findResolutionsSharingTechnicalKey(
        {
          organization_id: config.organization_id,
          store_id: config.store_id,
          accounting_entity_id: config.accounting_entity_id,
          configuration_type,
        },
        // Se evalúa COMO SI fuera producción, así que el detector también: en
        // habilitación la DIAN reparte la MISMA ClTec de prueba a todos y
        // compartirla ahí no es un hallazgo.
        'production',
      );

    const readiness = this.readiness.evaluateProductionReadiness({
      ...config,
      // Igual que `getProductionReadiness`: se evalúa como si el eje ya
      // estuviera promovido, para que el comerciante vea lo que le falta
      // ADEMÁS de la promoción misma y no una lista que se resuelve sola.
      environment: 'production',
      enablement_status: 'enabled',
      shared_technical_key,
    });

    // TODOS los documentos que cubre el eje, vía contrato: la habilitación de
    // facturación numera factura, nota crédito y nota débito, y mostrar solo la
    // factura escondería justo el rango que falta.
    const resolutions = await this.prisma
      .withoutScope()
      .invoice_resolutions.findMany({
        // Filtro de tenant EXPLÍCITO: `withoutScope()` no aplica ninguno, y la
        // entidad contable sale de una configuración que el predicado fiscal de
        // arriba ya acotó a este comerciante.
        where: {
          organization_id: config.organization_id,
          accounting_entity_id: config.accounting_entity_id,
          document_type: { in: documentTypesFor(configuration_type) },
        },
        select: {
          id: true,
          document_type: true,
          // Ambos viajan porque el formulario de edición los EXIGE: sin ellos
          // el host tendría que pedir `GET resolutions` sólo para rellenarlos, o
          // —peor— el comerciante reteclearía a mano el número que la DIAN
          // autorizó. Ninguno es secreto; el único que no sale es la ClTec.
          resolution_number: true,
          resolution_date: true,
          prefix: true,
          range_from: true,
          range_to: true,
          current_number: true,
          valid_from: true,
          valid_to: true,
          is_active: true,
          technical_key: true,
        },
        orderBy: [{ document_type: 'asc' }, { id: 'desc' }],
      });

    return {
      configuration_type,
      label,
      config_id: config.id,
      // El estado REAL, no el hipotético con el que se evaluó el checklist.
      environment: config.environment,
      enablement_status: config.enablement_status,
      readiness,
      resolutions: resolutions.map(({ technical_key, ...rest }) => ({
        ...rest,
        // La ClTec se ELIMINA, no se enmascara: quien la tiene puede
        // reconstruir la huella fiscal del comerciante. Solo viaja su
        // presencia. Mismo criterio que `tenant-resolutions.controller.ts`.
        technical_key_set: Boolean(technical_key),
      })),
    };
  }

  /**
   * Promotes a configuration to production: environment=production +
   * enablement_status=enabled, gated by the same readiness rules the emission
   * path enforces. Refuses (412) with the full checklist when anything is
   * missing, so the UI never has to guess why the switch was rejected.
   */
  async promoteToProduction(id: number) {
    const readiness = await this.getProductionReadiness(id);

    if (!readiness.ready) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_ENABLEMENT_001,
        'Faltan requisitos para pasar la facturación electrónica a producción.',
        { dian_configuration_id: id, missing: readiness.missing },
      );
    }

    const updated = await this.prisma.dian_configurations.update({
      where: { id },
      data: {
        environment: 'production',
        enablement_status: 'enabled',
        enabled_at: new Date(),
      },
    });

    this.logger.log(
      `DIAN config ${id} promoted to production (enablement_status=enabled)`,
    );

    return this.maskSensitiveFields(updated);
  }

  /**
   * Saves test set results to the DIAN configuration.
   */
  async saveTestResult(id: number, result: any) {
    return this.prisma.dian_configurations.update({
      where: { id },
      data: { last_test_result: result },
    });
  }

  /**
   * Sets a configuration as the default for the store.
   */
  async setDefault(id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    if (config.store_id === null) {
      throw new BadRequestException(
        'DIAN configuration is managed at organization level for this organization.',
      );
    }

    await this.prisma.dian_configurations.update({
      where: { id },
      data: { is_default: true },
    });

    await this.ensureSingleDefault(id);

    this.logger.log(`DIAN config ${id} set as default`);

    return this.getConfigById(id);
  }

  /**
   * Deletes a DIAN configuration.
   * If the deleted config was the default, promotes the next one.
   */
  async deleteConfig(id: number) {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    if (config.store_id === null) {
      throw new BadRequestException(
        'DIAN configuration is managed at organization level for this organization.',
      );
    }

    await this.prisma.dian_configurations.delete({
      where: { id },
    });

    // If deleted config was the default, promote the next one
    if (config.is_default) {
      const next = await this.prisma.dian_configurations.findFirst({
        where: { store_id: context.store_id },
        orderBy: { created_at: 'asc' },
      });

      if (next) {
        await this.prisma.dian_configurations.update({
          where: { id: next.id },
          data: { is_default: true },
        });
      }
    }

    this.logger.log(`DIAN config ${id} deleted`);
  }

  /**
   * Gets audit logs for the current store's DIAN configurations.
   * Optionally filtered by config_id.
   */
  async getAuditLogs(page = 1, limit = 20, config_id?: number) {
    const context = this.getContext();
    const organization_id = this.requireOrganizationId(context.organization_id);
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    let where_clause: any;

    if (config_id) {
      where_clause = { dian_configuration_id: config_id };
    } else {
      const configs = await this.prisma.withoutScope().dian_configurations.findMany({
        where:
          fiscalScope === 'ORGANIZATION'
            ? { organization_id, store_id: null }
            : { store_id: context.store_id },
        select: { id: true },
      });

      const config_ids = configs.map((c) => c.id);

      if (config_ids.length === 0) {
        return { data: [], total: 0, page, limit };
      }

      where_clause = { dian_configuration_id: { in: config_ids } };
    }

    const [data, total] = await Promise.all([
      this.prisma.dian_audit_logs.findMany({
        where: where_clause,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dian_audit_logs.count({
        where: where_clause,
      }),
    ]);

    return { data, total, page, limit };
  }

  /**
   * Ensures only one config is marked as default per store.
   * Sets is_default=false for all configs except the given one.
   */
  private async ensureSingleDefault(config_id: number) {
    const context = this.getContext();
    const config = await this.prisma.withoutScope().dian_configurations.findUnique({
      where: { id: config_id },
      select: {
        organization_id: true,
        store_id: true,
        configuration_type: true,
      },
    });

    if (!config) return;

    await this.prisma.dian_configurations.updateMany({
      where: {
        organization_id: config.organization_id,
        store_id: config.store_id ?? context.store_id,
        configuration_type: config.configuration_type,
        id: { not: config_id },
        is_default: true,
      },
      data: { is_default: false },
    });
  }
}
