import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

@Injectable()
export class SocialChannelEncryptionService {
  private readonly logger = new Logger(SocialChannelEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>(
      'SOCIAL_CHANNEL_ENCRYPTION_KEY',
    );

    if (!encryptionKey) {
      this.logger.warn(
        'SOCIAL_CHANNEL_ENCRYPTION_KEY not set — social channel tokens will NOT be encrypted',
      );
      this.key = null;
      return;
    }

    this.key = scryptSync(encryptionKey, 'vendix-social-sales-salt', 32);
  }

  get isEnabled(): boolean {
    return this.key !== null;
  }

  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  decrypt(encryptedValue: string): string {
    if (!this.key || !this.isEncrypted(encryptedValue)) return encryptedValue;

    const [ivHex, authTagHex, ciphertext] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  isEncrypted(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split(':');
    return (
      parts.length === 3 && parts.every((part) => /^[0-9a-f]+$/i.test(part))
    );
  }
}
