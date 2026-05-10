import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';

@Injectable()
export class DianConfigService {
  private readonly logger = new Logger(DianConfigService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
    private readonly fiscalScope: FiscalScopeService,
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

  /**
   * Gets a dashboard with aggregated DIAN metrics from audit_logs.
   * Returns stats cards + last 20 submissions + certificate indicator.
   */
  async getDashboard() {
    const context = this.getContext();

    // Get all configs for this store
    const configs = await this.prisma.dian_configurations.findMany({
      where: { store_id: context.store_id },
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

    const configs = await this.prisma.dian_configurations.findMany({
      where: { store_id: context.store_id },
      orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }],
    });

    return configs.map((c) => this.maskSensitiveFields(c));
  }

  /**
   * Gets a single DIAN configuration by ID.
   */
  async getConfigById(id: number) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
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

    // Check if this is the first config for this store
    const existing_count = await this.prisma.dian_configurations.count({
      where: { store_id },
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
        software_id: dto.software_id,
        software_pin_encrypted: this.encryption.encrypt(dto.software_pin),
        environment: dto.environment || 'test',
        enablement_status: 'not_started',
        test_set_id: dto.test_set_id,
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

    const update_data: any = {};

    if (dto.name !== undefined) update_data.name = dto.name;
    if (dto.nit !== undefined) update_data.nit = dto.nit;
    if (dto.nit_type !== undefined) update_data.nit_type = dto.nit_type;
    if (dto.nit_dv !== undefined) update_data.nit_dv = dto.nit_dv;
    if (dto.is_default !== undefined) update_data.is_default = dto.is_default;
    if (dto.software_id !== undefined)
      update_data.software_id = dto.software_id;
    // Skip if masked sentinel — frontend sends '****' to indicate "no change"
    if (dto.software_pin !== undefined && dto.software_pin !== '****')
      update_data.software_pin_encrypted = this.encryption.encrypt(
        dto.software_pin,
      );
    if (dto.environment !== undefined)
      update_data.environment = dto.environment;
    if (dto.test_set_id !== undefined)
      update_data.test_set_id = dto.test_set_id;
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
  ) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    const updated = await this.prisma.dian_configurations.update({
      where: { id },
      data: {
        certificate_s3_key: s3_key,
        certificate_password_encrypted: this.encryption.encrypt(password),
        certificate_expiry: expiry,
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
    status: 'not_started' | 'testing' | 'enabled' | 'suspended',
  ) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    return this.prisma.dian_configurations.update({
      where: { id },
      data: { enablement_status: status },
    });
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

    let where_clause: any;

    if (config_id) {
      where_clause = { dian_configuration_id: config_id };
    } else {
      const configs = await this.prisma.dian_configurations.findMany({
        where: { store_id: context.store_id },
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

    await this.prisma.dian_configurations.updateMany({
      where: {
        store_id: context.store_id,
        id: { not: config_id },
        is_default: true,
      },
      data: { is_default: false },
    });
  }
}
