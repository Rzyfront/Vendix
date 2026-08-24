import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { S3Service } from '../../../../common/services/s3.service';
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
  findInheritableCertificate,
  type InheritableCertificate,
} from './certificates/inheritance.util';
import { buildDianIdentityDocumentS3Key } from './certificates/certificate-s3-key.util';
import {
  DIAN_IDENTITY_DOCUMENT_LABELS,
  DIAN_IDENTITY_DOCUMENT_MAX_BYTES,
  DIAN_IDENTITY_DOCUMENT_MIME_TYPES,
  DIAN_IDENTITY_DOCUMENT_TYPES,
  DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS,
  allowedIdentityDocuments,
  missingIdentityDocuments,
  normalizePersonType,
  requiredIdentityDocuments,
  type DianIdentityDocumentType,
} from './certificates/identity-documents.contract';
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
    private readonly s3: S3Service,
    private readonly events: EventEmitter2,
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

    // QUI-679: Reutilizar cert de firma entre configs DIAN.
    //
    // Las cuatro habilitaciones (facturación, documento soporte, nómina,
    // documento equivalente) cuelgan de la misma `accounting_entity_id` y
    // comparten UN UNICO certificado de firma expedido por la DIAN. Subir el
    // mismo `.p12` tres veces —una por habilitación— era fricción sin valor:
    // las firmas son indistinguibles para la DIAN, y rotar el cert exige
    // acordarlo en todas las filas a la vez.
    //
    // Decisión: COPIAR, NO REFERENCIAR. Tres razones:
    //   1. `enablement_status` es POR FILA (la DIAN autoriza cada habilitación
    //      por separado; un cert puede servir una y no servir otra).
    //   2. La rotación manual debe AISLARSE: si QUIERE rotar el cert SOLO de
    //      soporte, las otras filas no se tocan.
    //   3. `certificate_password_encrypted` va cifrado — compartir el mismo
    //      ciphertext entre filas es señal de un bug latente (mismo blob,
    //      misma contraseña, mismo riesgo de fuga).
    //
    // El origen del cert queda registrado en:
    //   - `inherited_from_dian_configuration_id` (self-FK, columna nueva
    //     vía migración `20260813140000_dian_config_inherited_from`) para
    //     que audit queries distingan "cert copiado" de "cert subido"
    //     sin tocar `certificate_source_enum`.
    //   - `inherited_from` en la respuesta de la API para que la UI muestre
    //     el banner en el MISMO render sin un GET extra.
    //   - el log estructurado de abajo.
    const inheritable = await findInheritableCertificate({
      prisma: this.prisma.withoutScope(),
      logger: this.logger,
      accounting_entity_id,
      nit: dto.nit,
      nit_dv: dto.nit_dv,
    });

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
        // QUI-657. Las dos credenciales las EMITE la DIAN al inscribir el
        // software, y el tenant de la rama `without_cert` llega acá antes de
        // poder inscribirlo. La columna es NOT NULL, así que la ausencia se
        // guarda como cadena vacía — que es lo que los tres lectores del dato
        // (`fiscal-production-readiness`, el checklist de plataforma y el
        // directorio de tenants) ya leen como "sin configurar". Un centinela
        // tipo 'PENDING' daría un falso verde en el primero de ellos.
        software_id: dto.software_id ?? '',
        // COMPROBADO, no supuesto: `encrypt('')` NO es reversible. Produce
        // `v2:<salt>:<iv>:<tag>:` con el ciphertext vacío, y `parseEnvelope()`
        // exige `/^[0-9a-f]+$/` en ese segmento — así que devuelve `null` y
        // `decrypt()` lanza 'Invalid encrypted data format', mientras
        // `isEncrypted()` reporta `false`. Sería guardar 100 caracteres de
        // ruido que ningún lector puede abrir ni reconocer como cifrado.
        // Además `encrypt()` lanza FISCAL_ENCRYPTION_KEY_MISSING en producción
        // sin llave configurada: no vale la pena arriesgar una excepción para
        // cifrar un secreto que no tenemos.
        //
        // Por eso el vacío se escribe DIRECTO. `''` es falsy, así que
        // `needsReencryption`/`reencrypt` lo saltan y todo `Boolean(...)` del
        // checklist lo cuenta como pendiente, que es exactamente la verdad.
        software_pin_encrypted: dto.software_pin
          ? this.encryption.encrypt(dto.software_pin)
          : '',
        environment: dto.environment || 'test',
        enablement_status: 'not_started',
        // QUI-657. `without_cert` NO desbloquea nada: la fila queda esperando
        // documentos y `certificate_s3_key` sigue vacío, que es lo que el gate
        // de emisión mira. Es un estado de espera, no un permiso.
        //
        // Si heredó cert de una fila hermana (QUI-679) el trámite sobra: ya
        // tenemos el `.p12` de esa entidad fiscal, así que la rama pedida se
        // ignora y la fila nace en `not_required`.
        certificate_provisioning_status:
          dto.certificate_branch === 'without_cert' && !inheritable
            ? 'documents_pending'
            : 'not_required',
        test_set_id: dto.test_set_id,
        // QUI-679 review fix #3: el spread condicional de abajo es la ÚNICA
        // fuente de verdad para los campos de cert. Antes había una línea
        // explícita `certificate_kms_key_id: dto.certificate_kms_key_id || null`
        // ANTES del spread, y el spread la pisaba con `inheritable.fields...`
        // (que puede ser NULL cuando el cert fuente se subió antes de
        // soportar HSM ARN). El resultado: un usuario que pasaba un ARN de
        // KMS lo perdía en silencio al heredar. Ahora el campo sale de UN
        // solo bloque: heredado → del cert fuente; no heredado → del DTO.
        ...(inheritable
          ? {
              certificate_s3_key: inheritable.fields.certificate_s3_key,
              certificate_password_encrypted:
                inheritable.fields.certificate_password_encrypted,
              certificate_kms_key_id:
                inheritable.fields.certificate_kms_key_id,
              certificate_expiry: inheritable.fields.certificate_expiry,
              certificate_fingerprint:
                inheritable.fields.certificate_fingerprint,
              certificate_subject: inheritable.fields.certificate_subject,
              certificate_issuer: inheritable.fields.certificate_issuer,
              certificate_serial_number:
                inheritable.fields.certificate_serial_number,
              certificate_nit: inheritable.fields.certificate_nit,
              certificate_uploaded_at:
                inheritable.fields.certificate_uploaded_at,
              // QUI-679 review fix #6: persistir el puntero al cert fuente
              // para auditoría. Nullable: NULL = "cert subido directo a esta
              // fila" (caso histórico). Self-FK ON DELETE SET NULL.
              inherited_from_dian_configuration_id: inheritable.source.id,
            }
          : {
              certificate_kms_key_id: dto.certificate_kms_key_id || null,
            }),
      },
    });

    if (should_be_default) {
      await this.ensureSingleDefault(config.id);
    }

    if (inheritable) {
      this.logger.log(
        `DIAN config "${dto.name}" (${configuration_type}) inherited cert from ` +
          `sibling dian_configuration_id=${inheritable.source.id} ` +
          `(${inheritable.source.configuration_type}); expiry=${inheritable.fields.certificate_expiry?.toISOString() ?? 'unknown'}`,
      );
    }

    this.logger.log(
      `DIAN config "${dto.name}" created for store ${store_id}`,
    );

    return {
      ...this.maskSensitiveFields(config),
      inherited_certificate: inheritable !== null,
      inherited_from: inheritable
        ? {
            dian_configuration_id: inheritable.source.id,
            configuration_type: inheritable.source.configuration_type,
            certificate_expiry: inheritable.source.certificate_expiry,
          }
        : null,
    };
  }

  /**
   * Busca una fila hermana de `dian_configurations` que ya tenga cert de firma
   * asociado, para el mismo `accounting_entity_id`. Devuelve `null` si no hay
   * cert heredable (caso normal al crear la primera config) — `create()`
   * sigue su camino y deja que el usuario suba el cert después.
   *
   * `withoutScope()` se usa a propósito: la búsqueda cruza varias filas de
   * `configuration_type` (invoicing + support_document + payroll +
   * equivalent_document pueden coexistir) y el predicado natural acá es
   * `accounting_entity_id`, que **es** la frontera del scope fiscal
   * (`vendix-fiscal-scope` / `vendix-prisma-scopes`). Filtrar por
   * `organization_id` o `store_id` extra excluiría filas válidas del otro eje
   * y daría falsos negativos.
   *
   * `created_at ASC` hace Determinista la elección cuando hay varias filas
   * con cert: la más antigua gana. En la práctica es la fila `invoicing` —
   * casi siempre la primera que se crea.
   *
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
    // Vacío es "todavía no lo tengo", no "bórralo". El formulario del wizard
    // reenvía el objeto completo, así que un tenant en la rama `without_cert`
    // que edita cualquier otro campo mandaría `software_id: ''` en cada PATCH:
    // con la comparación contra `undefined` eso borraba un Software ID ya
    // registrado en silencio. Se retira por el mismo camino por el que se puso
    // (escribiendo el nuevo), nunca por omisión.
    if (dto.software_id) update_data.software_id = dto.software_id;
    // Dos valores que no son un PIN: '****' es el enmascarado que el front
    // reenvía para decir "no lo cambies", y '' es "aún no lo emiten". Ninguno
    // se cifra — ver la nota de `create()` sobre por qué `encrypt('')` no se
    // puede revertir.
    if (dto.software_pin && dto.software_pin !== '****')
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
      // Declara el override en vez de dejarlo implícito. La respuesta lleva
      // `environment` y `enablement_status` REALES en la cabecera y, más abajo,
      // sendos checks con esas mismas claves evaluados sobre los valores
      // forzados de arriba. Sin esta marca son dos afirmaciones opuestas sobre
      // el mismo campo en el mismo payload y el checklist se lee como roto.
      assume_production: true,
      shared_technical_key,
      // Repetir la ClTec entre dos rangos propios es un error de captura al
      // renovar, y la DIAN lo castiga rechazando con el consecutivo ya gastado.
      // Se resuelve aquí por lo mismo que el anterior: el evaluador es
      // sincrónico a propósito, para que la lista y el gate no diverjan.
      technical_key_uniqueness:
        await this.readiness.findDuplicateTechnicalKeys({
          organization_id: config.organization_id,
          store_id: config.store_id,
          accounting_entity_id: config.accounting_entity_id,
          configuration_type: config.configuration_type,
        }),
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
      assume_production: true,
      shared_technical_key,
      // La otra mitad de la comprobación de ClTec: no que sea de otro NIT, sino
      // que esté repetida en dos rangos de ESTE. La DIAN entrega una clave por
      // rango autorizado, así que la repetición sólo puede venir de haber
      // copiado la del rango anterior al renovar.
      technical_key_uniqueness:
        await this.readiness.findDuplicateTechnicalKeys({
          organization_id: config.organization_id,
          store_id: config.store_id,
          accounting_entity_id: config.accounting_entity_id,
          configuration_type,
        }),
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

  // =====================================================================
  // QUI-657 — Activación fiscal SIN certificado de firma.
  //
  // Un tenant que no tiene `.p12` entrega documentos de identidad; la
  // plataforma tramita el certificado ante la entidad emisora y lo carga por
  // él. Nada de esto relaja el gate de emisión: `fiscal-production-readiness`
  // exige `certificate_s3_key`, y esa columna solo se puebla cuando el cert
  // expedido llega. Hasta entonces la tienda NO factura, por diseño y por ley.
  //
  // BILLING_HOOK: hoy el trámite es GRATIS (decisión de producto, 2026-08-13).
  // Cuando se cobre, el cargo va aquí —en `submitIdentityDocuments`, que es el
  // punto donde el tenant acepta el trámite— vía `vendix-saas-billing`, y el
  // paso a `documents_submitted` debe quedar condicionado al cobro exitoso.
  // =====================================================================

  /**
   * Carga la config y su `person_type` en una sola lectura.
   *
   * El `person_type` sale de `organizations` y NO de `users`: el certificado se
   * expide a nombre de la ENTIDAD FISCAL titular del NIT, no de la persona que
   * está sentada frente al wizard. Un empleado persona-natural tramitando el
   * cert de la sociedad que lo emplea es el caso normal, no la excepción.
   *
   * `withoutScope()` porque este método sirve tanto al tenant (que ya pasó por
   * el guard de permisos y por el scope de su store) como al superadmin, que
   * lee la cola de TODOS los tenants por definición. La autorización la ponen
   * los `@Permissions` del controlador, no este SELECT.
   *
   * Hotfix post-PR-576: el predicado de tenant va AQUÍ, no en el controlador.
   * Un handler tenant-facing que recibe `:id` debe responder 404 cuando ese
   * `id` pertenece a otro tenant — eso es autorización por fila, no por
   * permiso. Los 5 handlers superadmin cruzan tenants a propósito y llaman a
   * `loadConfigForIdentityDocumentsAsSuperAdmin`; los 4 tenant-facing llaman
   * a este método y obtienen 404 cuando el `store_id` o `organization_id` no
   * matchea el contexto.
   */
  private async loadConfigForIdentityDocuments(config_id: number) {
    const context = this.getContext();
    const organizationId = context?.organization_id;
    const storeId = context?.store_id;

    // Tenant scope guard (hotfix post-PR-576): el método exige un
    // contexto con tenant resuelto. Sin él, no hay predicado de propiedad
    // aplicable y respondemos 404 antes de tocar la DB.
    if (!organizationId && !storeId) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    // `requireFiscalScope` solo aplica en alcance ORGANIZATION. En
    // alcance STORE la organización del cert puede ser nula (es de la
    // tienda); usamos el predicado por store_id y saltamos el lookup de
    // organización para evitar un 400 espurio.
    const fiscalScope = storeId
      ? 'STORE'
      : await this.fiscalScope.requireFiscalScope(organizationId as number);

    const where =
      fiscalScope === 'ORGANIZATION'
        ? { id: config_id, organization_id: organizationId, store_id: null }
        : { id: config_id, store_id: storeId };

    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where,
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          nit: true,
          nit_dv: true,
          name: true,
          configuration_type: true,
          certificate_s3_key: true,
          certificate_provisioning_status: true,
          organization: { select: { person_type: true, name: true } },
          store: { select: { name: true } },
        },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    return config;
  }

  /**
   * Variante superadmin del loader: cruza el límite de tenant a propósito.
   * Solo callable desde handlers detrás de `RolesGuard + SUPER_ADMIN`. Los
   * 5 endpoints `super-admin/fiscal/certificates-pending/*` usan este método;
   * los 4 endpoints `/store/invoicing/dian-config/:id/identity-documents*`
   * usan el `loadConfigForIdentityDocuments` tenant-scoped.
   */
  private async loadConfigForIdentityDocumentsAsSuperAdmin(
    config_id: number,
  ) {
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findUnique({
        where: { id: config_id },
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          nit: true,
          nit_dv: true,
          name: true,
          configuration_type: true,
          certificate_s3_key: true,
          certificate_provisioning_status: true,
          organization: { select: { person_type: true, name: true } },
          store: { select: { name: true } },
        },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }
    return config;
  }

  /**
   * Sube un documento de identidad y lo registra.
   *
   * Se guarda la CLAVE S3, nunca una URL firmada (`vendix-s3-storage`): una URL
   * persistida caduca y deja la fila apuntando a un enlace muerto, además de
   * ser un secreto de acceso guardado en texto plano.
   */
  async uploadIdentityDocument(params: {
    config_id: number;
    document_type: string;
    file: Express.Multer.File;
    uploaded_by_user_id?: number | null;
  }) {
    const { config_id, file } = params;
    const config = await this.loadConfigForIdentityDocuments(config_id);

    if (!file || !file.buffer?.length) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_001,
        'No se recibió ningún archivo. Verifica que el formulario sea multipart/form-data y que el campo se llame "document".',
      );
    }

    const document_type = String(params.document_type ?? '')
      .trim()
      .toLowerCase() as DianIdentityDocumentType;

    if (!DIAN_IDENTITY_DOCUMENT_TYPES.includes(document_type)) {
      throw new BadRequestException(
        `document_type inválido. Valores admitidos: ${DIAN_IDENTITY_DOCUMENT_TYPES.join(', ')}.`,
      );
    }

    // Una persona natural no tiene certificado de existencia y representación
    // legal — no es que sea opcional, es que no existe. Rechazarlo acá con 400
    // evita que el expediente llegue a la entidad emisora con un documento que
    // va a rechazar, y que el tenant se entere semanas después.
    const person_type = config.organization?.person_type ?? null;
    const allowed = allowedIdentityDocuments(person_type);
    if (!allowed.includes(document_type)) {
      throw new BadRequestException(
        `"${DIAN_IDENTITY_DOCUMENT_LABELS[document_type]}" no aplica para una persona ${normalizePersonType(person_type)}. ` +
          `Documentos admitidos: ${allowed.map((t) => DIAN_IDENTITY_DOCUMENT_LABELS[t]).join(', ')}.`,
      );
    }

    if (file.size > DIAN_IDENTITY_DOCUMENT_MAX_BYTES) {
      throw new BadRequestException(
        `El archivo pesa ${(file.size / 1024 / 1024).toFixed(1)} MB y el máximo es ${DIAN_IDENTITY_DOCUMENT_MAX_BYTES / 1024 / 1024} MB.`,
      );
    }

    if (
      !(DIAN_IDENTITY_DOCUMENT_MIME_TYPES as readonly string[]).includes(
        file.mimetype,
      )
    ) {
      throw new BadRequestException(
        `Tipo de archivo no admitido (${file.mimetype}). Admitidos: PDF, JPG, PNG o WEBP.`,
      );
    }

    // Un mismo `document_type` no puede estar dos veces: el expediente tendría
    // dos RUT y nadie sabría cuál es el bueno. Resubir REEMPLAZA la fila; el
    // objeto S3 anterior NO se borra (retención indefinida, y la clave lleva
    // timestamp para que no se pisen), así que una auditoría puede reconstruir
    // qué se entregó y cuándo.
    const extension = (file.originalname?.split('.').pop() ?? '')
      .toLowerCase()
      .slice(0, 10);

    const s3_key = buildDianIdentityDocumentS3Key({
      organization_id: config.organization_id,
      store_id: config.store_id,
      dian_configuration_id: config.id,
      document_type,
      extension,
    });

    await this.s3.uploadFile(file.buffer, s3_key, file.mimetype);

    const client = this.prisma.withoutScope();
    await client.dian_configuration_documents.deleteMany({
      where: { dian_configuration_id: config.id, document_type },
    });

    const row = await client.dian_configuration_documents.create({
      data: {
        dian_configuration_id: config.id,
        document_type,
        s3_key,
        uploaded_by_user_id: params.uploaded_by_user_id ?? null,
        original_filename: file.originalname?.slice(0, 255) ?? null,
        size_bytes: BigInt(file.size),
        mime_type: file.mimetype,
      },
    });

    // Subir un documento sobre una fila `not_required` significa que el tenant
    // se pasó a la rama "no tengo cert" sin volver a crear la configuración.
    // Se refleja el hecho en vez de dejar el estado mintiendo.
    if (config.certificate_provisioning_status === 'not_required') {
      await client.dian_configurations.update({
        where: { id: config.id },
        data: { certificate_provisioning_status: 'documents_pending' },
      });
    }

    return this.serializeIdentityDocument(row);
  }

  /**
   * `size_bytes` es `BigInt` en Prisma y `JSON.stringify` no sabe serializarlo:
   * devolverlo crudo revienta la respuesta con un `TypeError` que el filtro
   * global traduce a un 500 opaco. Se convierte a `number` acá, en el borde.
   */
  private serializeIdentityDocument(row: {
    id: number;
    document_type: string;
    s3_key: string;
    uploaded_at: Date;
    original_filename: string | null;
    size_bytes: bigint | null;
    mime_type: string | null;
    uploaded_by_user_id: number | null;
  }) {
    return {
      id: row.id,
      document_type: row.document_type,
      label:
        DIAN_IDENTITY_DOCUMENT_LABELS[
          row.document_type as DianIdentityDocumentType
        ] ?? row.document_type,
      uploaded_at: row.uploaded_at,
      original_filename: row.original_filename,
      size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
      mime_type: row.mime_type,
      uploaded_by_user_id: row.uploaded_by_user_id,
    };
  }

  /**
   * Estado del trámite: qué se subió, qué falta y si ya se puede enviar.
   *
   * `include_urls` firma una URL por documento con vida corta
   * (`DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS`). Se pide explícitamente y no
   * viene por defecto: firmar es un efecto —crea un enlace que abre un
   * documento de identidad a cualquiera que lo tenga— y no debe ocurrir en un
   * listado que solo quería contar cuántos archivos hay.
   */
  async getIdentityDocumentStatus(
    config_id: number,
    options: { include_urls?: boolean } = {},
  ) {
    const config = await this.loadConfigForIdentityDocuments(config_id);
    const person_type = config.organization?.person_type ?? null;

    const rows = await this.prisma
      .withoutScope()
      .dian_configuration_documents.findMany({
        where: { dian_configuration_id: config.id },
        orderBy: { uploaded_at: 'asc' },
      });

    const documents = await Promise.all(
      rows.map(async (row) => {
        const base = this.serializeIdentityDocument(row);
        if (!options.include_urls) return base;
        return {
          ...base,
          download_url: await this.s3.getPresignedUrl(
            row.s3_key,
            DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS,
          ),
          download_url_expires_in_seconds:
            DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS,
        };
      }),
    );

    const missing = missingIdentityDocuments(
      person_type,
      rows.map((r) => r.document_type),
    );

    return {
      dian_configuration_id: config.id,
      certificate_provisioning_status: config.certificate_provisioning_status,
      person_type: normalizePersonType(person_type),
      required_documents: requiredIdentityDocuments(person_type),
      missing_documents: missing,
      can_submit: missing.length === 0,
      documents,
    };
  }

  /**
   * Borra un documento ya subido. Solo mientras el expediente esté en manos del
   * tenant (`documents_pending` / `documents_submitted`): una vez que el
   * superadmin empezó a tramitar (`issuing`) o el cert ya fue expedido
   * (`issued`), el expediente es la evidencia de con qué identidad se expidió y
   * deja de ser editable.
   *
   * Borra la FILA, no el objeto S3 (retención indefinida).
   */
  async deleteIdentityDocument(config_id: number, document_id: number) {
    const config = await this.loadConfigForIdentityDocuments(config_id);

    if (
      config.certificate_provisioning_status !== 'documents_pending' &&
      config.certificate_provisioning_status !== 'documents_submitted'
    ) {
      throw new BadRequestException(
        `No se pueden modificar los documentos: el trámite está en estado "${config.certificate_provisioning_status}".`,
      );
    }

    const client = this.prisma.withoutScope();
    const row = await client.dian_configuration_documents.findFirst({
      where: { id: document_id, dian_configuration_id: config.id },
      select: { id: true },
    });
    if (!row) {
      throw new BadRequestException('El documento no existe en este trámite.');
    }

    await client.dian_configuration_documents.delete({
      where: { id: row.id },
    });

    return this.getIdentityDocumentStatus(config.id);
  }

  /**
   * El tenant da por entregado el expediente: pasa a la cola del superadmin.
   *
   * Valida el juego completo ANTES de mover el estado. Un expediente
   * incompleto en la cola le hace perder el viaje a un humano y devuelve al
   * tenant a la casilla de salida días después.
   */
  async submitIdentityDocuments(config_id: number) {
    const config = await this.loadConfigForIdentityDocuments(config_id);
    const person_type = config.organization?.person_type ?? null;

    if (config.certificate_s3_key) {
      throw new BadRequestException(
        'Esta configuración ya tiene un certificado de firma cargado. No hay trámite que enviar.',
      );
    }

    const rows = await this.prisma
      .withoutScope()
      .dian_configuration_documents.findMany({
        where: { dian_configuration_id: config.id },
        select: { document_type: true },
      });

    const missing = missingIdentityDocuments(
      person_type,
      rows.map((r) => r.document_type),
    );

    if (missing.length > 0) {
      throw new BadRequestException(
        `Faltan documentos obligatorios: ${missing
          .map((t) => DIAN_IDENTITY_DOCUMENT_LABELS[t])
          .join(', ')}.`,
      );
    }

    // BILLING_HOOK: si el trámite pasa a ser cobrado, el cargo va exactamente
    // aquí —antes del cambio de estado— y `documents_submitted` solo se escribe
    // cuando el cobro liquida. Hoy es gratis por decisión de producto.

    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: { certificate_provisioning_status: 'documents_submitted' },
    });

    // Aviso a plataforma. Se emite como evento y no se escribe la notificación
    // acá porque el destinatario es el equipo de plataforma, no la tienda:
    // `NotificationsService.createAndBroadcast` es store-scoped y mandaría el
    // aviso justo a quien ya sabe que lo envió. La cola del superadmin
    // (`GET /super-admin/fiscal/certificates-pending`) es la vía de visibilidad
    // garantizada; el evento permite engancharle correo o Slack sin tocar esto.
    this.events.emit('dian.certificate.documents_submitted', {
      dian_configuration_id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
      nit: config.nit,
      nit_dv: config.nit_dv,
      person_type: normalizePersonType(person_type),
      configuration_type: config.configuration_type,
      submitted_at: new Date().toISOString(),
    });

    this.logger.log(
      `QUI-657: expediente de certificado enviado para dian_configuration_id=${config.id} ` +
        `(NIT ${config.nit}, ${normalizePersonType(person_type)}); a la espera de superadmin.`,
    );

    return this.getIdentityDocumentStatus(config.id);
  }

  // ---------------------------------------------------------------------
  // Superadmin — cola de certificados por tramitar.
  //
  // PERMISO: se reutiliza `superadmin:*` en vez de crear
  // `superadmin:fiscal:read-identity-docs` (decisión de producto, 2026-08-13).
  // Esto CONTRADICE la dirección de QUI-603, que empuja hacia permisos
  // granulares y está en In Review. Se acepta a sabiendas: partir el permiso
  // después es una migración de seed, no un cambio de forma de estos
  // endpoints. Cuando QUI-603 aterrice, este es el sitio a revisar.
  // ---------------------------------------------------------------------

  /**
   * Expedientes esperando que la plataforma tramite el certificado.
   *
   * Cruza tenants a propósito —es una cola de operación de plataforma— y por
   * eso va detrás de `superadmin:*`. `certificate_s3_key: null` en el predicado
   * es un cinturón sobre el estado: una fila que ya recibió cert no tiene por
   * qué seguir en la cola aunque su estado se haya quedado atrás.
   */
  async listPendingCertificateRequests(params: { statuses?: string[] } = {}) {
    const statuses = params.statuses?.length
      ? params.statuses
      : ['documents_submitted', 'issuing'];

    const rows = await this.prisma
      .withoutScope()
      .dian_configurations.findMany({
        where: {
          certificate_provisioning_status: { in: statuses as any },
          certificate_s3_key: null,
        },
        orderBy: { updated_at: 'asc' },
        select: {
          id: true,
          organization_id: true,
          store_id: true,
          name: true,
          nit: true,
          nit_dv: true,
          configuration_type: true,
          certificate_provisioning_status: true,
          updated_at: true,
          created_at: true,
          organization: { select: { name: true, person_type: true } },
          store: { select: { name: true } },
          identity_documents: {
            select: {
              id: true,
              document_type: true,
              original_filename: true,
              mime_type: true,
              size_bytes: true,
              uploaded_at: true,
              uploaded_by_user_id: true,
            },
            orderBy: { uploaded_at: 'asc' },
          },
        },
      });

    return rows.map((row) => ({
      id: row.id,
      organization_id: row.organization_id,
      organization_name: row.organization?.name ?? null,
      store_id: row.store_id,
      store_name: row.store?.name ?? null,
      name: row.name,
      nit: row.nit,
      nit_dv: row.nit_dv,
      configuration_type: row.configuration_type,
      certificate_provisioning_status: row.certificate_provisioning_status,
      person_type: normalizePersonType(row.organization?.person_type),
      requested_at: row.updated_at ?? row.created_at,
      documents: row.identity_documents.map((d) =>
        this.serializeIdentityDocument({ ...d, s3_key: '' }),
      ),
    }));
  }

  /**
   * URL firmada de vida corta para que el superadmin abra UN documento.
   *
   * Se firma de a uno y bajo petición explícita: cada URL emitida es una copia
   * del documento de identidad circulando fuera de la sesión, así que se emiten
   * las mínimas y caducan en 5 minutos.
   */
  async getIdentityDocumentDownloadUrl(config_id: number, document_id: number) {
    const row = await this.prisma
      .withoutScope()
      .dian_configuration_documents.findFirst({
        where: { id: document_id, dian_configuration_id: config_id },
      });

    if (!row) {
      throw new BadRequestException('El documento no existe en este trámite.');
    }

    return {
      ...this.serializeIdentityDocument(row),
      download_url: await this.s3.getPresignedUrl(
        row.s3_key,
        DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS,
      ),
      expires_in_seconds: DIAN_IDENTITY_DOCUMENT_URL_TTL_SECONDS,
    };
  }

  /** Marca el expediente como en trámite ante la entidad emisora. */
  async markCertificateIssuing(config_id: number) {
    const config = await this.loadConfigForIdentityDocumentsAsSuperAdmin(
      config_id,
    );

    if (config.certificate_provisioning_status !== 'documents_submitted') {
      throw new BadRequestException(
        `Solo un expediente en "documents_submitted" puede pasar a trámite (está en "${config.certificate_provisioning_status}").`,
      );
    }

    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: { certificate_provisioning_status: 'issuing' },
    });

    return this.getIdentityDocumentStatus(config.id);
  }

  /**
   * Rechaza el expediente y lo devuelve al tenant.
   *
   * Vuelve a `documents_pending` y NO a `rejected` como estado terminal: el
   * tenant tiene que poder corregir y reenviar, y desde `rejected` los
   * endpoints de carga estarían cerrados. `rejected` queda para un rechazo
   * definitivo de la entidad emisora, que hoy no tiene flujo.
   */
  async rejectCertificateRequest(config_id: number, reason: string) {
    const config = await this.loadConfigForIdentityDocumentsAsSuperAdmin(
      config_id,
    );

    if (!reason?.trim()) {
      throw new BadRequestException(
        'Se requiere un motivo de rechazo: el tenant tiene que saber qué corregir.',
      );
    }

    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: { certificate_provisioning_status: 'documents_pending' },
    });

    this.events.emit('dian.certificate.documents_rejected', {
      dian_configuration_id: config.id,
      organization_id: config.organization_id,
      store_id: config.store_id,
      reason: reason.trim(),
    });

    this.logger.warn(
      `QUI-657: expediente rechazado para dian_configuration_id=${config.id}: ${reason.trim()}`,
    );

    return this.getIdentityDocumentStatus(config.id);
  }

  /**
   * El superadmin carga el certificado que la entidad emisora expidió.
   *
   * NO reutiliza `updateCertificate` a propósito, por dos razones que lo hacen
   * inaplicable acá: (1) lee y escribe por el cliente Prisma SCOPEADO, que en
   * una sesión de superadmin no resuelve al tenant dueño de la fila; y (2)
   * rechaza `store_id === null`, que es justo el caso de una organización de
   * alcance-organización, la más probable de delegar el trámite. La validación
   * de NIT sí se comparte —`certificateNitMatches`—, que es la parte que
   * protege de publicar un cert ajeno.
   *
   * `certificate_source = 'issuer_adapter'` distingue este cert del que sube el
   * propio tenant: no lo validó el comerciante, lo tramitamos nosotros, y esa
   * diferencia importa en una auditoría de custodia. El valor ya existía en el
   * enum; no se agregó nada.
   *
   * Recién con `certificate_s3_key` poblado el gate de
   * `fiscal-production-readiness` deja pasar la emisión. El gate no se tocó.
   */
  async uploadIssuedCertificate(params: {
    config_id: number;
    s3_key: string;
    password: string;
    expiry: Date | null;
    certificate_info?: CertificateValidationResult;
  }) {
    const { config_id, s3_key, password, expiry, certificate_info } = params;
    const client = this.prisma.withoutScope();

    const config = await client.dian_configurations.findUnique({
      where: { id: config_id },
      select: { id: true, nit: true, nit_dv: true, name: true },
    });
    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    if (!password?.trim()) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CERT_002,
        'La contraseña del certificado es obligatoria.',
      );
    }

    const config_nit = this.onlyDigits(config.nit);
    const certificate_nit = this.onlyDigits(certificate_info?.tax_id);
    if (
      config_nit &&
      (!certificate_nit ||
        !certificateNitMatches({
          certificateTaxId: certificate_info?.tax_id,
          nit: config.nit,
          dv: config.nit_dv,
        }))
    ) {
      throw new VendixHttpException(ErrorCodes.DIAN_CERT_004, undefined, {
        dian_configuration_id: config_id,
        expected_nit: config_nit,
        certificate_nit: certificate_nit || null,
      });
    }

    const updated = await client.dian_configurations.update({
      where: { id: config_id },
      data: {
        certificate_s3_key: s3_key,
        certificate_password_encrypted: this.encryption.encrypt(password),
        certificate_expiry: expiry,
        certificate_fingerprint: certificate_info?.fingerprint,
        certificate_subject: certificate_info?.subject,
        certificate_issuer: certificate_info?.issuer,
        certificate_serial_number: certificate_info?.serial_number,
        certificate_nit: certificate_info?.tax_id,
        certificate_source: 'issuer_adapter',
        certificate_uploaded_at: new Date(),
        certificate_provisioning_status: 'issued',
      },
    });

    this.events.emit('dian.certificate.issued', {
      dian_configuration_id: config_id,
      organization_id: updated.organization_id,
      store_id: updated.store_id,
    });

    this.logger.log(
      `QUI-657: certificado expedido cargado por plataforma para dian_configuration_id=${config_id} ` +
        `("${config.name}", NIT ${config.nit}); certificate_source=issuer_adapter.`,
    );

    return this.maskSensitiveFields(updated);
  }
}
