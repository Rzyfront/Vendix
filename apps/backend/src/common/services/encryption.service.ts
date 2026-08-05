import { Injectable, Logger } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'crypto';

import { ErrorCodes } from '../errors/error-codes';
import { VendixHttpException } from '../errors/vendix-http.exception';

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
 * Minimum length accepted for `DIAN_ENCRYPTION_KEY`. scrypt will happily stretch
 * a 4-character string into 32 bytes, which reads as "configured" while being
 * trivially brute-forceable — so a short key is treated as no key at all.
 */
const MIN_MASTER_KEY_LENGTH = 32;

/**
 * Salt used by every ciphertext written before per-record salts existed. Static
 * and shared across tenants, so ONE scrypt run per master key precomputes the
 * derived key for every stored secret in the platform.
 *
 * It cannot be removed: the rows that used it must stay readable. It just stops
 * being used for new writes.
 */
const LEGACY_STATIC_SALT = 'vendix-salt';

/**
 * Marker for the salted envelope, so a stored value declares which format it is
 * in instead of being guessed by part count alone.
 */
const ENVELOPE_VERSION = 'v2';

/** Salt length in bytes. 16 is the scrypt recommendation and matches the IV. */
const SALT_BYTES = 16;

/**
 * Cap on memoized scrypt results. Each distinct (master key, salt) pair costs
 * ~100ms to derive, and with per-record salts the pair count grows with the
 * number of stored secrets — so the cache is bounded rather than unbounded.
 *
 * A tenant holds a handful of fiscal secrets (Software-PIN, certificate
 * password), so in practice every repeated decrypt of the same row hits the
 * cache and only the first read of a given secret pays scrypt.
 */
