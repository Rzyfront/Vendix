import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

/**
 * Map of payment provider types to their sensitive config fields.
 * Only these fields will be encrypted/decrypted/masked.
 */
const SENSITIVE_CONFIG_KEYS: Record<string, string[]> = {
  wompi: ['private_key', 'events_secret', 'integrity_secret'],
  stripe: ['secret_key', 'webhook_secret'],
  paypal: ['client_secret'],
};

/**
 * AES-256-GCM encryption service for payment credentials.
 * Uses PAYMENT_ENCRYPTION_KEY env var (separate from DIAN_ENCRYPTION_KEY).
 *
 * Format: iv:authTag:ciphertext (all hex-encoded)
 */
@Injectable()
export class PaymentEncryptionService {
  private readonly logger = new Logger(PaymentEncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer | null;

  constructor(private readonly configService: ConfigService) {
    const encryptionKey = this.configService.get<string>(
      'PAYMENT_ENCRYPTION_KEY',
    );
    if (!encryptionKey) {
      this.logger.warn(
        'PAYMENT_ENCRYPTION_KEY not set — payment credentials will NOT be encrypted',
      );
      this.key = null;
    } else {
      this.key = scryptSync(encryptionKey, 'vendix-payments-salt', 32);
    }
  }

  /** Check if encryption is available */
  get isEnabled(): boolean {
    return this.key !== null;
  }

  /** Encrypt a string value. Returns format: iv:authTag:ciphertext (hex) */
  encrypt(plaintext: string): string {
    if (!this.key) return plaintext;

    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /** Decrypt an encrypted value */
  decrypt(encryptedValue: string): string {
    if (!this.key) return encryptedValue;
    if (!this.isEncrypted(encryptedValue)) return encryptedValue;

    const [ivHex, authTagHex, ciphertext] = encryptedValue.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /** Check if a value looks encrypted (has the iv:authTag:ciphertext hex format) */
  isEncrypted(value: string): boolean {
    if (!value || typeof value !== 'string') return false;
    const parts = value.split(':');
    return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
  }

  /** Get the list of sensitive keys for a payment provider type */
  getSensitiveKeys(providerType: string): string[] {
    return SENSITIVE_CONFIG_KEYS[providerType] || [];
  }

  /**
   * Encrypt sensitive fields in a config object.
   * Returns a new object with encrypted values.
   */
  encryptConfig(
    config: Record<string, any>,
    providerType: string,
  ): Record<string, any> {
    if (!this.isEnabled || !config) return config;

    const sensitiveKeys = this.getSensitiveKeys(providerType);
    if (sensitiveKeys.length === 0) return config;

    const encrypted = { ...config };
    for (const key of sensitiveKeys) {
      if (
        encrypted[key] &&
        typeof encrypted[key] === 'string' &&
        !this.isEncrypted(encrypted[key])
      ) {
        encrypted[key] = this.encrypt(encrypted[key]);
      }
    }
    return encrypted;
  }

  /**
   * Decrypt sensitive fields in a config object.
   * Returns a new object with decrypted values.
   */
  decryptConfig(
    config: Record<string, any>,
    providerType: string,
  ): Record<string, any> {
    if (!this.isEnabled || !config) return config;

    const sensitiveKeys = this.getSensitiveKeys(providerType);
    if (sensitiveKeys.length === 0) return config;

    const decrypted = { ...config };
    for (const key of sensitiveKeys) {
      if (
        decrypted[key] &&
        typeof decrypted[key] === 'string' &&
        this.isEncrypted(decrypted[key])
      ) {
        decrypted[key] = this.decrypt(decrypted[key]);
      }
    }
    return decrypted;
  }

  /**
   * Mask sensitive fields for API responses.
   * Shows only last 4 characters of each sensitive value.
   */
  maskConfig(
    config: Record<string, any>,
    providerType: string,
  ): Record<string, any> {
    if (!config) return config;

    const sensitiveKeys = this.getSensitiveKeys(providerType);
    if (sensitiveKeys.length === 0) return config;

    const masked = { ...config };
    for (const key of sensitiveKeys) {
      if (masked[key] && typeof masked[key] === 'string') {
        // First decrypt if encrypted, then mask
        let value = masked[key];
        if (this.isEncrypted(value)) {
          try {
            value = this.decrypt(value);
          } catch {
            /* leave as is — will just mask the encrypted blob */
          }
        }
        masked[key] = value.length > 4 ? '****' + value.slice(-4) : '****';
      }
    }
    return masked;
  }
}
