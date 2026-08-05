import { Injectable, Logger } from '@nestjs/common';

import { StorePrismaService } from '../../prisma/services/store-prisma.service';
import { EncryptionService } from './encryption.service';

/** The two encrypted columns of `dian_configurations`, as stored. */
export interface StoredDianSecrets {
  software_pin_encrypted?: string | null;
  certificate_password_encrypted?: string | null;
}

/** The same secrets in the clear, as a read path already resolved them. */
export interface PlainDianSecrets {
  software_pin?: string | null;
  certificate_password?: string | null;
}

/**
 * Rewrites DIAN secrets that are still stored under a weaker envelope or an older
 * master key, using the plaintext a read path already holds.
 *
 * WHY THIS IS NOT A MIGRATION. Only the application can decrypt these columns —
 * the database sees opaque text — so no SQL migration can re-encrypt them, and
 * `DIAN_ENCRYPTION_KEY` is deliberately not available to the migration runner.
 * The rewrite therefore has to happen where the plaintext exists, which is the
 * moment a caller decrypts the secret to actually use it. One row at a time, in
 * place, with no bulk mutation of production data.
 *
 * WHY IT NEVER THROWS. Its callers are emission paths (an invoice, a support
 * document, a payroll record). Those consume an authorized consecutive: failing
 * one because a hardening rewrite failed would trade a cosmetic improvement for a
 * burned number. Every failure is logged and swallowed; the readiness checklist
 * keeps reporting the pending upgrade, so nothing is silently forgotten.
 */
@Injectable()
export class DianSecretEnvelopeService {
  private readonly logger = new Logger(DianSecretEnvelopeService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly encryption: EncryptionService,
  ) {}

  /**
   * True when at least one stored secret should be rewritten — either it uses the
   * platform-wide static salt (pre-v2 envelope) or the active master key cannot
   * open it.
   *
   * Reported as a WARNING by the readiness checklist, never as a blocker: these
   * values decrypt correctly today, and blocking emission over them would turn a
   * hardening item into an outage.
   */
  needsUpgrade(stored: StoredDianSecrets): boolean {
    // With no real key configured there is nothing better to rewrite under, so
    // the answer is "no" rather than "yes, forever".
    if (this.encryption.isUsingFallbackKey()) return false;

    return [
      stored.software_pin_encrypted,
      stored.certificate_password_encrypted,
    ].some((value) => !!value && this.encryption.needsReencryption(value));
  }

  /**
   * Re-encrypts whatever needs it and updates the row. Safe to call on every read:
   * it short-circuits when nothing is pending, which is the case from the second
   * call onwards.
   */
  async upgradeInPlace(
    configuration_id: number,
    stored: StoredDianSecrets,
    plain: PlainDianSecrets,
  ): Promise<void> {
    try {
      if (!this.needsUpgrade(stored)) return;

      const update_data: Record<string, string> = {};

      const pin = this.reencrypt(
        stored.software_pin_encrypted,
        plain.software_pin,
      );
      if (pin) update_data.software_pin_encrypted = pin;

      const password = this.reencrypt(
        stored.certificate_password_encrypted,
        plain.certificate_password,
      );
      if (password) update_data.certificate_password_encrypted = password;

      if (Object.keys(update_data).length === 0) return;

      await this.prisma.dian_configurations.update({
        where: { id: configuration_id },
        data: update_data,
      });

      this.logger.log(
        `DIAN secrets re-encrypted under the active key for configuration ${configuration_id}: ${Object.keys(
          update_data,
        ).join(', ')}`,
      );
    } catch (error) {
      // Deliberately terminal: see the class comment. An emission must not fail
      // because a hardening rewrite did.
      this.logger.warn(
        `Could not re-encrypt DIAN secrets for configuration ${configuration_id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Produces the new ciphertext for one column, or `undefined` when the column
   * must be left exactly as it is.
   *
   * The round-trip check is the important part. Writing a value that cannot be
   * read back would lose a secret the merchant obtained from the DIAN (a
   * Software-PIN) or from a certification authority (a `.p12` password) — a loss
   * no backup of the row can undo, because the plaintext only ever existed in
   * memory. So the new envelope must prove it decrypts to the same plaintext
   * BEFORE it replaces a value that currently works.
   */
  private reencrypt(
    stored_value: string | null | undefined,
    plaintext: string | null | undefined,
  ): string | undefined {
    if (!stored_value || !plaintext) return undefined;
    if (!this.encryption.needsReencryption(stored_value)) return undefined;

    const candidate = this.encryption.encrypt(plaintext);
    if (this.encryption.decrypt(candidate) !== plaintext) {
      throw new Error(
        'Re-encrypted value did not round-trip; keeping the stored one',
      );
    }
    return candidate;
  }
}
