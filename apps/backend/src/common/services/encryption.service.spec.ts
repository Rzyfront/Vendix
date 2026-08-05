import { createCipheriv, randomBytes, scryptSync } from 'crypto';

import { EncryptionService } from './encryption.service';

/**
 * Salt every ciphertext written before per-record salts existed. Duplicated here
 * ON PURPOSE instead of exported from the service: this value is part of the
 * stored data format, so the test must pin it independently. If someone changes
 * the constant in the service, this file has to fail — an export would let both
 * move together and silently orphan every pre-v2 row in the database.
 */
const LEGACY_STATIC_SALT = 'vendix-salt';

/**
 * Reproduces the pre-v2 envelope (`iv:authTag:ciphertext`, static salt) so the
 * backward-compatible read path can be tested against a value the current
 * `encrypt()` is no longer able to produce.
 */
function encryptLegacyEnvelope(plaintext: string, keySource: string): string {
  const key = scryptSync(keySource, LEGACY_STATIC_SALT, 32);
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return [
    iv.toString('hex'),
    cipher.getAuthTag().toString('hex'),
    encrypted,
  ].join(':');
}

/**
 * The key cascade is what lets an environment that ran WITHOUT
 * DIAN_ENCRYPTION_KEY keep reading its DIAN secrets after the variable is set —
 * with zero rows mutated. These tests pin that contract.
 */