const MAX_DERIVED_KEYS = 256;

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
  /**
   * scrypt costs ~100ms, so a derived key is memoized BY SOURCE STRING rather
   * than resolved once and latched. See {@link resolveMasterKey} for why the
   * resolution itself must stay lazy.
   */
  private readonly derived_keys = new Map<string, Buffer>();
  /** Logged at most once per distinct misconfiguration, not per call. */
  private warned_about?: string;

  /**
   * Resolves `DIAN_ENCRYPTION_KEY` ON EVERY CALL rather than in the constructor.
   *
   * This is load-bearing, not defensive: Nest instantiates EVERY provider before
   * it fires any `onModuleInit`, and `SecretsManagerService.onModuleInit()` is
   * what copies AWS Secrets Manager values into `process.env`. A constructor
   * read therefore runs BEFORE the real key exists and would latch
   * `using_fallback_key = true` for the process lifetime — so a production
   * deployment with the key correctly stored in Secrets Manager would refuse
   * every `encrypt()` and report a false red on the readiness checklist.
   *
   * A key shorter than the threshold, or one that IS the repository fallback,
   * provides no confidentiality, so both count as unconfigured.
   */
  private resolveMasterKey(): string | undefined {
    const raw_key = process.env.DIAN_ENCRYPTION_KEY?.trim();
    if (
      raw_key &&
      raw_key.length >= MIN_MASTER_KEY_LENGTH &&
      raw_key !== LEGACY_FALLBACK_KEY_SOURCE
    ) {
      return raw_key;
    }

    const detail = raw_key
      ? `DIAN_ENCRYPTION_KEY is set but unusable (needs at least ${MIN_MASTER_KEY_LENGTH} chars and must differ from the repository fallback)`
      : 'DIAN_ENCRYPTION_KEY not set';
    if (this.warned_about !== detail) {
      this.warned_about = detail;
      // In production this is not a warning, it is a misconfiguration that will
      // refuse every new secret. Log it at the level that pages someone.
      if (this.isProduction()) {
        this.logger.error(
          `${detail} — refusing to encrypt new secrets. Existing values remain readable.`,
        );
      } else {
        this.logger.warn(
          `${detail} — encryption service will use a fallback key (NOT SAFE FOR PRODUCTION)`,
        );
      }
    }
    return undefined;
  }

  /** Master key sources tried on decrypt, active first. */
  private masterKeySources(): string[] {
    const active = this.resolveMasterKey();
    return active ? [active, LEGACY_FALLBACK_KEY_SOURCE] : [LEGACY_FALLBACK_KEY_SOURCE];
  }

  /** Source used to encrypt: the active key, or the fallback when unconfigured. */
  private activeMasterKeySource(): string {
    return this.resolveMasterKey() ?? LEGACY_FALLBACK_KEY_SOURCE;
  }

  /**
   * Derives the AES key from a master key source and a salt.
   *
   * The salt is now PER RECORD (see {@link encrypt}) instead of a single constant
   * shared by every tenant. With a shared salt, one scrypt run per master key
   * yields the derived key that opens every secret in the platform, so an
   * attacker who reaches the ciphertexts amortizes the KDF cost across all of
   * them at once; a per-record salt forces that cost to be paid per row.
   *
   * It also makes rotation possible without a re-encryption migration: each new
   * write simply carries a fresh salt, and rows written earlier keep decrypting
   * with whatever salt their own envelope declares. That is what closes the
   * "rotating the salt invalidates every ciphertext" deadlock — nothing has to be
   * rewritten for the new records to be independently salted.
   */
  private deriveKey(key_source: string, salt: Buffer | string): Buffer {
    const salt_id =
      typeof salt === 'string' ? `s:${salt}` : `b:${salt.toString('hex')}`;
    const cache_key = `${key_source}::${salt_id}`;

    const cached = this.derived_keys.get(cache_key);
    if (cached) return cached;

    const derived = scryptSync(key_source, salt, 32);

    // Bounded FIFO: with per-record salts the key space grows with stored
    // secrets, and an unbounded map in a long-lived process is a slow leak.
    if (this.derived_keys.size >= MAX_DERIVED_KEYS) {
      const oldest = this.derived_keys.keys().next().value;
      if (oldest !== undefined) this.derived_keys.delete(oldest);
    }
    this.derived_keys.set(cache_key, derived);
    return derived;
  }

  /**
   * Read at call time rather than cached in the constructor so a test can flip
   * NODE_ENV around a single assertion without rebuilding the service.
   */
  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  /**
   * True when this instance is encrypting with the repository-visible fallback
   * key. Production gates use it to refuse emission instead of silently storing
   * recoverable secrets.
   */
  isUsingFallbackKey(): boolean {
    return !this.resolveMasterKey();
  }

  /**
   * Encrypts plaintext using AES-256-GCM with the ACTIVE key and a FRESH salt.
   *
   * Output: `v2:salt:iv:authTag:ciphertext` (all hex after the marker). The salt
   * travels with the record precisely so it does not have to be a platform-wide
   * constant — see {@link deriveKey}.
   */
  encrypt(plaintext: string): string {
    // Refuse to MINT a new secret under the repository-visible key in production.
    // Reads stay open on purpose (see FISCAL_ENCRYPTION_KEY_MISSING): blocking
    // decrypt would brick an environment that already ran without the variable,
    // while blocking encrypt only stops the leak from growing.
    if (this.isUsingFallbackKey() && this.isProduction()) {
      throw new VendixHttpException(ErrorCodes.FISCAL_ENCRYPTION_KEY_MISSING);
    }

    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(16);
    const key = this.deriveKey(this.activeMasterKeySource(), salt);
    const cipher = createCipheriv(this.algorithm, key, iv);

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const auth_tag = cipher.getAuthTag().toString('hex');

    return [
      ENVELOPE_VERSION,
      salt.toString('hex'),
      iv.toString('hex'),
      auth_tag,
      encrypted,
    ].join(':');
  }

  /**
   * Decrypts a value written by this service, in either envelope:
   *
   * - `v2:salt:iv:tag:ciphertext` — per-record salt, read from the envelope.
   * - `iv:tag:ciphertext` — pre-v2, derived with {@link LEGACY_STATIC_SALT}.
   *
   * Each candidate master key is tried against the salt the record declares.
   * GCM authenticates the ciphertext, so a wrong key throws instead of returning
   * garbage — which is exactly what makes trying keys in sequence safe.
   */
  decrypt(encrypted_value: string): string {
    const envelope = this.parseEnvelope(encrypted_value);
    if (!envelope) {
      throw new Error('Invalid encrypted data format');
    }

    const { salt, iv, auth_tag, ciphertext } = envelope;

    let last_error: unknown = null;
    for (const source of this.masterKeySources()) {
      try {
        const decipher = createDecipheriv(
          this.algorithm,
          this.deriveKey(source, salt),
          iv,
        );
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
   * True when the stored value should be rewritten on the next write that already
   * holds the plaintext. Two independent reasons:
   *
   * 1. It is in the pre-v2 envelope, so it shares the platform-wide static salt.
   * 2. The active master key cannot open it, i.e. it was written before
   *    `DIAN_ENCRYPTION_KEY` existed and only a legacy key opens it.
   *
   * Rewriting is opportunistic on purpose: it retires the weaker ciphertext
   * without a data migration, so nothing has to mutate rows in bulk.
   */
  needsReencryption(encrypted_value: string): boolean {
    const envelope = this.parseEnvelope(encrypted_value);
    if (!envelope) return false;

    // Shared static salt → rewrite regardless of which key opens it.
    if (envelope.is_legacy_envelope) return true;

    const active = this.resolveMasterKey();
    if (!active) return false; // Nothing better to re-encrypt under.

    try {
      const decipher = createDecipheriv(
        this.algorithm,
        this.deriveKey(active, envelope.salt),
        envelope.iv,
      );
      decipher.setAuthTag(envelope.auth_tag);
      decipher.update(envelope.ciphertext, 'hex', 'utf8');
      decipher.final('utf8');
      return false;
    } catch {
      // Active key cannot open it; a legacy key might.
      return true;
    }
  }

  /** Checks if a value is in either supported encrypted envelope. */
  isEncrypted(value: string): boolean {
    return this.parseEnvelope(value) !== null;
  }

  /**
   * Splits a stored value into its parts, accepting both envelopes. Returns null
   * when the shape does not match, which is what {@link isEncrypted} reports and
   * what lets callers distinguish "plaintext" from "corrupt ciphertext".
   */
  private parseEnvelope(value: string): {
    salt: Buffer | string;
    iv: Buffer;
    auth_tag: Buffer;
    ciphertext: string;
    is_legacy_envelope: boolean;
  } | null {
    if (typeof value !== 'string') return null;
    const parts = value.split(':');
    const is_hex = (part: string) => /^[0-9a-f]+$/i.test(part);

    if (parts.length === 5 && parts[0] === ENVELOPE_VERSION) {
      const [, salt_hex, iv_hex, auth_tag_hex, ciphertext] = parts;
      if (![salt_hex, iv_hex, auth_tag_hex, ciphertext].every(is_hex)) {
        return null;
      }
      return {
        salt: Buffer.from(salt_hex, 'hex'),
        iv: Buffer.from(iv_hex, 'hex'),
        auth_tag: Buffer.from(auth_tag_hex, 'hex'),
        ciphertext,
        is_legacy_envelope: false,
      };
    }

    if (parts.length === 3) {
      const [iv_hex, auth_tag_hex, ciphertext] = parts;
      if (![iv_hex, auth_tag_hex, ciphertext].every(is_hex)) return null;
      return {
        salt: LEGACY_STATIC_SALT,
        iv: Buffer.from(iv_hex, 'hex'),
        auth_tag: Buffer.from(auth_tag_hex, 'hex'),
        ciphertext,
        is_legacy_envelope: true,
      };
    }

    return null;
  }
}
