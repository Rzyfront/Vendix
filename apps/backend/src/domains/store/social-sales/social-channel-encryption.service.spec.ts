import { ConfigService } from '@nestjs/config';
import { SocialChannelEncryptionService } from './social-channel-encryption.service';

describe('SocialChannelEncryptionService', () => {
  it('encrypts and decrypts social channel tokens with AES-GCM', () => {
    const service = new SocialChannelEncryptionService({
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
