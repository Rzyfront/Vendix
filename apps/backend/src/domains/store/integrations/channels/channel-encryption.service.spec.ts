import { ConfigService } from '@nestjs/config';
import { ChannelEncryptionService } from './channel-encryption.service';

describe('ChannelEncryptionService', () => {
  it('encrypts and decrypts social channel tokens with AES-GCM', () => {
    const service = new ChannelEncryptionService({
      get: (key: string) =>
        key === 'SOCIAL_CHANNEL_ENCRYPTION_KEY'
          ? 'test-social-channel-encryption-key'
          : undefined,
    } as ConfigService);

    const encrypted = service.encrypt('meta-token');

    expect(encrypted).not.toBe('meta-token');
    expect(service.isEncrypted(encrypted)).toBe(true);
    expect(service.decrypt(encrypted)).toBe('meta-token');
  });

  it('refuses to start in production without SOCIAL_CHANNEL_ENCRYPTION_KEY', () => {
    const config = (env: Record<string, string>) =>
      ({ get: (key: string) => env[key] }) as ConfigService;

    expect(
      () =>
        new ChannelEncryptionService(config({ NODE_ENV: 'production' })),
    ).toThrow('SOCIAL_CHANNEL_ENCRYPTION_KEY is required in production');
    expect(
      new ChannelEncryptionService(config({ NODE_ENV: 'development' }))
        .isEnabled,
    ).toBe(false);
  });
});
