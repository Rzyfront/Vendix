import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { CreateDianConfigDto } from './dto/create-dian-config.dto';
import { UpdateDianConfigDto } from './dto/update-dian-config.dto';

/**
 * Service for managing DIAN configurations per store.
 * Handles encryption of sensitive fields (PIN, certificate password).
 */
@Injectable()
export class DianConfigService {
  private readonly logger = new Logger(DianConfigService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  /**
   * Gets the DIAN configuration for the current store.
   * Masks sensitive fields (PIN, certificate password).
   */
  async getConfig() {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
    });

    if (!config) {
      return null;
    }

    // Mask sensitive fields
    return {
      ...config,
      software_pin_encrypted: config.software_pin_encrypted
        ? '****'
        : null,
      certificate_password_encrypted:
        config.certificate_password_encrypted ? '****' : null,
    };
  }

  /**
   * Creates a new DIAN configuration for the current store.
   */
  async create(dto: CreateDianConfigDto) {
    const context = this.getContext();

    // Check if config already exists
    const existing = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_002);
    }

    const config = await this.prisma.dian_configurations.create({
      data: {
        organization_id: context.organization_id,
        store_id: context.store_id,
        nit: dto.nit,
        nit_dv: dto.nit_dv,
        software_id: dto.software_id,
        software_pin_encrypted: this.encryption.encrypt(
          dto.software_pin,
        ),
        environment: dto.environment || 'test',
        enablement_status: 'not_started',
        test_set_id: dto.test_set_id,
      },
    });

    this.logger.log(
      `DIAN config created for store ${context.store_id}`,
    );

    return {
      ...config,
      software_pin_encrypted: '****',
      certificate_password_encrypted: null,
    };
  }

  /**
   * Updates the DIAN configuration.
   */
  async update(id: number, dto: UpdateDianConfigDto) {
    const config = await this.prisma.dian_configurations.findFirst({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.DIAN_CONFIG_001);
    }

    const update_data: any = {};

    if (dto.nit !== undefined) update_data.nit = dto.nit;
    if (dto.nit_dv !== undefined) update_data.nit_dv = dto.nit_dv;
    if (dto.software_id !== undefined)
      update_data.software_id = dto.software_id;
    if (dto.software_pin !== undefined)
      update_data.software_pin_encrypted = this.encryption.encrypt(
        dto.software_pin,
      );
    if (dto.environment !== undefined)
      update_data.environment = dto.environment;
    if (dto.test_set_id !== undefined)
      update_data.test_set_id = dto.test_set_id;

    const updated = await this.prisma.dian_configurations.update({
      where: { id },
      data: update_data,
    });

    this.logger.log(`DIAN config ${id} updated`);

    return {
      ...updated,
      software_pin_encrypted: '****',
      certificate_password_encrypted: updated.certificate_password_encrypted
        ? '****'
        : null,
    };
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
        certificate_password_encrypted:
          this.encryption.encrypt(password),
        certificate_expiry: expiry,
      },
    });

    this.logger.log(
      `Certificate updated for DIAN config ${id}`,
    );

    return {
      ...updated,
      software_pin_encrypted: '****',
      certificate_password_encrypted: '****',
    };
  }

  /**
   * Updates the enablement status of the DIAN configuration.
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
   * Gets audit logs for the current store's DIAN configuration.
   */
  async getAuditLogs(page = 1, limit = 20) {
    const context = this.getContext();

    const config = await this.prisma.dian_configurations.findFirst({
      where: { store_id: context.store_id },
    });

    if (!config) {
      return { data: [], total: 0, page, limit };
    }

    const [data, total] = await Promise.all([
      this.prisma.dian_audit_logs.findMany({
        where: { dian_configuration_id: config.id },
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.dian_audit_logs.count({
        where: { dian_configuration_id: config.id },
      }),
    ]);

    return { data, total, page, limit };
  }
}
