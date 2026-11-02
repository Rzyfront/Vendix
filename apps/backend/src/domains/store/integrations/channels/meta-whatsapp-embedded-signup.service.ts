import { randomInt } from 'crypto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { CompleteWhatsappEmbeddedSignupDto } from './dto';
import { ChannelEncryptionService } from './channel-encryption.service';
import {
  META_WHATSAPP_PLATFORM_SETTINGS_KEY,
  MetaWhatsappPlatformConfig,
  resolveMetaWhatsappPlatformConfig,
} from './meta-whatsapp-platform-config.resolver';

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

// A type alias (not an interface) so it is assignable to Prisma's Json input.
type RegistrationState = {
  pin_encrypted?: string;
  status: 'registered' | 'failed';
  attempted_at: string;
  registered_at?: string;
  error?: string;
};

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
    private readonly encryption: ChannelEncryptionService,
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
      platform_settings_key: META_WHATSAPP_PLATFORM_SETTINGS_KEY,
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
    const accessToken = tokenResponse.access_token;

    const ids = await this.resolveSignupIds(dto, accessToken, platformConfig);
    const encryptedToken = this.encryption.encrypt(accessToken);
    const token_expires_at = tokenResponse.expires_in
      ? new Date(Date.now() + tokenResponse.expires_in * 1000)
      : null;
    const webhookSubscription = await this.subscribeWaba(
      ids.waba_id,
      accessToken,
      platformConfig,
    );
    const connected_at = new Date();

    const existing = await this.prisma.social_channels.findFirst({
      where: {
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
    });
    const previousMetadata = this.asRecord(existing?.metadata) ?? {};

    const registration = await this.registerPhoneNumber(
      ids.phone_number_id,
      accessToken,
      platformConfig,
      this.asRecord(previousMetadata.registration) as RegistrationState | null,
    );

    const data = {
      channel_type: 'whatsapp',
      provider: 'meta_cloud',
      status: registration.status === 'registered' ? 'connected' : 'error',
      waba_id: ids.waba_id,
      phone_number_id: ids.phone_number_id,
      display_phone_number: dto.display_phone_number || null,
      business_account_id: dto.business_account_id || null,
      access_token_encrypted: encryptedToken,
      token_type: tokenResponse.token_type || null,
      token_expires_at,
      connected_at,
      disconnected_at: null,
      last_error: this.buildLastError(registration, webhookSubscription),
      metadata: {
        ...previousMetadata,
        embedded_signup: {
          completed_at: connected_at.toISOString(),
          config_id: platformConfig.whatsapp_config_id,
          ...(ids.note ? { note: ids.note } : {}),
        },
        webhook_subscription: webhookSubscription,
        registration,
      } as Prisma.InputJsonValue,
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

  /**
   * Retries the phone number registration for a channel that never completed
   * it (channels connected before registration existed, or a failed attempt).
   * Meta limits register to 10 requests per 72 hours, so this is only ever
   * triggered by an explicit user action, never in a loop.
   */
  async retryWhatsappRegistration() {
    this.requireStoreId();
    if (!this.encryption.isEnabled) {
      throw new BadRequestException(
        'SOCIAL_CHANNEL_ENCRYPTION_KEY es obligatoria para registrar el número',
      );
    }

    const existing = await this.prisma.social_channels.findFirst({
      where: {
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
    });
    if (
      !existing ||
      existing.status === 'disconnected' ||
      !existing.phone_number_id ||
      !existing.access_token_encrypted
    ) {
      throw new BadRequestException(
        'No hay un canal de WhatsApp conectado para registrar. Conéctalo primero.',
      );
    }

    const metadata = this.asRecord(existing.metadata) ?? {};
    const previous = this.asRecord(
      metadata.registration,
    ) as RegistrationState | null;
    if (previous?.status === 'registered') {
      return this.getWhatsappChannel();
    }

    let accessToken: string;
    try {
      accessToken = this.encryption.decrypt(existing.access_token_encrypted);
    } catch {
      throw new BadRequestException(
        'No se pudo leer el token del canal. Desconecta y vuelve a conectar WhatsApp.',
      );
    }

    const platformConfig = await this.getPlatformConfig();
    const registration = await this.registerPhoneNumber(
      existing.phone_number_id,
      accessToken,
      platformConfig,
      previous,
    );
    // A channel connected before registration existed may already send
    // (registered outside Vendix). A failed retry must not take it offline:
    // keep 'connected' and only surface the error.
    const failedStatus =
      existing.status === 'connected' && !previous ? 'connected' : 'error';

    await this.prisma.social_channels.updateMany({
      where: {
        id: existing.id,
        channel_type: 'whatsapp',
        provider: 'meta_cloud',
      },
      data: {
        status:
          registration.status === 'registered' ? 'connected' : failedStatus,
        last_error: this.buildLastError(
          registration,
          this.asRecord(metadata.webhook_subscription),
        ),
        metadata: { ...metadata, registration } as Prisma.InputJsonValue,
      },
    });

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

  private buildLastError(
    registration: RegistrationState,
    webhookSubscription: Record<string, any> | null,
  ): string | null {
    if (registration.status === 'failed') return registration.error ?? null;
    return webhookSubscription?.status === 'failed'
      ? (webhookSubscription.message ?? null)
      : null;
  }

  /**
   * Registers the number on the Cloud API (required, otherwise sending fails
   * with error 133010). Never throws: a failure is stored on the channel so
   * the token and ids already obtained are kept.
   *
   * Docs: https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/registration.md
   * The endpoint "responds with true" on success. The docs define no
   * "already registered" error code, so none is special-cased: only
   * `success: true` counts as registered. Error 133016 means the limit of
   * 10 register requests per 72 hours was hit.
   */
  private async registerPhoneNumber(
    phoneNumberId: string,
    accessToken: string,
    platformConfig: MetaWhatsappPlatformConfig,
    previous: RegistrationState | null,
  ): Promise<RegistrationState> {
    const attempted_at = new Date().toISOString();
    const pin = this.resolvePin(previous);
    const pin_encrypted = this.encryption.encrypt(pin);
    const url = `https://graph.facebook.com/${platformConfig.graph_version}/${phoneNumberId}/register`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      });
      const body: any = await response.json().catch(() => ({}));

      if (response.ok && body?.success === true) {
        return {
          pin_encrypted,
          status: 'registered',
          attempted_at,
          registered_at: new Date().toISOString(),
        };
      }

      const code = body?.error?.code;
      const detail = this.extractMetaError(body);
      return {
        pin_encrypted,
        status: 'failed',
        attempted_at,
        error: `No se pudo registrar el número en WhatsApp${
          code ? ` (código ${code})` : ''
        }${detail ? `: ${detail}` : ''}. Puedes reintentar el registro más tarde.`,
      };
    } catch (error) {
      this.logger.warn(
        `WhatsApp register request failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return {
        pin_encrypted,
        status: 'failed',
        attempted_at,
        error:
          'No se pudo registrar el número en WhatsApp por un error de conexión. Puedes reintentar el registro más tarde.',
      };
    }
  }

  /** Reuses the stored PIN so a later re-register keeps the same 2FA PIN. */
  private resolvePin(previous: RegistrationState | null): string {
    if (previous?.pin_encrypted) {
      try {
        const stored = this.encryption.decrypt(previous.pin_encrypted);
        if (/^\d{6}$/.test(stored)) return stored;
      } catch {
        // Unreadable stored PIN: generate a new one.
      }
    }
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Completes waba_id / phone_number_id when the popup closed before the
   * session event delivered them.
   */
  private async resolveSignupIds(
    dto: CompleteWhatsappEmbeddedSignupDto,
    accessToken: string,
    platformConfig: MetaWhatsappPlatformConfig,
  ): Promise<{ waba_id: string; phone_number_id: string; note?: string }> {
    let waba_id = dto.waba_id || null;
    let phone_number_id = dto.phone_number_id || null;
    let note: string | undefined;

    if (!waba_id) {
      waba_id = await this.lookupWabaIdFromToken(accessToken, platformConfig);
    }
    if (!phone_number_id && waba_id) {
      const numbers = await this.listPhoneNumberIds(
        waba_id,
        accessToken,
        platformConfig,
      );
      phone_number_id = numbers[0] ?? null;
      if (numbers.length > 1) {
        note = `La cuenta tiene ${numbers.length} números; se usó el primero.`;
      }
    }

    if (!waba_id || !phone_number_id) {
      throw new BadRequestException(
        'No pudimos identificar la cuenta o el número de WhatsApp que conectaste. Vuelve a intentarlo y pulsa "Finalizar" al terminar.',
      );
    }
    return { waba_id, phone_number_id, note };
  }

  private async lookupWabaIdFromToken(
    accessToken: string,
    platformConfig: MetaWhatsappPlatformConfig,
  ): Promise<string | null> {
    // NOT verified in the current Meta docs: debug_token's granular_scopes
    // list the assets the user granted per scope. Defensive best effort.
    const params = new URLSearchParams({
      input_token: accessToken,
      access_token: `${platformConfig.app_id}|${platformConfig.app_secret}`,
    });
    const body = await this.graphGet(
      `https://graph.facebook.com/${platformConfig.graph_version}/debug_token?${params.toString()}`,
    );
    const scopes: any[] = Array.isArray(body?.data?.granular_scopes)
      ? body.data.granular_scopes
      : [];
    const scope = scopes.find(
      (s) => s?.scope === 'whatsapp_business_management',
    );
    const id = scope?.target_ids?.[0];
    return typeof id === 'string' && id ? id : null;
  }

  private async listPhoneNumberIds(
    wabaId: string,
    accessToken: string,
    platformConfig: MetaWhatsappPlatformConfig,
  ): Promise<string[]> {
    const body = await this.graphGet(
      `https://graph.facebook.com/${platformConfig.graph_version}/${wabaId}/phone_numbers`,
      accessToken,
    );
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    return rows
      .map((row) => row?.id)
      .filter((id): id is string => typeof id === 'string' && !!id);
  }

  private async graphGet(url: string, accessToken?: string): Promise<any> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        ...(accessToken
          ? { headers: { Authorization: `Bearer ${accessToken}` } }
          : {}),
      });
      if (!response.ok) return null;
      return await response.json().catch(() => null);
    } catch (error) {
      this.logger.warn(
        `Graph lookup failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return null;
    }
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

    const metadata = this.asRecord(channel.metadata);
    const registration = this.asRecord(metadata?.registration);

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
      registration_status: registration?.status ?? null,
      metadata: this.stripRegistrationSecret(metadata),
    };
  }

  /** The encrypted PIN must never leave the server. */
  private stripRegistrationSecret(
    metadata: Record<string, any> | null,
  ): Record<string, any> | null {
    if (!metadata) return null;
    const registration = this.asRecord(metadata.registration);
    if (!registration) return metadata;
    const { pin_encrypted: _pin, ...safe } = registration;
    return { ...metadata, registration: safe };
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

  private getPlatformConfig(): Promise<MetaWhatsappPlatformConfig> {
    return resolveMetaWhatsappPlatformConfig(
      this.globalPrisma,
      this.configService,
      this.encryption,
    );
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
}
