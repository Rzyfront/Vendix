import { EncryptionService } from './encryption.service';

/**
 * The key cascade is what lets an environment that ran WITHOUT
 * DIAN_ENCRYPTION_KEY keep reading its DIAN secrets after the variable is set —
 * with zero rows mutated. These tests pin that contract.
 */
describe('EncryptionService key cascade', () => {
  const ORIGINAL_KEY = process.env.DIAN_ENCRYPTION_KEY;

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.DIAN_ENCRYPTION_KEY;
    else process.env.DIAN_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  function serviceWithKey(key?: string): EncryptionService {
    if (key === undefined) delete process.env.DIAN_ENCRYPTION_KEY;
    else process.env.DIAN_ENCRYPTION_KEY = key;
    return new EncryptionService();
  }

  it('round-trips a value with the active key', () => {
    const service = serviceWithKey('active-master-key');
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

    const upgraded = serviceWithKey('active-master-key');
    expect(upgraded.isUsingFallbackKey()).toBe(false);
    expect(upgraded.decrypt(legacyCipher)).toBe('LegacyPIN');
    // Flagged so the next write re-encrypts it under the active key.
    expect(upgraded.needsReencryption(legacyCipher)).toBe(true);
  });

  it('encrypts new values with the active key, not the legacy one', () => {
    const upgraded = serviceWithKey('active-master-key');
    const cipher = upgraded.encrypt('FreshPIN');

    const legacyOnly = serviceWithKey(undefined);
    // The legacy-only instance has no access to the active key, so it must fail.
    expect(() => legacyOnly.decrypt(cipher)).toThrow();
  });

  it('throws on a value that no configured key can open', () => {
    const service = serviceWithKey('active-master-key');
    const foreign = new EncryptionService();
    process.env.DIAN_ENCRYPTION_KEY = 'a-totally-different-key';
    const foreignCipher = new EncryptionService().encrypt('other-tenant');
    void foreign;

    expect(() => service.decrypt(foreignCipher)).toThrow();
  });

  it('rejects malformed payloads', () => {
    const service = serviceWithKey('active-master-key');
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
});
