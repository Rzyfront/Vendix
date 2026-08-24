import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateDianConfigDto } from '../../../store/invoicing/dian-config/dto/create-dian-config.dto';
import { UpdateDianConfigDto } from '../../../store/invoicing/dian-config/dto/update-dian-config.dto';
import { CertificateValidationResult } from '../../../store/invoicing/dian-config/certificates/certificate-issuer.interface';
import { certificateNitMatches } from '../../../store/invoicing/dian-config/certificates/nit-match.util';
import { findInheritableCertificate } from '../../../store/invoicing/dian-config/certificates/inheritance.util';

/**
 * Organization-level twin of the store DIAN config service.
 *
 * Reasoning: `dian_configurations` may be store-scoped (store_id NOT NULL) when
 * `organizations.fiscal_scope = STORE`, or organization-scoped (store_id IS NULL)
 * when `fiscal_scope = ORGANIZATION`. This service:
 *  - For fiscal_scope=ORGANIZATION, creates rows with store_id = NULL anchored
 *    to organization_id only. No store auto-pick fallback.
 *  - For fiscal_scope=STORE, requires an explicit store_id from the DTO and
 *    creates per-store rows; throws 400 if missing.
 */
@Injectable()
export class OrgDianConfigService {
  private readonly logger = new Logger(OrgDianConfigService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly encryption: EncryptionService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private requireOrganizationId(): number {
    const context = RequestContextService.getContext();
    if (!context || typeof context.organization_id !== 'number') {
      throw new BadRequestException('Organization context is required');
    }
    return context.organization_id;
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
   * Lists all DIAN configurations for the current organization.
   * Optionally filtered by store_id (breakdown).
   */
  async getConfigs(store_id?: number) {
    const organization_id = this.requireOrganizationId();
    const where: any = { organization_id };
    if (typeof store_id === 'number') {
      where.store_id = store_id;
    }

    const configs = await this.prisma
      .withoutScope()
      .dian_configurations.findMany({
        where,
        include: {
          store: { select: { id: true, name: true, slug: true } },
        },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
      });

    return configs.map((c: any) => this.maskSensitiveFields(c));
  }

  /**
   * Returns a single DIAN configuration, ensuring it belongs to the current org.
   */
  async getConfigById(id: number) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: { id, organization_id },
        include: {
          store: { select: { id: true, name: true, slug: true } },
        },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return this.maskSensitiveFields(config);
  }

  /**
   * Creates a new DIAN configuration honoring the org's fiscal_scope:
   *  - ORGANIZATION → store_id = null (anchored to organization only).
   *  - STORE        → store_id required (from DTO); throws 400 if missing.
   */
  async create(dto: CreateDianConfigDto & { store_id?: number }) {
    const organization_id = this.requireOrganizationId();
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    let resolved_store_id: number | null = null;
    if (fiscalScope === 'STORE') {
      if (typeof dto.store_id !== 'number') {
        throw new BadRequestException(
          'store_id is required when fiscal_scope=STORE',
        );
      }
      resolved_store_id = dto.store_id;
    }
    // For ORGANIZATION: ignore any dto.store_id; row is anchored to org only.

    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id,
        store_id: resolved_store_id,
      });

    const configuration_type = dto.configuration_type || 'invoicing';
    const operation_mode = dto.operation_mode || 'own_software';