describe('EncryptionService key cascade', () => {
  const ORIGINAL_KEY = process.env.DIAN_ENCRYPTION_KEY;
  const ORIGINAL_ENV = process.env.NODE_ENV;

  // Both are 34 chars: the service treats anything under 32 as unconfigured,
  // because scrypt stretches a 4-char string into 32 bytes just as willingly.
  const ACTIVE_KEY = 'active-master-key-0123456789abcdef';
  const FOREIGN_KEY = 'a-totally-different-key-0123456789';

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.DIAN_ENCRYPTION_KEY;
    else process.env.DIAN_ENCRYPTION_KEY = ORIGINAL_KEY;
    if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = ORIGINAL_ENV;
  });

  function serviceWithKey(key?: string): EncryptionService {
    if (key === undefined) delete process.env.DIAN_ENCRYPTION_KEY;
    else process.env.DIAN_ENCRYPTION_KEY = key;
    return new EncryptionService();
  }

  it('round-trips a value with the active key', () => {
    const service = serviceWithKey(ACTIVE_KEY);
    const cipher = service.encrypt('SoftwarePIN123');

    expect(cipher).not.toContain('SoftwarePIN123');
    expect(service.isEncrypted(cipher)).toBe(true);
    expect(service.decrypt(cipher)).toBe('SoftwarePIN123');
    expect(service.needsReencryption(cipher)).toBe(false);
  });

  it('decrypts legacy fallback-key ciphertext once a real key is configured', () => {
    const legacy = serviceWithKey(undefined);
    expect(legacy.isUsingFallbackKey()).toBe(true);
    const legacyCipher = legacy.encrypt('LegacyPIN');

    const upgraded = serviceWithKey(ACTIVE_KEY);
    expect(upgraded.isUsingFallbackKey()).toBe(false);
    expect(upgraded.decrypt(legacyCipher)).toBe('LegacyPIN');
    // Flagged so the next write re-encrypts it under the active key.
    expect(upgraded.needsReencryption(legacyCipher)).toBe(true);
  });

  it('encrypts new values with the active key, not the legacy one', () => {
    const upgraded = serviceWithKey(ACTIVE_KEY);
    const cipher = upgraded.encrypt('FreshPIN');

    const legacyOnly = serviceWithKey(undefined);
    // The legacy-only instance has no access to the active key, so it must fail.
    expect(() => legacyOnly.decrypt(cipher)).toThrow();
  });

  it('throws on a value that no configured key can open', () => {
    // Written under FOREIGN_KEY...
    const foreignCipher = serviceWithKey(FOREIGN_KEY).encrypt('other-tenant');

    // ...and read back with ACTIVE_KEY configured. The cascade only tries the
    // active key and the repository legacy one, so a third key stays opaque.
    // GCM authenticates, so this throws instead of returning garbage.
    const service = serviceWithKey(ACTIVE_KEY);
    expect(() => service.decrypt(foreignCipher)).toThrow();
  });

  it('rejects malformed payloads', () => {
    const service = serviceWithKey(ACTIVE_KEY);
    expect(() => service.decrypt('not-encrypted')).toThrow(
      'Invalid encrypted data format',
    );
    expect(service.isEncrypted('not-encrypted')).toBe(false);
    expect(service.needsReencryption('not-encrypted')).toBe(false);
  });

  it('reports no re-encryption need while running on the fallback key', () => {
    const legacy = serviceWithKey(undefined);
    const cipher = legacy.encrypt('LegacyPIN');
    // There is no newer key to migrate to yet.
    expect(legacy.needsReencryption(cipher)).toBe(false);
  });

  /**
   * A key derived from a source checked into the repository protects nothing.
   * In production the service must refuse to MINT new secrets under it, while
   * still opening the ones already stored — otherwise hardening the write path
   * would brick every environment that ever ran without the variable.
   */
  describe('production guard', () => {
    it('refuses to encrypt without a real key in production', () => {
      process.env.NODE_ENV = 'production';
      const service = serviceWithKey(undefined);

      expect(service.isUsingFallbackKey()).toBe(true);
      expect(() => service.encrypt('SoftwarePIN123')).toThrow(
        /FISCAL_ENCRYPTION_KEY_MISSING|refusing to encrypt/i,
      );
    });

    it('still DECRYPTS fallback ciphertext in production', () => {
      const legacyCipher = serviceWithKey(undefined).encrypt('LegacyPIN');

      process.env.NODE_ENV = 'production';
      const production = serviceWithKey(undefined);
      // Reads must survive: the leak is the new write, not the old row.
      expect(production.decrypt(legacyCipher)).toBe('LegacyPIN');
    });

    it('encrypts normally in production once a real key is configured', () => {
      process.env.NODE_ENV = 'production';
      const service = serviceWithKey(ACTIVE_KEY);

      expect(service.isUsingFallbackKey()).toBe(false);
      expect(service.decrypt(service.encrypt('FreshPIN'))).toBe('FreshPIN');
    });

    it('treats a key shorter than 32 chars as unconfigured', () => {
      const service = serviceWithKey('short-key');
      expect(service.isUsingFallbackKey()).toBe(true);

      process.env.NODE_ENV = 'production';
      expect(() => serviceWithKey('short-key').encrypt('PIN')).toThrow();
    });

    it('treats the repository fallback source itself as unconfigured', () => {
      const service = serviceWithKey(
        'vendix-dev-fallback-key-not-for-production',
      );
      // Long enough to pass the length check, so the identity check must catch it.
      expect(service.isUsingFallbackKey()).toBe(true);
    });

    /**
     * Nest runs every constructor BEFORE any onModuleInit, and
     * SecretsManagerService.onModuleInit() is what copies the AWS secret into
     * process.env. A constructor-time read would latch the fallback and then
     * refuse every encrypt in a correctly-configured production deploy.
     */
    it('picks up a key that arrives AFTER construction (Secrets Manager order)', () => {
      process.env.NODE_ENV = 'production';
      const service = serviceWithKey(undefined);
      // Boot state: no key yet, so a write would be refused.
      expect(service.isUsingFallbackKey()).toBe(true);
      expect(() => service.encrypt('PIN')).toThrow();

      // onModuleInit lands and populates the variable.
      process.env.DIAN_ENCRYPTION_KEY = ACTIVE_KEY;

      expect(service.isUsingFallbackKey()).toBe(false);
      expect(service.decrypt(service.encrypt('PIN'))).toBe('PIN');
    });

    it('trims surrounding whitespace before judging the key', () => {
      const padded = serviceWithKey(`  ${ACTIVE_KEY}  `);
      expect(padded.isUsingFallbackKey()).toBe(false);
      // A deploy that quoted the value in .env must not silently downgrade.
      expect(padded.decrypt(serviceWithKey(ACTIVE_KEY).encrypt('PIN'))).toBe(
        'PIN',
      );
    });
  });

  /**
   * The salt used to be a platform-wide constant, which meant ONE scrypt run per
   * master key precomputed the derived key that opens every stored secret in the
   * platform — an attacker who reached the ciphertexts amortized the KDF cost
   * across all tenants at once.
   *
   * The fix carries a per-record salt inside the value. What makes it deployable
   * without a re-encryption migration is that the salt is DECLARED by the record:
   * old rows keep decrypting with the static salt their (3-part) shape implies,
   * and new rows are independently salted from the first write on.
   */
  describe('per-record salt envelope', () => {
    it('writes the versioned 5-part envelope', () => {
      const cipher = serviceWithKey(ACTIVE_KEY).encrypt('SoftwarePIN123');
      const parts = cipher.split(':');

      expect(parts).toHaveLength(5);
      expect(parts[0]).toBe('v2');
      // salt (16 bytes) and iv (16 bytes) as hex.
      expect(parts[1]).toMatch(/^[0-9a-f]{32}$/);
      expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
    });

    it('uses a FRESH salt on every write of the same plaintext', () => {
      const service = serviceWithKey(ACTIVE_KEY);
      const first = service.encrypt('SamePIN');
      const second = service.encrypt('SamePIN');

      const saltOf = (value: string) => value.split(':')[1];
      expect(saltOf(first)).not.toBe(saltOf(second));
      // A shared salt would be the whole defect; both must still round-trip.
      expect(service.decrypt(first)).toBe('SamePIN');
      expect(service.decrypt(second)).toBe('SamePIN');
    });

    it('still decrypts pre-v2 ciphertext written under the static salt', () => {
      const stored = encryptLegacyEnvelope('StoredPIN', ACTIVE_KEY);
      expect(stored.split(':')).toHaveLength(3);

      const service = serviceWithKey(ACTIVE_KEY);
      expect(service.isEncrypted(stored)).toBe(true);
      // This is the assertion that makes the change migration-free.
      expect(service.decrypt(stored)).toBe('StoredPIN');
    });

    it('decrypts a pre-v2 value written under the repository fallback key', () => {
      // Worst existing case: old envelope AND old key. Both cascades compose.
      const stored = encryptLegacyEnvelope(
        'AncientPIN',
        'vendix-dev-fallback-key-not-for-production',
      );

      expect(serviceWithKey(ACTIVE_KEY).decrypt(stored)).toBe('AncientPIN');
    });

    it('flags a pre-v2 value for re-encryption even when the active key opens it', () => {
      const stored = encryptLegacyEnvelope('StoredPIN', ACTIVE_KEY);
      const service = serviceWithKey(ACTIVE_KEY);

      // The key is already correct — the shared salt alone justifies the rewrite,
      // which happens opportunistically on the next write that holds the plaintext.
      expect(service.decrypt(stored)).toBe('StoredPIN');
      expect(service.needsReencryption(stored)).toBe(true);
    });

    it('does not flag a v2 value the active key opens', () => {
      const service = serviceWithKey(ACTIVE_KEY);
      expect(service.needsReencryption(service.encrypt('FreshPIN'))).toBe(false);
    });

    it('rejects a 5-part value whose marker is not the envelope version', () => {
      const service = serviceWithKey(ACTIVE_KEY);
      const cipher = service.encrypt('PIN');
      const forged = ['v9', ...cipher.split(':').slice(1)].join(':');

      // Part count alone must not qualify a value as ciphertext — otherwise a
      // future v3 envelope would be silently misparsed as v2 and fail auth.
      expect(service.isEncrypted(forged)).toBe(false);
      expect(() => service.decrypt(forged)).toThrow(
        'Invalid encrypted data format',
      );
    });

    it('rejects a v2 envelope whose segments are not hex', () => {
      const service = serviceWithKey(ACTIVE_KEY);
      expect(service.isEncrypted('v2:zz:zz:zz:zz')).toBe(false);
    });
  });
});
