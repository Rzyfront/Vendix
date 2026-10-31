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
});