    // Mismo eje que los índices parciales que restringen la tabla:
    // `(organization_id, nit, configuration_type) WHERE store_id IS NULL` para
    // las filas de organización y `(store_id, nit, configuration_type)
    // WHERE store_id IS NOT NULL` para las de tienda. Sin el pre-chequeo el
    // duplicado sale como P2002 crudo, es decir un 500 sin explicación.
    const duplicate = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: {
          nit: dto.nit,
          configuration_type,
          ...(resolved_store_id === null
            ? { organization_id, store_id: null }
            : { store_id: resolved_store_id }),
        },
        select: { id: true, name: true },
      });
    if (duplicate) {
      throw new VendixHttpException(
        ErrorCodes.DIAN_CONFIG_002,
        `Ya existe una configuración DIAN con el NIT ${dto.nit} para ${
          configuration_type === 'invoicing'
            ? 'facturación electrónica'
            : configuration_type
        } en este alcance ("${duplicate.name}"). Edítala en vez de crear otra.`,
        { configuration_id: duplicate.id, nit: dto.nit, configuration_type },
      );
    }

    const existing_count = await this.prisma
      .withoutScope()
      .dian_configurations.count({
        where: {
          organization_id,
          configuration_type,
          ...(resolved_store_id === null
            ? { store_id: null }
            : { store_id: resolved_store_id }),
        },
      });

    const should_be_default = dto.is_default || existing_count === 0;

    // QUI-679: MISMO helper que la versión de tienda (`DianConfigService`).
    // El predicado es la `accounting_entity_id`, no el alcance fiscal — un
    // tenant con `fiscal_scope=ORGANIZATION` y varios ejes (facturación,
    // documento soporte, nómina, equivalente) cuelga TODOS de la misma
    // entidad contable, así que la búsqueda es idéntica. Sin este espejo,
    // los tenants org-scoped tenían que re-subir el mismo `.p12` por cada
    // habilitación (Fix #1 del review).
    const inheritable = await findInheritableCertificate({
      prisma: this.prisma.withoutScope(),
      logger: this.logger,
      accounting_entity_id: accounting_entity.id,
      nit: dto.nit,
      nit_dv: dto.nit_dv,
    });

    const config = await this.prisma
      .withoutScope()
      .dian_configurations.create({
        data: {
          organization_id,
          store_id: resolved_store_id,
          accounting_entity_id: accounting_entity.id,
          name: dto.name,
          nit: dto.nit,
          nit_type: dto.nit_type || 'NIT',
          nit_dv: dto.nit_dv,
          is_default: should_be_default,
          configuration_type,
          operation_mode,
          // QUI-657, mismo contrato que el servicio de tienda: las dos
          // credenciales las emite la DIAN al inscribir el software y el
          // tenant de la rama `without_cert` todavía no las tiene. Columnas
          // NOT NULL, así que la ausencia se guarda como cadena vacía — el
          // valor que los lectores del checklist ya cuentan como pendiente.
          software_id: dto.software_id ?? '',
          // El vacío NO se cifra: `encrypt('')` deja el ciphertext vacío en el
          // sobre `v2:salt:iv:tag:` y `parseEnvelope()` lo rechaza, así que el
          // valor resultante no se puede descifrar ni se reconoce como
          // cifrado. Se escribe `''` directo, que sí es falsy para todos los
          // `Boolean(...)` que preguntan si hay PIN.
          software_pin_encrypted: dto.software_pin
            ? this.encryption.encrypt(dto.software_pin)
            : '',
          environment: dto.environment || 'test',
          enablement_status: 'not_started',
          test_set_id: dto.test_set_id,
          // Misma regla que el servicio de tienda (Fix #3): UN solo bloque
          // controla los campos de cert, sin pre-spread que el spread
          // siguiente pisaría. KMS ARN del DTO se respeta cuando no hay
          // herencia; KMS del cert fuente se respeta cuando sí.
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
                inherited_from_dian_configuration_id: inheritable.source.id,
              }
            : {
                certificate_kms_key_id: dto.certificate_kms_key_id || null,
              }),
        },
      });

    if (should_be_default) {
      await this.ensureSingleDefault(config.id, resolved_store_id);
    }

    if (inheritable) {
      this.logger.log(
        `QUI-679: org DIAN config "${dto.name}" (${configuration_type}) inherited cert from ` +
          `sibling dian_configuration_id=${inheritable.source.id} ` +
          `(${inheritable.source.configuration_type}); expiry=${inheritable.fields.certificate_expiry?.toISOString() ?? 'unknown'}`,
      );
    }

    this.logger.log(
      `DIAN config "${dto.name}" created for org ${organization_id}` +
        (resolved_store_id === null
          ? ' (ORGANIZATION fiscal scope)'
          : `, store ${resolved_store_id}`),
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

  async update(id: number, dto: UpdateDianConfigDto) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: { id, organization_id },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
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
    // Vacío es "todavía no lo tengo", no "bórralo". Antes la comparación
    // contra `undefined` dejaba que un PATCH del formulario —que reenvía el
    // objeto completo— pisara con `''` un Software ID ya registrado.
    if (dto.software_id) update_data.software_id = dto.software_id;
    // '****' es el enmascarado "no lo cambies"; '' es "aún no lo emiten".
    // Ninguno llega a `encrypt()`.
    if (dto.software_pin && dto.software_pin !== '****')
      update_data.software_pin_encrypted = this.encryption.encrypt(
        dto.software_pin,
      );
    if (dto.environment !== undefined) update_data.environment = dto.environment;
    if (dto.test_set_id !== undefined) update_data.test_set_id = dto.test_set_id;
    // Same contract as the store-level service: '' withdraws the key and returns
    // the configuration to in-process custody. With `fiscal_scope=ORGANIZATION`
    // this is the ONLY path that can register the ARN, since store-level creation
    // is refused for those organizations.
    if (dto.certificate_kms_key_id !== undefined) {
      update_data.certificate_kms_key_id =
        dto.certificate_kms_key_id === '' ? null : dto.certificate_kms_key_id;
    }

    if (
      dto.nit !== undefined ||
      dto.nit_type !== undefined ||
      dto.nit_dv !== undefined
    ) {
      const entity = await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id: config.organization_id,
        store_id: config.store_id,
      });
      update_data.accounting_entity_id = entity.id;
    }

    const updated = await this.prisma
      .withoutScope()
      .dian_configurations.update({
        where: { id },
        data: update_data,
      });

    if (dto.is_default === true) {
      await this.ensureSingleDefault(id, config.store_id);
    }

    this.logger.log(`DIAN config ${id} updated (org ${organization_id})`);

    return this.maskSensitiveFields(updated);
  }

  async updateCertificate(
    id: number,
    s3_key: string,
    password: string,
    expiry: Date | null,
    certificate_info?: CertificateValidationResult,
  ) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: { id, organization_id },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
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

    const updated = await this.prisma
      .withoutScope()
      .dian_configurations.update({
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

    this.logger.log(`Certificate updated for DIAN config ${id} (org ${organization_id})`);

    return this.maskSensitiveFields(updated);
  }

  async setDefault(id: number) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: { id, organization_id },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    await this.prisma.withoutScope().dian_configurations.update({
      where: { id },
      data: { is_default: true },
    });

    await this.ensureSingleDefault(id, config.store_id);
    this.logger.log(`DIAN config ${id} set as default (org ${organization_id})`);

    return this.getConfigById(id);
  }

  async deleteConfig(id: number) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findFirst({
        where: { id, organization_id },
      });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    await this.prisma.withoutScope().dian_configurations.delete({
      where: { id },
    });

    if (config.is_default) {
      const next = await this.prisma
        .withoutScope()
        .dian_configurations.findFirst({
          where: { organization_id, store_id: config.store_id },
          orderBy: { created_at: 'asc' },
        });
      if (next) {
        await this.prisma.withoutScope().dian_configurations.update({
          where: { id: next.id },
          data: { is_default: true },
        });
      }
    }

    this.logger.log(`DIAN config ${id} deleted (org ${organization_id})`);
  }

  private async ensureSingleDefault(
    config_id: number,
    store_id: number | null,
  ) {
    const organization_id = this.requireOrganizationId();
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findUnique({
        where: { id: config_id },
        select: { configuration_type: true },
      });

    await this.prisma.withoutScope().dian_configurations.updateMany({
      where: {
        organization_id,
        // For STORE scope: limit "default" cohort to the same store.
        // For ORGANIZATION scope: cohort is the org-wide (store_id NULL) bucket.
        ...(store_id === null ? { store_id: null } : { store_id }),
        configuration_type: config?.configuration_type,
        id: { not: config_id },
        is_default: true,
      },
      data: { is_default: false },
    });
  }
}
