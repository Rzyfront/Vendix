import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  AuditAction,
  AuditResource,
  AuditService,
} from '@common/audit/audit.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { ChannelEncryptionService } from '../../store/integrations/channels/channel-encryption.service';
import { UpdateMetaWhatsappPlatformConfigDto } from './dto/update-meta-whatsapp-platform-config.dto';

const PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';

const AUDITED_PLAIN_FIELDS = [
  'app_id',
  'whatsapp_config_id',
  'graph_version',
  'app_review_status',
  'allow_dev_signup',
] as const;

interface StoredMetaWhatsappConfig {
  app_id?: string | null;
  app_secret_encrypted?: string | null;
  whatsapp_config_id?: string | null;
  verify_token_encrypted?: string | null;
  graph_version?: string | null;
  app_review_status?: 'pending' | 'approved' | 'rejected';
  allow_dev_signup?: boolean;
  updated_by_user_id?: number | null;
  updated_at?: string;
}

@Injectable()
export class MetaWhatsappPlatformConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: ChannelEncryptionService,
    private readonly auditService: AuditService,
  ) {}

  private readonly logger = new Logger(MetaWhatsappPlatformConfigService.name);

  async getMaskedConfig() {
    const row = await this.findRow();
    const value = this.parseValue(row?.value);
    return this.toMaskedView(value, row?.updated_at ?? null);
  }

  async updateConfig(
    dto: UpdateMetaWhatsappPlatformConfigDto,
    userId: number | null,
  ) {
    const row = await this.findRow();
    const previous = this.parseValue(row?.value) ?? {};
    const now = new Date();

    const next: StoredMetaWhatsappConfig = {
      ...previous,
      app_id: dto.app_id ?? previous.app_id ?? null,
      whatsapp_config_id:
        dto.whatsapp_config_id ?? previous.whatsapp_config_id ?? null,
      graph_version: dto.graph_version ?? previous.graph_version ?? 'v23.0',
      app_review_status:
        dto.app_review_status ?? previous.app_review_status ?? 'pending',
      allow_dev_signup:
        dto.allow_dev_signup ?? previous.allow_dev_signup ?? false,
      updated_by_user_id: userId,
      updated_at: now.toISOString(),
    };

    if (dto.app_secret !== undefined) {
      next.app_secret_encrypted = this.encryptSecret(dto.app_secret);
    }

    if (dto.verify_token !== undefined) {
      next.verify_token_encrypted = this.encryptSecret(dto.verify_token);
    }

    const saved = await this.prisma.platform_settings.upsert({
      where: { key: PLATFORM_SETTINGS_KEY },
      create: {
        key: PLATFORM_SETTINGS_KEY,
        value: next as any,
        default_trial_days: 14,
        description:
          'Meta WhatsApp platform configuration for Social Sales Hub',
      },
      update: {
        value: next as any,
        updated_at: now,
      },
    });

    await this.auditUpdate(dto, previous, next, userId, saved?.id);

    return this.toMaskedView(next, saved.updated_at);
  }

  /**
   * One audit record per successful PATCH. Secrets are recorded by field
   * name only: never their value, encrypted or masked.
   */
  private async auditUpdate(
    dto: UpdateMetaWhatsappPlatformConfigDto,
    previous: StoredMetaWhatsappConfig,
    next: StoredMetaWhatsappConfig,
    userId: number | null,
    rowId?: number,
  ): Promise<void> {
    const changedFields: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const field of AUDITED_PLAIN_FIELDS) {
      if (dto[field] === undefined) continue;
      if (previous[field] === next[field]) continue;
      changedFields.push(field);
      oldValues[field] = previous[field] ?? null;
      newValues[field] = next[field] ?? null;
    }
    if (dto.app_secret !== undefined) changedFields.push('app_secret');
    if (dto.verify_token !== undefined) changedFields.push('verify_token');

    try {
      await this.auditService.log({
        userId: userId ?? undefined,
        action: AuditAction.UPDATE,
        resource: AuditResource.SETTINGS,
        resourceId: typeof rowId === 'number' ? rowId : undefined,
        oldValues,
        newValues,
        metadata: { key: PLATFORM_SETTINGS_KEY, changed_fields: changedFields },
      });
    } catch (error) {
      this.logger.error(
        `Audit write failed for ${PLATFORM_SETTINGS_KEY}: ${(error as Error).message}`,
      );
    }
  }

  private encryptSecret(value: string): string {
    if (!this.encryption.isEnabled) {
      throw new BadRequestException(
        'SOCIAL_CHANNEL_ENCRYPTION_KEY es obligatoria para guardar secretos Meta',
      );
    }
    return this.encryption.encrypt(value);
  }

  private async findRow() {
    return this.prisma.platform_settings.findUnique({
      where: { key: PLATFORM_SETTINGS_KEY },
    });
  }

  private parseValue(raw: unknown): StoredMetaWhatsappConfig | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    return raw as StoredMetaWhatsappConfig;
  }

  private toMaskedView(
    value: StoredMetaWhatsappConfig | null,
    updatedAt: Date | null,
  ) {
    const configured = Boolean(
      value?.app_id &&
      value?.app_secret_encrypted &&
      value?.whatsapp_config_id &&
      value?.verify_token_encrypted &&
      value?.graph_version,
    );

    return {
      configured,
      key: PLATFORM_SETTINGS_KEY,
      app_id: value?.app_id ?? null,
      app_secret_masked: this.maskSecret(value?.app_secret_encrypted),
      whatsapp_config_id: value?.whatsapp_config_id ?? null,
      verify_token_masked: this.maskSecret(value?.verify_token_encrypted),
      graph_version: value?.graph_version ?? null,
      app_review_status: value?.app_review_status ?? 'pending',
      allow_dev_signup: value?.allow_dev_signup ?? false,
      updated_by_user_id: value?.updated_by_user_id ?? null,
      updated_at: value?.updated_at ?? updatedAt?.toISOString() ?? null,
    };
  }

  private maskSecret(encryptedValue?: string | null): string | null {
    if (!encryptedValue) return null;
    let value = encryptedValue;
    try {
      value = this.encryption.decrypt(encryptedValue);
    } catch {
      return '****';
    }
    return value.length > 4 ? `****${value.slice(-4)}` : '****';
  }
}
