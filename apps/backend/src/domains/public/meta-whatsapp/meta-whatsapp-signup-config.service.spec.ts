import { ConfigService } from '@nestjs/config';
import { ChannelEncryptionService } from '../../store/integrations/channels/channel-encryption.service';
import { MetaWhatsappSignupConfigService } from './meta-whatsapp-signup-config.service';

const SECRET_MARKERS = [
  'row-secret',
  'row-verify',
  'env-secret',
  'env-verify',
  'app_secret',
  'verify_token',
  'missing_envs',
];

const baseEnv: Record<string, string> = {
  META_APP_ID: 'env-app',
  META_APP_SECRET: 'env-secret',
  META_WHATSAPP_CONFIG_ID: 'env-config',
  META_WHATSAPP_VERIFY_TOKEN: 'env-verify',
  META_GRAPH_VERSION: 'v22.0',
  SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-encryption-key',
};

function setup(
  rowValue: Record<string, unknown> | null,
  env: Record<string, string> = baseEnv,
) {
  const config = { get: jest.fn((k: string) => env[k]) } as any as ConfigService;
  const encryption = new ChannelEncryptionService(config);
  const prisma = {
    platform_settings: {
      findUnique: jest
        .fn()
        .mockResolvedValue(rowValue ? { value: rowValue } : null),
    },
  };
  const service = new MetaWhatsappSignupConfigService(
    prisma as any,
    config,
    encryption,
  );
  return { service, encryption };
}

function expectNoSecrets(result: unknown) {
  const serialized = JSON.stringify(result);
  for (const marker of SECRET_MARKERS) {
    expect(serialized).not.toContain(marker);
  }
}

describe('MetaWhatsappSignupConfigService', () => {
  it('exposes only the public signup fields from a full platform_settings row', async () => {
    const { service, encryption } = setup({
      app_id: 'row-app',
      app_secret_encrypted: 'cipher-secret',
      whatsapp_config_id: 'row-config',
      verify_token_encrypted: 'cipher-verify',
      graph_version: 'v24.0',
      app_review_status: 'approved',
      allow_dev_signup: false,
    });
    jest
      .spyOn(encryption, 'decrypt')
      .mockImplementation((value: string) =>
        value === 'cipher-secret' ? 'row-secret' : 'row-verify',
      );

    const result = await service.getPublicSignupConfig();

    expect(result).toEqual({
      can_start_signup: true,
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      graph_version: 'v24.0',
    });
    expectNoSecrets(result);
  });

  it('works with a partial row, taking the rest from the environment, without leaking it', async () => {
    const { service } = setup({
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      app_review_status: 'approved',
    });

    const result = await service.getPublicSignupConfig();

    expect(result).toEqual({
      can_start_signup: true,
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      graph_version: 'v22.0',
    });
    expectNoSecrets(result);
  });

  it('works with no row, from the environment only', async () => {
    const { service } = setup(null, {
      ...baseEnv,
      META_WHATSAPP_APP_REVIEW_STATUS: 'approved',
    });

    const result = await service.getPublicSignupConfig();

    expect(result).toEqual({
      can_start_signup: true,
      app_id: 'env-app',
      whatsapp_config_id: 'env-config',
      graph_version: 'v22.0',
    });
    expectNoSecrets(result);
  });

  it('opens the gate in development mode while App Review is pending', async () => {
    const { service } = setup({
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      app_review_status: 'pending',
      allow_dev_signup: true,
    });

    const result = await service.getPublicSignupConfig();

    expect(result.can_start_signup).toBe(true);
    expect(result.app_id).toBe('row-app');
  });

  it('returns nothing but a closed gate while App Review is pending', async () => {
    const { service } = setup({
      app_id: 'row-app',
      whatsapp_config_id: 'row-config',
      app_review_status: 'pending',
      allow_dev_signup: false,
    });

    const result = await service.getPublicSignupConfig();

    expect(result).toEqual({
      can_start_signup: false,
      app_id: null,
      whatsapp_config_id: null,
      graph_version: null,
    });
  });

  it('keeps the gate closed without the server encryption key', async () => {
    const { SOCIAL_CHANNEL_ENCRYPTION_KEY: _omit, ...envWithoutKey } = baseEnv;
    const { service } = setup(
      { app_id: 'row-app', whatsapp_config_id: 'row-config', app_review_status: 'approved' },
      envWithoutKey,
    );

    const result = await service.getPublicSignupConfig();

    expect(result).toEqual({
      can_start_signup: false,
      app_id: null,
      whatsapp_config_id: null,
      graph_version: null,
    });
  });
});
