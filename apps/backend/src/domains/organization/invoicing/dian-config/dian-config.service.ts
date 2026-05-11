import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateDianConfigDto } from '../../../store/invoicing/dian-config/dto/create-dian-config.dto';
import { UpdateDianConfigDto } from '../../../store/invoicing/dian-config/dto/update-dian-config.dto';

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

    const existing_count = await this.prisma
      .withoutScope()
      .dian_configurations.count({
        where: {
          organization_id,
          ...(resolved_store_id === null
            ? { store_id: null }
            : { store_id: resolved_store_id }),
        },
      });

    const should_be_default = dto.is_default || existing_count === 0;

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
          software_id: dto.software_id,
          software_pin_encrypted: this.encryption.encrypt(dto.software_pin),
          environment: dto.environment || 'test',
          enablement_status: 'not_started',
          test_set_id: dto.test_set_id,
        },
      });

    if (should_be_default) {
      await this.ensureSingleDefault(config.id, resolved_store_id);
    }

    this.logger.log(
      `DIAN config "${dto.name}" created for org ${organization_id}` +
        (resolved_store_id === null
          ? ' (ORGANIZATION fiscal scope)'
          : `, store ${resolved_store_id}`),
    );

    return this.maskSensitiveFields(config);
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
    if (dto.software_id !== undefined) update_data.software_id = dto.software_id;
    if (dto.software_pin !== undefined && dto.software_pin !== '****')
      update_data.software_pin_encrypted = this.encryption.encrypt(
        dto.software_pin,
      );
    if (dto.environment !== undefined) update_data.environment = dto.environment;
    if (dto.test_set_id !== undefined) update_data.test_set_id = dto.test_set_id;

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

    const updated = await this.prisma
      .withoutScope()
      .dian_configurations.update({
        where: { id },
        data: {
          certificate_s3_key: s3_key,
          certificate_password_encrypted: this.encryption.encrypt(password),
          certificate_expiry: expiry,
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
    await this.prisma.withoutScope().dian_configurations.updateMany({
      where: {
        organization_id,
        // For STORE scope: limit "default" cohort to the same store.
        // For ORGANIZATION scope: cohort is the org-wide (store_id NULL) bucket.
        ...(store_id === null ? { store_id: null } : { store_id }),
        id: { not: config_id },
        is_default: true,
      },
      data: { is_default: false },
    });
  }
}
