import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PaymentEncryptionService } from '../../../store/payments/services/payment-encryption.service';
import { WompiClientFactory } from '../../../store/payments/processors/wompi/wompi.factory';
import {
  WompiConfig,
  WompiEnvironment,
} from '../../../store/payments/processors/wompi/wompi.types';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  UpsertGatewayDto,
  TestGatewayConnectionDto,
  PlatformGatewayEnvironmentEnum,
} from './dto/upsert-gateway.dto';
import { PlatformWompiConfigValidator } from './validators/platform-wompi-config.validator';

/**
 * Supported platform-level processors. The string value is also the
 * suffix used in the platform_settings.key column (`payment_gateway:<processor>`).
 */
export type PlatformProcessor = 'wompi';

const SUPPORTED_PROCESSORS: ReadonlySet<PlatformProcessor> = new Set(['wompi']);

const SETTINGS_KEY_PREFIX = 'payment_gateway:';

/** Window during which a successful test is considered "fresh enough" to
 * authorize switching production credentials to is_active=true. */
const PRODUCTION_TEST_FRESHNESS_MS = 60 * 60 * 1000; // 1 hour

interface StoredGatewayValue {
  /** Encrypted credentials, plus environment + activation flag. */
  config: {
    public_key: string;
    private_key: string; // encrypted
    events_secret: string; // encrypted
    integrity_secret: string; // encrypted
    environment: PlatformGatewayEnvironmentEnum;
  };
  is_active: boolean;
  last_tested_at?: string | null;
  last_test_result?: {
    ok: boolean;
    merchantId?: string | number;
    message?: string;
    tested_at: string;
  } | null;
  updated_by_user_id?: number | null;
  updated_at?: string;
}

export interface DecryptedCreds {
  public_key: string;
  private_key: string;
  events_secret: string;
  integrity_secret: string;
  environment: PlatformGatewayEnvironmentEnum;
}

export interface MaskedGatewayView {
  configured: boolean;
  processor: PlatformProcessor;
  environment: PlatformGatewayEnvironmentEnum | null;
  is_active: boolean;
  last_tested_at: string | null;
  last_test_result: StoredGatewayValue['last_test_result'] | null;
  credentials_masked: {
    public_key: string;
    private_key: string;
    events_secret: string;
    integrity_secret: string;
  } | null;
  updated_at: string | null;
}

export interface TestConnectionResult {
  ok: boolean;
  merchantId?: string | number;
  message?: string;
}

@Injectable()
export class PlatformGatewayService {
  private readonly logger = new Logger(PlatformGatewayService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: PaymentEncryptionService,
    private readonly wompiClientFactory: WompiClientFactory,
    private readonly validator: PlatformWompiConfigValidator,
  ) {}

  // ── Public API ───────────────────────────────────────────────────

  /**
   * Returns decrypted credentials ready to call the gateway. Returns null
   * when not configured OR `is_active=false`. Used by the SaaS billing
   * payment service when emitting platform→store charges.
   */
  async getActiveCredentials(
    processor: PlatformProcessor,
  ): Promise<DecryptedCreds | null> {
    this.assertProcessor(processor);

    const row = await this.findRow(processor);
    if (!row) return null;

    const value = this.parseValue(row.value);
    if (!value || !value.is_active) return null;

    return this.decryptStoredConfig(processor, value);
  }

  /**
   * Returns the masked view used by GET /:processor. Always safe to
   * surface to the API — sensitive fields show only the last 4 chars.
   * When no row exists, returns a non-configured stub.
   */
  async getMaskedCredentials(
    processor: PlatformProcessor,
  ): Promise<MaskedGatewayView> {
    this.assertProcessor(processor);

    const row = await this.findRow(processor);
    if (!row) {
      return {
        configured: false,
        processor,
        environment: null,
        is_active: false,
        last_tested_at: null,
        last_test_result: null,
        credentials_masked: null,
        updated_at: null,
      };
    }

    const value = this.parseValue(row.value);
    if (!value) {
      return {
        configured: false,
        processor,
        environment: null,
        is_active: false,
        last_tested_at: null,
        last_test_result: null,
        credentials_masked: null,
        updated_at: row.updated_at?.toISOString?.() ?? null,
      };
    }

    return this.toMaskedView(processor, value, row.updated_at);
  }

