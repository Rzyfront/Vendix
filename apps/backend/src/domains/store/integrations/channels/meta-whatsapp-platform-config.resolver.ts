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

export type MetaReadinessStatus =
  | 'missing_env'
  | 'pending_approval'
  | 'approved'
  | 'rejected';

/** Settings the signup needs, named after their `.env` variables. */
export const META_WHATSAPP_REQUIRED_SETTINGS = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_WHATSAPP_CONFIG_ID',
  'META_WHATSAPP_VERIFY_TOKEN',
  'META_GRAPH_VERSION',
  'SOCIAL_CHANNEL_ENCRYPTION_KEY',
] as const;

type MetaWhatsappRequiredSetting =
  (typeof META_WHATSAPP_REQUIRED_SETTINGS)[number];

const REQUIRED_SETTING_FIELD: Record<
  Exclude<MetaWhatsappRequiredSetting, 'SOCIAL_CHANNEL_ENCRYPTION_KEY'>,
  keyof MetaWhatsappPlatformConfig
> = {
  META_APP_ID: 'app_id',
  META_APP_SECRET: 'app_secret',
  META_WHATSAPP_CONFIG_ID: 'whatsapp_config_id',
  META_WHATSAPP_VERIFY_TOKEN: 'verify_token',
  META_GRAPH_VERSION: 'graph_version',
};

export interface MetaWhatsappSignupGate {
  status: MetaReadinessStatus;
  configured: boolean;
  missing_envs: MetaWhatsappRequiredSetting[];
  app_review_status: string;
  allow_dev_signup: boolean;
  can_start_signup: boolean;
}

function parseBoolean(value?: string | boolean | null): boolean {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
}

/**
 * Single gate deciding whether a store may start the Embedded Signup.
 * Shared by the authenticated readiness endpoint and the public signup
 * config the bridge page reads, so both always agree.
 */
export function computeMetaWhatsappSignupGate(
  config: MetaWhatsappPlatformConfig,
  encryptionEnabled: boolean,
): MetaWhatsappSignupGate {
  const missing_envs = META_WHATSAPP_REQUIRED_SETTINGS.filter((name) =>
    name === 'SOCIAL_CHANNEL_ENCRYPTION_KEY'
      ? !encryptionEnabled
      : !config[REQUIRED_SETTING_FIELD[name]],
  );
  const app_review_status = (
    config.app_review_status || 'pending'
  ).toLowerCase();
  const allow_dev_signup = parseBoolean(config.allow_dev_signup);
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
  };
}
