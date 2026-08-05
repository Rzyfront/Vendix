import { createCipheriv, randomBytes, scryptSync } from 'crypto';

import { DianSecretEnvelopeService } from './dian-secret-envelope.service';
import { EncryptionService } from './encryption.service';

/**
 * These tests pin the two properties that make the rewrite deployable on a live
 * platform: it never breaks the caller, and it never replaces a working secret
 * with one that cannot be read back.
 */
describe('DianSecretEnvelopeService', () => {
  const ORIGINAL_KEY = process.env.DIAN_ENCRYPTION_KEY;
  const ACTIVE_KEY = 'active-master-key-0123456789abcdef';

  let update: jest.Mock;
  let prisma: any;
  let encryption: EncryptionService;
  let service: DianSecretEnvelopeService;

  beforeEach(() => {
    process.env.DIAN_ENCRYPTION_KEY = ACTIVE_KEY;
    update = jest.fn().mockResolvedValue({});
    prisma = { dian_configurations: { update } };
    encryption = new EncryptionService();
    service = new DianSecretEnvelopeService(prisma, encryption);
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.DIAN_ENCRYPTION_KEY;
    else process.env.DIAN_ENCRYPTION_KEY = ORIGINAL_KEY;
  });

  /**
   * A value written while `DIAN_ENCRYPTION_KEY` was missing — the second reason a
   * secret needs rewriting (the active key cannot open it).
   */
  function legacyStoredSecret(plaintext: string): string {
    delete process.env.DIAN_ENCRYPTION_KEY;
    const legacy = new EncryptionService().encrypt(plaintext);
    process.env.DIAN_ENCRYPTION_KEY = ACTIVE_KEY;
    return legacy;
  }

  /**
   * A pre-v2 value: correct key, but the platform-wide static salt. Built with
   * primitives because the current `encrypt()` can no longer produce this shape.
   */
  function staticSaltStoredSecret(plaintext: string): string {
    const key = scryptSync(ACTIVE_KEY, 'vendix-salt', 32);
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

  it('rewrites both secrets under the active key and envelope', async () => {
    const stored = {
      software_pin_encrypted: legacyStoredSecret('12345'),
      certificate_password_encrypted: legacyStoredSecret('cert-pass'),
    };

    await service.upgradeInPlace(7, stored, {
      software_pin: '12345',
      certificate_password: 'cert-pass',
    });

    expect(update).toHaveBeenCalledTimes(1);
    const { where, data } = update.mock.calls[0][0];
    expect(where).toEqual({ id: 7 });

    // Written values must be readable by the CURRENT service — that is the whole
    // point of the rewrite.
    expect(encryption.decrypt(data.software_pin_encrypted)).toBe('12345');
    expect(encryption.decrypt(data.certificate_password_encrypted)).toBe(
      'cert-pass',
    );
    expect(encryption.needsReencryption(data.software_pin_encrypted)).toBe(
      false,
    );
  });

  it('rewrites only the column that needs it', async () => {
    const stored = {
      software_pin_encrypted: legacyStoredSecret('12345'),
      // Already current: must be left byte-for-byte alone.
      certificate_password_encrypted: encryption.encrypt('cert-pass'),
    };

    await service.upgradeInPlace(7, stored, {
      software_pin: '12345',
      certificate_password: 'cert-pass',
    });

    const { data } = update.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(['software_pin_encrypted']);
  });

  it('does nothing when every secret is already current', async () => {
    const stored = {
      software_pin_encrypted: encryption.encrypt('12345'),
      certificate_password_encrypted: encryption.encrypt('cert-pass'),
    };

    await service.upgradeInPlace(7, stored, {
      software_pin: '12345',
      certificate_password: 'cert-pass',
    });

    // This is the steady state from the second read onwards: no write at all.
    expect(update).not.toHaveBeenCalled();
  });

  it('does nothing while the platform runs on the fallback key', async () => {
    // Built BEFORE unsetting the variable: the helper restores it on the way out,
    // and this test needs the service to actually see it missing.
    const stored = staticSaltStoredSecret('12345');
    delete process.env.DIAN_ENCRYPTION_KEY;
    const fallbackService = new DianSecretEnvelopeService(
      prisma,
      new EncryptionService(),
    );

    await fallbackService.upgradeInPlace(
      7,
      { software_pin_encrypted: stored },
      { software_pin: '12345' },
    );

    // Rewriting under a repository-visible key buys nothing.
    expect(update).not.toHaveBeenCalled();
  });

  /**
   * The callers are emission paths that consume an authorized DIAN consecutive.
   * A failed hardening rewrite must never be the reason a number is burned.
   */
  it('swallows a database failure instead of breaking the caller', async () => {
    update.mockRejectedValue(new Error('deadlock detected'));

    await expect(
      service.upgradeInPlace(
        7,
        { software_pin_encrypted: legacyStoredSecret('12345') },
        { software_pin: '12345' },
      ),
    ).resolves.toBeUndefined();
  });

  it('never writes a value it cannot read back', async () => {
    // Simulates a broken/rotating key setup: encrypt succeeds, decrypt does not
    // return the same plaintext. Losing this secret is unrecoverable — the
    // plaintext only ever existed in memory — so the row must stay as it is.
    const brokenEncryption = {
      isUsingFallbackKey: () => false,
      needsReencryption: () => true,
      encrypt: (value: string) => `v2:00:00:00:${value}`,
      decrypt: () => 'something-else',
    } as unknown as EncryptionService;

    const brokenService = new DianSecretEnvelopeService(
      prisma,
      brokenEncryption,
    );

    await brokenService.upgradeInPlace(
      7,
      { software_pin_encrypted: 'stored' },
      { software_pin: '12345' },
    );

    expect(update).not.toHaveBeenCalled();
  });

  it('skips a column whose plaintext the caller did not resolve', async () => {
    const stored = {
      software_pin_encrypted: legacyStoredSecret('12345'),
      certificate_password_encrypted: legacyStoredSecret('cert-pass'),
    };

    // A configuration with no certificate uploaded yet: the caller passes null.
    await service.upgradeInPlace(7, stored, {
      software_pin: '12345',
      certificate_password: null,
    });

    const { data } = update.mock.calls[0][0];
    expect(Object.keys(data)).toEqual(['software_pin_encrypted']);
  });

  describe('needsUpgrade', () => {
    it('is true for a secret the active key cannot open', () => {
      expect(
        service.needsUpgrade({
          software_pin_encrypted: legacyStoredSecret('12345'),
        }),
      ).toBe(true);
    });

    /**
     * The case that closes the recorded gap: right key, shared salt. Nothing about
     * the key tells you it needs rewriting — only the envelope does.
     */
    it('is true for a secret under the platform-wide static salt', () => {
      const stored = staticSaltStoredSecret('12345');
      // It decrypts perfectly today, which is why this must be a warning and not
      // a blocker.
      expect(encryption.decrypt(stored)).toBe('12345');
      expect(
        service.needsUpgrade({ software_pin_encrypted: stored }),
      ).toBe(true);
    });

    it('is false for a current secret', () => {
      expect(
        service.needsUpgrade({
          software_pin_encrypted: encryption.encrypt('12345'),
        }),
      ).toBe(false);
    });

    it('is false when there are no stored secrets', () => {
      expect(
        service.needsUpgrade({
          software_pin_encrypted: null,
          certificate_password_encrypted: null,
        }),
      ).toBe(false);
    });
  });
});