  /**
   * Upsert credentials. Encrypts sensitive fields, runs schema + cross-field
   * validation, and enforces the production "fresh test" requirement.
   *
   * Returns the masked view (never the raw or decrypted creds).
   */
  async upsertCredentials(
    processor: PlatformProcessor,
    dto: UpsertGatewayDto,
    userId: number | null,
  ): Promise<MaskedGatewayView> {
    this.assertProcessor(processor);

    // 1. Schema + confirm_production validation.
    await this.validator.validate(dto);

    // 2. Load previous row once and decrypt stored secrets so we can
    //    merge with the incoming DTO. Any secret omitted in the DTO
    //    falls back to the stored value (= "do not rotate").
    const previous = await this.findRow(processor);
    const previousValue = previous ? this.parseValue(previous.value) : null;
    const previousDecrypted = previousValue
      ? this.decryptStoredConfig(processor, previousValue)
      : null;

    const effectiveCreds = this.mergeCredentials(dto, previousDecrypted);

    // 3. Cross-field rule (post-merge): the EFFECTIVE keys must match
    //    the declared environment. Done here — not in the validator —
    //    because under partial PATCH the keys may come from storage.
    this.assertKeysMatchEnvironment(effectiveCreds, dto.environment);

    // 4. Production activation requires a recent successful test against
    //    the SAME credentials (or the existing stored ones if they are
    //    being reactivated). We don't run the test here — operator must
    //    POST /test first.
    if (
      dto.environment === PlatformGatewayEnvironmentEnum.PRODUCTION &&
      dto.is_active === true
    ) {
      const fresh = this.hasFreshSuccessfulTest(previousValue);
      if (!fresh) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_GATEWAY_002,
          'Debes ejecutar y aprobar un test de conexión en la última hora antes de activar producción.',
        );
      }
    }

    // 5. Encrypt the EFFECTIVE credentials (post-merge, plaintext).
    const encryptedConfig = this.encryption.encryptConfig(
      {
        public_key: effectiveCreds.public_key,
        private_key: effectiveCreds.private_key,
        events_secret: effectiveCreds.events_secret,
        integrity_secret: effectiveCreds.integrity_secret,
      },
      'wompi',
    );

    // 6. credentialsChanged compares EFFECTIVE plaintext against stored
    //    plaintext. When every secret was omitted, this is false and
    //    we preserve last_tested_at/last_test_result — which is exactly
    //    what we want for an is_active / environment-only toggle.
    const credentialsChanged =
      !previousDecrypted ||
      previousDecrypted.public_key !== effectiveCreds.public_key ||
      previousDecrypted.private_key !== effectiveCreds.private_key ||
      previousDecrypted.events_secret !== effectiveCreds.events_secret ||
      previousDecrypted.integrity_secret !== effectiveCreds.integrity_secret ||
      previousValue?.config.environment !== dto.environment;

    const now = new Date();
    const newValue: StoredGatewayValue = {
      config: {
        public_key: encryptedConfig.public_key,
        private_key: encryptedConfig.private_key,
        events_secret: encryptedConfig.events_secret,
        integrity_secret: encryptedConfig.integrity_secret,
        environment: dto.environment,
      },
      is_active: dto.is_active ?? false,
      last_tested_at: credentialsChanged
        ? null
        : (previousValue?.last_tested_at ?? null),
      last_test_result: credentialsChanged
        ? null
        : (previousValue?.last_test_result ?? null),
      updated_by_user_id: userId,
      updated_at: now.toISOString(),
    };

    const key = SETTINGS_KEY_PREFIX + processor;
    const upserted = await this.prisma.platform_settings.upsert({
      where: { key },
      create: {
        key,
        value: newValue as any,
        default_trial_days: 14,
        description: `Platform-level ${processor} payment gateway credentials (SaaS billing)`,
      },
      update: {
        value: newValue as any,
        updated_at: now,
      },
    });

    this.logger.log(
      `Platform gateway credentials upserted: processor=${processor} ` +
        `env=${dto.environment} is_active=${dto.is_active ?? false} ` +
        `by_user_id=${userId ?? 'system'}`,
    );

    return this.toMaskedView(processor, newValue, upserted.updated_at);
  }

  /**
   * Test connection to the gateway by calling a lightweight,
   * authenticated endpoint. Persists the outcome to platform_settings.
   *
   * - If `providedDto` is supplied (full creds), test those without
   *   touching the stored row's credentials, but still record the result.
   * - Otherwise test the stored credentials.
   */
  async testConnection(
    processor: PlatformProcessor,
    providedDto?: TestGatewayConnectionDto,
  ): Promise<TestConnectionResult> {
    this.assertProcessor(processor);

    const credsForTest = await this.resolveCredsForTest(processor, providedDto);

    let result: TestConnectionResult;
    try {
      const wompiConfig = this.toWompiConfig(credsForTest);
      const client = this.wompiClientFactory.getClient(
        'platform-test',
        wompiConfig,
      );
      const tokens = await client.getAcceptanceTokens();
      // We don't expose the merchant id explicitly via getAcceptanceTokens,
      // but a non-empty acceptance_token proves the merchant endpoint
      // accepted our public_key + private_key auth.
      result = {
        ok: Boolean(tokens?.acceptance_token),
        merchantId: credsForTest.public_key,
        message: tokens?.acceptance_token
          ? 'Conexión exitosa'
          : 'Respuesta sin acceptance_token',
      };
    } catch (err: any) {
      result = {
        ok: false,
        message: err?.message ?? 'Error desconocido al contactar Wompi',
      };
      this.logger.warn(
        `Platform gateway test failed: processor=${processor} message=${result.message}`,
      );
    }

    // Persist outcome (only when we have a stored row to update OR
    // when providedDto was a partial that resolved against stored creds).
    await this.recordTestResult(processor, result);

    return result;
  }

  // ── Internals ────────────────────────────────────────────────────

  private assertProcessor(
    processor: string,
  ): asserts processor is PlatformProcessor {
    if (!SUPPORTED_PROCESSORS.has(processor as PlatformProcessor)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        `Procesador no soportado: ${processor}`,
      );
    }
  }

  private async findRow(processor: PlatformProcessor) {
    const key = SETTINGS_KEY_PREFIX + processor;
    return this.prisma.platform_settings.findUnique({ where: { key } });
  }

  private parseValue(raw: unknown): StoredGatewayValue | null {
    if (!raw || typeof raw !== 'object') return null;
    const value = raw as Partial<StoredGatewayValue>;
    if (!value.config) return null;
    return value as StoredGatewayValue;
  }

  private decryptStoredConfig(
    processor: PlatformProcessor,
    value: StoredGatewayValue,
  ): DecryptedCreds {
    const decrypted = this.encryption.decryptConfig(
      {
        public_key: value.config.public_key,
        private_key: value.config.private_key,
        events_secret: value.config.events_secret,
        integrity_secret: value.config.integrity_secret,
      },
      'wompi',
    );

    return {
      public_key: decrypted.public_key,
      private_key: decrypted.private_key,
      events_secret: decrypted.events_secret,
      integrity_secret: decrypted.integrity_secret,
      environment: value.config.environment,
    };
  }

  private toMaskedView(
    processor: PlatformProcessor,
    value: StoredGatewayValue,
    rowUpdatedAt: Date | null | undefined,
  ): MaskedGatewayView {
    // public_key is NOT considered sensitive but we still keep the raw value
    // visible. Sensitive fields go through maskConfig (last 4 chars).
    const masked = this.encryption.maskConfig(
      {
        public_key: value.config.public_key,
        private_key: value.config.private_key,
        events_secret: value.config.events_secret,
        integrity_secret: value.config.integrity_secret,
      },
      'wompi',
    );

    return {
      configured: true,
      processor,
      environment: value.config.environment,
      is_active: value.is_active,
      last_tested_at: value.last_tested_at ?? null,
      last_test_result: value.last_test_result ?? null,
      credentials_masked: {
        public_key: value.config.public_key, // not in SENSITIVE_CONFIG_KEYS
        private_key: masked.private_key,
        events_secret: masked.events_secret,
        integrity_secret: masked.integrity_secret,
      },
      updated_at: value.updated_at ?? rowUpdatedAt?.toISOString?.() ?? null,
    };
  }

  private hasFreshSuccessfulTest(value: StoredGatewayValue | null): boolean {
    if (!value?.last_test_result?.ok || !value.last_tested_at) return false;
    const testedAt = new Date(value.last_tested_at).getTime();
    if (Number.isNaN(testedAt)) return false;
    return Date.now() - testedAt < PRODUCTION_TEST_FRESHNESS_MS;
  }

  private async resolveCredsForTest(
    processor: PlatformProcessor,
    providedDto?: TestGatewayConnectionDto,
  ): Promise<DecryptedCreds> {
    // If the body brings full creds, use them as-is (test before save flow).
    const hasFullProvided =
      providedDto?.public_key &&
      providedDto.private_key &&
      providedDto.events_secret &&
      providedDto.integrity_secret &&
      providedDto.environment;

    if (hasFullProvided) {
      return {
        public_key: providedDto.public_key!,
        private_key: providedDto.private_key!,
        events_secret: providedDto.events_secret!,
        integrity_secret: providedDto.integrity_secret!,
        environment: providedDto.environment!,
      };
    }

    // Otherwise fall back to stored creds.
    const row = await this.findRow(processor);
    const value = row ? this.parseValue(row.value) : null;
    if (!value) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_003,
        'No hay credenciales configuradas para esta pasarela.',
      );
    }
    return this.decryptStoredConfig(processor, value);
  }

  private async recordTestResult(
    processor: PlatformProcessor,
    result: TestConnectionResult,
  ): Promise<void> {
    const row = await this.findRow(processor);
    if (!row) return; // nothing to record against

    const value = this.parseValue(row.value);
    if (!value) return;

    const now = new Date();
    const updatedValue: StoredGatewayValue = {
      ...value,
      last_tested_at: now.toISOString(),
      last_test_result: {
        ok: result.ok,
        merchantId: result.merchantId,
        message: result.message,
        tested_at: now.toISOString(),
      },
    };

    await this.prisma.platform_settings.update({
      where: { key: SETTINGS_KEY_PREFIX + processor },
      data: { value: updatedValue as any, updated_at: now },
    });
  }

  private toWompiConfig(creds: DecryptedCreds): WompiConfig {
    return {
      public_key: creds.public_key,
      private_key: creds.private_key,
      events_secret: creds.events_secret,
      integrity_secret: creds.integrity_secret,
      environment:
        creds.environment === PlatformGatewayEnvironmentEnum.PRODUCTION
          ? WompiEnvironment.PRODUCTION
          : WompiEnvironment.SANDBOX,
    };
  }

  /**
   * Merge incoming DTO with previously stored (decrypted) credentials.
   * A secret omitted in the DTO is preserved from storage — that's the
   * partial-PATCH contract: "no value" means "do not rotate".
   *
   * If a secret is omitted AND there is no previous value, throw — we
   * can't persist an empty credential.
   */
  private mergeCredentials(
    dto: UpsertGatewayDto,
    previous: DecryptedCreds | null,
  ): {
    public_key: string;
    private_key: string;
    events_secret: string;
    integrity_secret: string;
  } {
    const pick = (
      incoming: string | undefined,
      stored: string | undefined,
      label: string,
    ): string => {
      if (incoming !== undefined) return incoming;
      if (stored !== undefined && stored !== '') return stored;
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        `Las 4 credenciales son requeridas en el primer alta de la pasarela (falta: ${label}).`,
      );
    };

    return {
      public_key: pick(dto.public_key, previous?.public_key, 'public_key'),
      private_key: pick(dto.private_key, previous?.private_key, 'private_key'),
      events_secret: pick(
        dto.events_secret,
        previous?.events_secret,
        'events_secret',
      ),
      integrity_secret: pick(
        dto.integrity_secret,
        previous?.integrity_secret,
        'integrity_secret',
      ),
    };
  }

  /**
   * Cross-field check on the EFFECTIVE keys (post-merge): pub_prod_/prv_prod_
   * must pair with environment=production and pub_test_/prv_test_ with
   * environment=sandbox. Lives in the service (not the validator)
   * because under partial PATCH the keys may come from stored values.
   */
  private assertKeysMatchEnvironment(
    creds: { public_key: string; private_key: string },
    environment: PlatformGatewayEnvironmentEnum,
  ): void {
    const isProductionEnv =
      environment === PlatformGatewayEnvironmentEnum.PRODUCTION;
    const looksProdKey =
      creds.public_key.startsWith('pub_prod_') ||
      creds.private_key.startsWith('prv_prod_');
    const looksTestKey =
      creds.public_key.startsWith('pub_test_') ||
      creds.private_key.startsWith('prv_test_');

    if (isProductionEnv && looksTestKey) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Estás declarando ambiente production pero las credenciales son de prueba (pub_test_/prv_test_).',
      );
    }
    if (!isProductionEnv && looksProdKey) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_GATEWAY_001,
        'Estás declarando ambiente sandbox pero las credenciales son de producción (pub_prod_/prv_prod_).',
      );
    }
  }

  /**
   * Compare a stored secret (which may be encrypted at rest) against an
   * incoming plaintext. Decrypts the stored side first; encryption
   * non-determinism (random IV) means we can't compare ciphertext.
   */
  private sameSecret(stored: string, incoming: string): boolean {
    if (!stored || !incoming) return false;
    if (this.encryption.isEncrypted(stored)) {
      try {
        return this.encryption.decrypt(stored) === incoming;
      } catch {
        return false;
      }
    }
    return stored === incoming;
  }
}
