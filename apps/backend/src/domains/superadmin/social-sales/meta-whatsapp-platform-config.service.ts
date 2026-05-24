import { BadRequestException, Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SocialChannelEncryptionService } from '../../store/social-sales/social-channel-encryption.service';
import { UpdateMetaWhatsappPlatformConfigDto } from './dto/update-meta-whatsapp-platform-config.dto';

const PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';

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
    private readonly encryption: SocialChannelEncryptionService,
  ) {}

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

    return this.toMaskedView(next, saved.updated_at);
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
