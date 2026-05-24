import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';
import { SocialChannelEncryptionService } from './social-channel-encryption.service';

type MetaReadinessStatus =
  | 'missing_env'
  | 'pending_approval'
  | 'approved'
  | 'rejected';

interface MetaTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

interface MetaWhatsappPlatformConfig {
  source: 'platform_settings' | 'environment';
  app_id?: string | null;
  app_secret?: string | null;
  whatsapp_config_id?: string | null;
  verify_token?: string | null;
  graph_version?: string | null;
  app_review_status?: string | null;
  allow_dev_signup?: boolean | string | null;
}

const PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';

@Injectable()
export class MetaWhatsappEmbeddedSignupService {
  private readonly logger = new Logger(MetaWhatsappEmbeddedSignupService.name);

  private readonly requiredEnvVars = [
    'META_APP_ID',
    'META_APP_SECRET',
    'META_WHATSAPP_CONFIG_ID',
    'META_WHATSAPP_VERIFY_TOKEN',
    'META_GRAPH_VERSION',
    'SOCIAL_CHANNEL_ENCRYPTION_KEY',
  ];

  private readonly requiredPermissions = [
    'whatsapp_business_management',
    'whatsapp_business_messaging',
  ];

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly configService: ConfigService,
    private readonly encryption: SocialChannelEncryptionService,
  ) {}

  async getReadiness() {
    const platformConfig = await this.getPlatformConfig();
    const missing_envs = this.requiredEnvVars.filter(
      (envName) => !this.getConfigValue(platformConfig, envName),
    );
    const app_review_status = (
      platformConfig.app_review_status || 'pending'
    ).toLowerCase();
    const allow_dev_signup = this.parseBoolean(platformConfig.allow_dev_signup);
    const is_approved = app_review_status === 'approved';
    const configured = missing_envs.length === 0;
    const can_start_signup = configured && (is_approved || allow_dev_signup);
    const status: MetaReadinessStatus = !configured
      ? 'missing_env'
      : app_review_status === 'rejected'
        ? 'rejected'
        : is_approved
          ? 'approved'
          : 'pending_approval';

    return {
      status,
      configured,
      missing_envs,
      app_review_status,
      allow_dev_signup,
      can_start_signup,
      source: platformConfig.source,
      platform_settings_key: PLATFORM_SETTINGS_KEY,
      app_id: platformConfig.app_id || null,
      whatsapp_config_id: platformConfig.whatsapp_config_id || null,
      graph_version: platformConfig.graph_version || null,
      required_permissions: this.requiredPermissions,
      production_checklist: [
        'Business Verification',
        'App Review',
        'whatsapp_business_management',
        'whatsapp_business_messaging',
      ],
    };
  }

  async getWhatsappChannel() {
    const channel = await this.prisma.social_channels.findFirst({
      where: {
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
    });

    return this.sanitizeChannel(channel);
  }

  async completeEmbeddedSignup(dto: CompleteWhatsappEmbeddedSignupDto) {
    const store_id = this.requireStoreId();
    const platformConfig = await this.assertConnectionReady();

    const tokenResponse = await this.exchangeCodeForToken(
      dto.code,
      platformConfig,
    );
    if (!tokenResponse.access_token) {
      throw new BadRequestException(
        this.extractMetaError(tokenResponse) ||
          'Meta no retorno access_token para Embedded Signup',
      );
    }

    const encryptedToken = this.encryption.encrypt(tokenResponse.access_token);
    const token_expires_at = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : null;
    const webhookSubscription = await this.subscribeWaba(
      dto.waba_id,
      tokenResponse.access_token,
      platformConfig,
    );
    const connected_at = new Date();

    const existing = await this.prisma.social_channels.findFirst({
      where: {
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
    });

    const data = {
      channel_type: 'whatsapp',
      provider: 'meta_cloud',
      status: 'connected',
      waba_id: dto.waba_id,
      phone_number_id: dto.phone_number_id,
      display_phone_number: dto.display_phone_number || null,
      business_account_id: dto.business_account_id || null,
      access_token_encrypted: encryptedToken,
      token_type: tokenResponse.token_type || null,
      token_expires_at,
      connected_at,
      disconnected_at: null,
      last_error:
        webhookSubscription.status === 'failed'
          ? webhookSubscription.message
          : null,
      metadata: {
        embedded_signup: {
          completed_at: connected_at.toISOString(),
          config_id: platformConfig.whatsapp_config_id,
        },
        webhook_subscription: webhookSubscription,
      },
    };

    if (existing) {
      await this.prisma.social_channels.updateMany({
        where: {
          id: existing.id,
          channel_type: 'whatsapp',
          provider: 'meta_cloud',
        },
        data,
      });
    } else {
      await this.prisma.social_channels.create({
        data: {
          ...data,
          store_id,
        },
      });
    }

    return this.getWhatsappChannel();
  }

  async disconnectWhatsapp() {
    const existing = await this.prisma.social_channels.findFirst({
      where: {
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
    });

    if (!existing) {
      return null;
    }

    await this.prisma.social_channels.updateMany({
      where: {
        id: existing.id,
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
      data: {
        status: 'disconnected',
        access_token_encrypted: null,
        last_error: null,
        disconnected_at: new Date(),
        metadata: {
          ...(this.asRecord(existing.metadata) ?? {}),
          disconnected_at: new Date().toISOString(),
        },
      },
    });

    return this.getWhatsappChannel();
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) {
      throw new ForbiddenException('Se requiere contexto de tienda');
    }
    return store_id;
  }

  private async assertConnectionReady(): Promise<MetaWhatsappPlatformConfig> {
    const platformConfig = await this.getPlatformConfig();
    const readiness = await this.getReadiness();
    if (readiness.missing_envs.length > 0) {
      throw new BadRequestException({
        message:
          'Falta configuración de plataforma Meta para conectar WhatsApp',
        missing_envs: readiness.missing_envs,
      });
    }

    if (!readiness.can_start_signup) {
      throw new BadRequestException(
        'La integración Meta de Vendix aún no está aprobada para conexiones reales',
      );
    }

    if (!this.encryption.isEnabled) {
      throw new BadRequestException(
        'SOCIAL_CHANNEL_ENCRYPTION_KEY es obligatoria para guardar tokens de Meta',
      );
    }

    return platformConfig;
  }

  private async exchangeCodeForToken(
    code: string,
    platformConfig: MetaWhatsappPlatformConfig,
  ): Promise<MetaTokenResponse> {
    const graphVersion = platformConfig.graph_version;
    const appId = platformConfig.app_id;
    const appSecret = platformConfig.app_secret;
    const params = new URLSearchParams({
      client_id: appId || '',
      client_secret: appSecret || '',
      code,
    });
    const url = `https://graph.facebook.com/${graphVersion}/oauth/access_token?${params.toString()}`;

    const response = await fetch(url, { method: 'GET' });
    const body = (await response.json().catch(() => ({}))) as MetaTokenResponse;

    if (!response.ok) {
      throw new BadRequestException(
        this.extractMetaError(body) ||
          'Meta rechazo el codigo de Embedded Signup',
      );
    }

    return body;
  }

  private async subscribeWaba(
    wabaId: string,
    accessToken: string,
    platformConfig: MetaWhatsappPlatformConfig,
  ) {
    const graphVersion = platformConfig.graph_version;
    const url = `https://graph.facebook.com/${graphVersion}/${wabaId}/subscribed_apps`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          status: 'failed',
          checked_at: new Date().toISOString(),
          message:
            this.extractMetaError(body) ||
            'Meta no permitio suscribir la WABA a webhooks',
          response: body,
        };
      }

      return {
        status: 'subscribed',
        checked_at: new Date().toISOString(),
        response: body,
      };
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'No fue posible suscribir la WABA a webhooks';
      this.logger.warn(message);
      return {
        status: 'failed',
        checked_at: new Date().toISOString(),
        message,
      };
    }
  }

  private sanitizeChannel(channel: any) {
    if (!channel) {
      return {
        connected: false,
        status: 'disconnected',
        provider: 'meta_cloud',
        channel_type: 'whatsapp',
      };
    }

    return {
      id: channel.id,
      connected: channel.status === 'connected',
      status: channel.status,
      provider: channel.provider,
      channel_type: channel.channel_type,
      waba_id: channel.waba_id,
      phone_number_id: channel.phone_number_id,
      display_phone_number: this.maskPhone(channel.display_phone_number),
      business_account_id: channel.business_account_id,
      token_expires_at: channel.token_expires_at,
      connected_at: channel.connected_at,
      disconnected_at: channel.disconnected_at,
      last_error: channel.last_error,
      metadata: channel.metadata,
    };
  }

  private maskPhone(phone?: string | null): string | null {
    if (!phone) return null;
    const digits = phone.replace(/\D/g, '');
    if (digits.length <= 4) return '****';
    return `${phone.slice(0, 3)}****${digits.slice(-4)}`;
  }

  private extractMetaError(body: any): string | null {
    if (!body) return null;
    if (typeof body === 'string') return body;
    if (body.error?.message) return body.error.message;
    if (body.message) return body.message;
    return null;
  }

  private parseBoolean(value?: string | boolean | null): boolean {
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
  }

  private asRecord(value: unknown): Record<string, any> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    return value as Record<string, any>;
  }

  private async getPlatformConfig(): Promise<MetaWhatsappPlatformConfig> {
    const row = await this.globalPrisma.platform_settings.findUnique({
      where: { key: PLATFORM_SETTINGS_KEY },
    });
    const value = this.asRecord(row?.value);

    if (value) {
      return {
        source: 'platform_settings',
        app_id: this.stringOrNull(value.app_id),
        app_secret: this.resolveStoredSecret(
          this.stringOrNull(value.app_secret),
          this.stringOrNull(value.app_secret_encrypted),
        ),
        whatsapp_config_id: this.stringOrNull(value.whatsapp_config_id),
        verify_token: this.resolveStoredSecret(
          this.stringOrNull(value.verify_token),
          this.stringOrNull(value.verify_token_encrypted),
        ),
        graph_version: this.stringOrNull(value.graph_version) || 'v23.0',
        app_review_status: this.stringOrNull(value.app_review_status),
        allow_dev_signup: value.allow_dev_signup as string | boolean | null,
      };
    }

    return {
      source: 'environment',
      app_id: this.configService.get<string>('META_APP_ID'),
      app_secret: this.configService.get<string>('META_APP_SECRET'),
      whatsapp_config_id: this.configService.get<string>(
        'META_WHATSAPP_CONFIG_ID',
      ),
      verify_token: this.configService.get<string>(
        'META_WHATSAPP_VERIFY_TOKEN',
      ),
      graph_version:
        this.configService.get<string>('META_GRAPH_VERSION') || 'v23.0',
      app_review_status: this.configService.get<string>(
        'META_WHATSAPP_APP_REVIEW_STATUS',
      ),
      allow_dev_signup: this.configService.get<string>(
        'META_WHATSAPP_ALLOW_DEV_SIGNUP',
      ),
    };
  }

  private getConfigValue(
    platformConfig: MetaWhatsappPlatformConfig,
    envName: string,
  ): string | null | undefined {
    const map: Record<string, keyof MetaWhatsappPlatformConfig> = {
      META_APP_ID: 'app_id',
      META_APP_SECRET: 'app_secret',
      META_WHATSAPP_CONFIG_ID: 'whatsapp_config_id',
      META_WHATSAPP_VERIFY_TOKEN: 'verify_token',
      META_GRAPH_VERSION: 'graph_version',
      SOCIAL_CHANNEL_ENCRYPTION_KEY: 'app_id',
    };

    if (envName === 'SOCIAL_CHANNEL_ENCRYPTION_KEY') {
      return this.encryption.isEnabled ? 'configured' : null;
    }

    return platformConfig[map[envName]] as string | null | undefined;
  }

  private resolveStoredSecret(
    plainValue?: string | null,
    encryptedValue?: string | null,
  ): string | null {
    if (encryptedValue) return this.encryption.decrypt(encryptedValue);
    return plainValue || null;
  }

  private stringOrNull(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value : null;
  }
}
