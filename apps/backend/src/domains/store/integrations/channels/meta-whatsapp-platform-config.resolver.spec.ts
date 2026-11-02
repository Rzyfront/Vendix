import { ConfigService } from '@nestjs/config';
import { ChannelEncryptionService } from './channel-encryption.service';
import {
  META_WHATSAPP_PLATFORM_SETTINGS_KEY,
  resolveMetaWhatsappPlatformConfig,
} from './meta-whatsapp-platform-config.resolver';

const env: Record<string, string> = {
  META_APP_ID: 'env-app',
  META_APP_SECRET: 'env-secret',
  META_WHATSAPP_CONFIG_ID: 'env-config',
  META_WHATSAPP_VERIFY_TOKEN: 'env-verify',
  META_GRAPH_VERSION: 'v22.0',
  SOCIAL_CHANNEL_ENCRYPTION_KEY: 'test-social-channel-encryption-key',
};

function setup(rowValue: Record<string, unknown> | null, envOverride = env) {
  const config = {
    get: jest.fn((k: string) => envOverride[k]),
  } as any as ConfigService;
  const encryption = new ChannelEncryptionService(config);
  const findUnique = jest
    .fn()
    .mockResolvedValue(rowValue ? { value: rowValue } : null);
  return {
    resolve: () =>
      resolveMetaWhatsappPlatformConfig(
        { platform_settings: { findUnique } },
        config,
        encryption,
      ),
    encryption,
    findUnique,
  };
}

describe('resolveMetaWhatsappPlatformConfig', () => {
  it('uses the full platform_settings row', async () => {
    const { resolve, encryption, findUnique } = setup({
      app_id: 'row-app',
      app_secret_encrypted: 'x',
      whatsapp_config_id: 'row-config',
      verify_token: 'row-verify',
      graph_version: 'v24.0',
      app_review_status: 'approved',
      allow_dev_signup: false,
    });
    jest.spyOn(encryption, 'decrypt').mockReturnValue('row-secret');

    const cfg = await resolve();

    expect(findUnique).toHaveBeenCalledWith({
      where: { key: META_WHATSAPP_PLATFORM_SETTINGS_KEY },
    });
    expect(cfg).toMatchObject({
      source: 'platform_settings',
      app_id: 'row-app',
      app_secret: 'row-secret',
      whatsapp_config_id: 'row-config',
      verify_token: 'row-verify',
      graph_version: 'v24.0',
      app_review_status: 'approved',
      allow_dev_signup: false,
    });
  });

  it('falls back to .env field by field for a partial row', async () => {
    const { resolve } = setup({ app_id: 'row-app' });

    const cfg = await resolve();

    expect(cfg.source).toBe('platform_settings');
    expect(cfg.app_id).toBe('row-app');
    expect(cfg.app_secret).toBe('env-secret');
    expect(cfg.whatsapp_config_id).toBe('env-config');
    expect(cfg.verify_token).toBe('env-verify');
    expect(cfg.graph_version).toBe('v22.0');
  });

  it('uses only .env without a row and defaults graph_version', async () => {
    const { META_GRAPH_VERSION: _g, ...noGraph } = env;
    const { resolve } = setup(null, noGraph);

    const cfg = await resolve();

    expect(cfg.source).toBe('environment');
    expect(cfg.app_id).toBe('env-app');
    expect(cfg.graph_version).toBe('v23.0');
  });
});
