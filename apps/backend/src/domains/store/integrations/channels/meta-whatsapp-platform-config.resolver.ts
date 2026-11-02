import { ConfigService } from '@nestjs/config';
import { ChannelEncryptionService } from './channel-encryption.service';

/** platform_settings key holding the Meta WhatsApp platform configuration. */
export const META_WHATSAPP_PLATFORM_SETTINGS_KEY = 'social_sales:meta_whatsapp';
export const META_WHATSAPP_DEFAULT_GRAPH_VERSION = 'v23.0';

export interface MetaWhatsappPlatformConfig {
  source: 'platform_settings' | 'environment';
  app_id: string | null;
  app_secret: string | null;
  whatsapp_config_id: string | null;
  verify_token: string | null;
  graph_version: string;
  app_review_status: string | null;
  allow_dev_signup: boolean | string | null;
}

interface PlatformSettingsReader {
  platform_settings: {
    findUnique(args: { where: { key: string } }): Promise<unknown>;
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/**
 * Single source of truth for the Meta WhatsApp platform configuration.
 * The platform_settings row wins; each field falls back to its `.env`
 * variable independently, so a partially filled row still works.
 */
export async function resolveMetaWhatsappPlatformConfig(
  prisma: PlatformSettingsReader,
  config: ConfigService,
  encryption: ChannelEncryptionService,
): Promise<MetaWhatsappPlatformConfig> {
  const row = (await prisma.platform_settings.findUnique({
    where: { key: META_WHATSAPP_PLATFORM_SETTINGS_KEY },
  })) as { value?: unknown } | null;
  const raw = row?.value;
  const value =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;

  const secret = (plainKey: string, encryptedKey: string): string | null => {
    const encrypted = stringOrNull(value?.[encryptedKey]);
    if (encrypted) {
      try {
        return encryption.decrypt(encrypted);
      } catch {
        // Undecryptable value (rotated key): treat as missing, fall back to .env.
        return null;
      }
    }
    return stringOrNull(value?.[plainKey]);
  };
  const env = (name: string) => stringOrNull(config.get<string>(name));
  const rowDev = value?.allow_dev_signup;

  return {
    source: value ? 'platform_settings' : 'environment',
    app_id: stringOrNull(value?.app_id) ?? env('META_APP_ID'),
    app_secret:
      secret('app_secret', 'app_secret_encrypted') ?? env('META_APP_SECRET'),
    whatsapp_config_id:
      stringOrNull(value?.whatsapp_config_id) ?? env('META_WHATSAPP_CONFIG_ID'),
    verify_token:
      secret('verify_token', 'verify_token_encrypted') ??
      env('META_WHATSAPP_VERIFY_TOKEN'),
    graph_version:
      stringOrNull(value?.graph_version) ??
      env('META_GRAPH_VERSION') ??
      META_WHATSAPP_DEFAULT_GRAPH_VERSION,
    app_review_status:
      stringOrNull(value?.app_review_status) ??
      env('META_WHATSAPP_APP_REVIEW_STATUS'),
    allow_dev_signup:
      rowDev !== undefined && rowDev !== null
        ? (rowDev as boolean | string)
        : env('META_WHATSAPP_ALLOW_DEV_SIGNUP'),
  };
}
