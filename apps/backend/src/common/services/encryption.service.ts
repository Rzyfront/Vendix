import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

/**
 * Key material that predates `DIAN_ENCRYPTION_KEY` being set. Rows encrypted
 * while the variable was missing are still readable through this key, which is
 * why the decrypt path tries it as a fallback.
 *
 * It is NOT a secret — it is checked into the repository — so any ciphertext it
 * can open must be treated as compromised and re-encrypted with the real key.
 */
const LEGACY_FALLBACK_KEY_SOURCE = 'vendix-dev-fallback-key-not-for-production';

/**
 * AES-256-GCM encryption service for sensitive data (DIAN software PIN,
 * certificate passwords).
 *
 * Uses `DIAN_ENCRYPTION_KEY` as the master key. Encryption ALWAYS uses the
 * active key; decryption falls back to the legacy hardcoded key so an
 * environment that ran without the variable keeps working after it is set —
 * without a data migration. Values opened through the fallback are flagged via
 * {@link needsReencryption} so callers can re-encrypt them on the next write.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  /** Key used for every `encrypt()` call. */
  private readonly key: Buffer;
  /** Extra keys tried on decrypt, newest first. Empty when none apply. */
  private readonly legacy_keys: Buffer[];
  private readonly using_fallback_key: boolean;

  constructor() {
    const master_key = process.env.DIAN_ENCRYPTION_KEY;
    this.using_fallback_key = !master_key;

    if (!master_key) {
      this.logger.warn(
        'DIAN_ENCRYPTION_KEY not set — encryption service will use a fallback key (NOT SAFE FOR PRODUCTION)',
      );
    }

    this.key = this.deriveKey(master_key || LEGACY_FALLBACK_KEY_SOURCE);
    // When a real key exists, keep the legacy one for reads only. When it does
    // not, the active key IS the legacy one, so there is nothing to fall back to.
    this.legacy_keys = master_key
      ? [this.deriveKey(LEGACY_FALLBACK_KEY_SOURCE)]
      : [];
  }

  private deriveKey(key_source: string): Buffer {
    return scryptSync(key_source, 'vendix-salt', 32);
  }

  /**
   * True when this instance is encrypting with the repository-visible fallback
   * key. Production gates use it to refuse emission instead of silently storing
   * recoverable secrets.
   */
  isUsingFallbackKey(): boolean {
    return this.using_fallback_key;
  }

  /**
   * Encrypts plaintext using AES-256-GCM with the ACTIVE key.
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
   * Decrypts a string encrypted by this service, trying the active key first and
   * then any legacy key. Expects format: iv:authTag:ciphertext (hex-encoded).
   *
   * GCM authenticates the ciphertext, so a wrong key throws instead of returning
   * garbage — which is exactly what makes trying keys in sequence safe.
   */
  decrypt(encrypted_value: string): string {
    const parts = encrypted_value.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const [iv_hex, auth_tag_hex, ciphertext] = parts;
    const iv = Buffer.from(iv_hex, 'hex');
    const auth_tag = Buffer.from(auth_tag_hex, 'hex');

    let last_error: unknown = null;
    for (const key of [this.key, ...this.legacy_keys]) {
      try {
        const decipher = createDecipheriv(this.algorithm, key, iv);
        decipher.setAuthTag(auth_tag);
        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
      } catch (error) {
        last_error = error;
      }
    }

    throw last_error instanceof Error
      ? last_error
      : new Error('Unable to decrypt value with any configured key');
  }

  /**
   * True when the value can only be opened with a legacy key, i.e. it was
   * written before `DIAN_ENCRYPTION_KEY` existed. Callers that already hold the
   * plaintext should re-`encrypt()` and persist it on their next write, which
   * retires the legacy ciphertext without a data migration.
   *
   * Returns false when there is no legacy key to compare against.
   */
  needsReencryption(encrypted_value: string): boolean {
    if (this.legacy_keys.length === 0) return false;
    if (!this.isEncrypted(encrypted_value)) return false;

    const [iv_hex, auth_tag_hex, ciphertext] = encrypted_value.split(':');
    const iv = Buffer.from(iv_hex, 'hex');
    const auth_tag = Buffer.from(auth_tag_hex, 'hex');

    try {
      const decipher = createDecipheriv(this.algorithm, this.key, iv);
      decipher.setAuthTag(auth_tag);
      decipher.update(ciphertext, 'hex', 'utf8');
      decipher.final('utf8');
      return false;
    } catch {
      // Active key cannot open it; a legacy key might.
      return true;
    }
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
