import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

/**
 * AES-256-GCM encryption service for sensitive data.
 * Uses DIAN_ENCRYPTION_KEY env var as the master key.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly key: Buffer;

  constructor() {
    const master_key = process.env.DIAN_ENCRYPTION_KEY;
    if (!master_key) {
      this.logger.warn(
        'DIAN_ENCRYPTION_KEY not set — encryption service will use a fallback key (NOT SAFE FOR PRODUCTION)',
      );
    }
    // Derive a 32-byte key from the master key using scrypt
    const key_source =
      master_key || 'vendix-dev-fallback-key-not-for-production';
    this.key = scryptSync(key_source, 'vendix-salt', 32);
  }

  /**
   * Encrypts plaintext using AES-256-GCM.
   * Returns a string in format: iv:authTag:ciphertext (all hex-encoded).
   */
  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv(this.algorithm, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const auth_tag = cipher.getAuthTag().toString('hex');

    return `${iv.toString('hex')}:${auth_tag}:${encrypted}`;
  }

  /**
   * Decrypts a string encrypted by this service.
   * Expects format: iv:authTag:ciphertext (all hex-encoded).
   */
  decrypt(encrypted_value: string): string {
    const parts = encrypted_value.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [iv_hex, auth_tag_hex, ciphertext] = parts;
    const iv = Buffer.from(iv_hex, 'hex');
    const auth_tag = Buffer.from(auth_tag_hex, 'hex');

    const decipher = createDecipheriv(this.algorithm, this.key, iv);
    decipher.setAuthTag(auth_tag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Checks if a value is already encrypted (matches the iv:tag:ciphertext format).
   */
  isEncrypted(value: string): boolean {
    const parts = value.split(':');
    if (parts.length !== 3) return false;
    // Each part should be valid hex
    return parts.every((part) => /^[0-9a-f]+$/i.test(part));
  }
}
