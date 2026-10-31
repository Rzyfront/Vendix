import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

@Injectable()
export class ChannelEncryptionService {
  private readonly logger = new Logger(ChannelEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>(
      'SOCIAL_CHANNEL_ENCRYPTION_KEY',
    );

    if (!encryptionKey) {
      // Production must never store Meta tokens in clear: fail the boot
      // instead of degrading silently (PLAN-CRM §6).
      const nodeEnv =
        this.configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV;
      if (nodeEnv === 'production') {
        throw new Error(
          'SOCIAL_CHANNEL_ENCRYPTION_KEY is required in production',
        );
      }
      this.logger.warn(
        'SOCIAL_CHANNEL_ENCRYPTION_KEY not set — channel tokens will NOT be encrypted',
      );
      this.key = null;
      return;
    }

    // The salt is part of the persisted format: tokens already stored in
    // social_channels and platform_settings were derived with it. Never rename.
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
