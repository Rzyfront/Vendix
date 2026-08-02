import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { EncryptionService } from '../../../../common/services/encryption.service';
import { S3Service } from '../../../../common/services/s3.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PLATFORM_TIMEZONE } from '../../../../common/constants/platform-fiscal.constants';
import { normalizeNit } from '../../../../common/utils/nit.util';
import {
  localDateString,
  localTimeString,
} from '../../../../common/utils/store-timezone.util';
import { DianDirectProvider } from '../../../store/invoicing/providers/dian-direct/dian-direct.provider';
import {
  DianSoapClient,
  WsSecurityCredentials,
} from '../../../store/invoicing/providers/dian-direct/dian-soap.client';
import { DianXmlSignerService } from '../../../store/invoicing/providers/dian-direct/dian-xml-signer.service';
import {
  ProviderInvoiceData,
  ProviderResponse,
} from '../../../store/invoicing/providers/invoice-provider.interface';
import { ManualCertificateIssuerAdapter } from '../../../store/invoicing/dian-config/certificates/manual-certificate-issuer.adapter';
import { DianTestService } from '../../../store/invoicing/dian-config/dian-test.service';
import {
  CreatePlatformResolutionDto,
  ListPlatformResolutionsQueryDto,
  PLATFORM_RESOLUTION_DOCUMENT_TYPES,
  PlatformResolutionDocumentType,
  SubscriptionFiscalEnvironment,
  SubscriptionFiscalQueryDto,
  UpsertSubscriptionFiscalConfigDto,
} from './dto/subscription-fiscal.dto';

const SETTINGS_KEY = 'subscription_fiscal_billing';
const PRODUCTION_TEST_FRESHNESS_MS = 60 * 60 * 1000;
const DECIMAL_ZERO = new Prisma.Decimal(0);
const PLATFORM_ORGANIZATION_ID = 1;

interface SubscriptionFiscalSettings {
  is_enabled: boolean;
  auto_issue: boolean;
  environment: SubscriptionFiscalEnvironment;
  platform_organization_id: number | null;
  accounting_entity_id: number | null;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  last_tested_at: string | null;
  last_test_result: {
    ok: boolean;
    message?: string;
    dian_status?: string;
    environment: SubscriptionFiscalEnvironment;
    config_fingerprint: string;
    tested_at: string;
  } | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

interface SubscriptionInvoiceForFiscal {
  id: number;
  invoice_number: string;
  state: string;
  issued_at: Date | null;
  due_at: Date;
  period_start: Date;
  period_end: Date;
  subtotal: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  total: Prisma.Decimal;
  currency: string;
  line_items: Prisma.JsonValue;
  store_id: number;
  store_subscription_id: number;
  payments: Array<{
    id: number;
    state: string;
    payment_method: string | null;
    paid_at: Date | null;
    created_at: Date;
  }>;
  store_subscription: {
    plan: { name: string | null; code: string | null } | null;
    store: {
      id: number;
      name: string;
      organizations: {
        id: number;
        name: string;
        legal_name: string | null;
        tax_id: string | null;
        email: string | null;
        document_type: string | null;
        verification_digit: string | null;
        person_type: string | null;
        tax_regime: string | null;
        fiscal_responsibilities: string[];
        /**
         * Fiscal address of the adquiriente. Not duplicated on `organizations`:
         * it is the `addresses` row with `type = 'billing'`, preferring the one
         * flagged `is_primary`.
         */
        addresses: Array<{
          address_line1: string;
          address_line2: string | null;
          city: string;
          state_province: string | null;
          country_code: string;
          postal_code: string | null;
          municipality_code: string | null;
          is_primary: boolean;
        }>;
      } | null;
    };
  };
}

@Injectable()
export class SubscriptionFiscalService {
  private readonly logger = new Logger(SubscriptionFiscalService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly encryption: EncryptionService,
    private readonly s3Service: S3Service,
    private readonly dianProvider: DianDirectProvider,
    private readonly dianSoapClient: DianSoapClient,
    private readonly dianXmlSigner: DianXmlSignerService,
    private readonly certificateAdapter: ManualCertificateIssuerAdapter,
    private readonly dianTestService: DianTestService,
  ) {}

  async getStatus() {
    const settings = await this.getSettings();
    const config = settings.dian_configuration_id
      ? await this.prisma.withoutScope().dian_configurations.findUnique({
          where: { id: settings.dian_configuration_id },
        })
      : null;
    const resolution = settings.invoice_resolution_id
      ? await this.prisma.withoutScope().invoice_resolutions.findUnique({
          where: { id: settings.invoice_resolution_id },
        })
      : null;

    const [accepted, errors, pending] = await Promise.all([
      this.countTransmissions(['accepted']),
      this.countTransmissions(['error', 'rejected']),
      this.countTransmissions(['queued', 'retrying', 'submitted', 'signing', 'signed']),
    ]);

    return {
      settings,
      dian_config: config ? this.maskConfig(config) : null,
      resolution,
      stats: { accepted, errors, pending },
    };
  }

  async upsertConfig(
    dto: UpsertSubscriptionFiscalConfigDto,
    userId: number | null,
  ) {
    const previous = await this.getSettings();
    await this.assertFiscalContext(dto.platform_organization_id, dto.accounting_entity_id);
    if (dto.invoice_resolution_id) {
      await this.assertResolution(dto.invoice_resolution_id, dto.accounting_entity_id);
    }

    const existingConfig = dto.dian_configuration_id
      ? await this.prisma.withoutScope().dian_configurations.findFirst({
          where: {
            id: dto.dian_configuration_id,
            organization_id: dto.platform_organization_id,
            accounting_entity_id: dto.accounting_entity_id,
          },
        })
      : previous.dian_configuration_id
        ? await this.prisma.withoutScope().dian_configurations.findFirst({
            where: {
              id: previous.dian_configuration_id,
              organization_id: dto.platform_organization_id,
              accounting_entity_id: dto.accounting_entity_id,
            },
          })
        : null;

    if (!existingConfig && !dto.software_pin) {
      throw new BadRequestException(
        'software_pin is required when creating the platform DIAN configuration',
      );
    }

    const config = existingConfig
      ? await this.updateDianConfig(existingConfig.id, dto)
      : await this.createDianConfig(dto);
    await this.ensureSingleDefault(config.id, config.organization_id, config.accounting_entity_id);

    const nextSettings: SubscriptionFiscalSettings = {
      ...previous,
      is_enabled: dto.is_enabled,
      auto_issue: dto.auto_issue,
      environment: dto.environment,
      platform_organization_id: dto.platform_organization_id,
      accounting_entity_id: dto.accounting_entity_id,
      dian_configuration_id: config.id,
      invoice_resolution_id: dto.invoice_resolution_id ?? null,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    };

    const fingerprint = this.configFingerprint(config);
    const previousFingerprint =
      previous.last_test_result?.config_fingerprint ?? null;
    if (previousFingerprint !== fingerprint) {
      nextSettings.last_tested_at = null;
      nextSettings.last_test_result = null;
    }

    if (dto.environment === 'production' && dto.is_enabled) {
      if (!config.certificate_s3_key) {
        throw new BadRequestException(
          'Production activation requires a validated DIAN certificate',
        );
      }
      this.assertFreshProductionTest(nextSettings, fingerprint, dto.confirm_production);
      await this.prisma.withoutScope().dian_configurations.update({
        where: { id: config.id },
        data: { enablement_status: 'enabled', updated_at: new Date() },
      });
    }

    await this.saveSettings(nextSettings);
    return this.getStatus();
  }

  async uploadCertificate(params: {
    file: Express.Multer.File;
    password: string;
    userId: number | null;
  }) {
    if (!params.file?.buffer?.length) {
      throw new BadRequestException('Certificate file is required');
    }
    if (!params.password?.trim()) {
      throw new BadRequestException('Certificate password is required');
    }

    const settings = await this.requireConfiguredSettings();
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('DIAN configuration is required before uploading a certificate');
    }
    const config = await this.prisma.withoutScope().dian_configurations.findUnique({
      where: { id: settings.dian_configuration_id },
    });
    if (!config) {
      throw new BadRequestException('DIAN configuration not found');
    }

    const validation = await this.certificateAdapter.validateCertificate({
      p12_buffer: params.file.buffer,
      password: params.password.trim(),
      expected_tax_id: config.nit,
      expected_dv: config.nit_dv,
    });
    if (!validation.valid) {
      throw new BadRequestException(validation.error ?? 'Invalid certificate');
    }

    const key = `dian/platform/${config.id}/certificate-${Date.now()}.p12`;
    await this.s3Service.uploadFile(
      params.file.buffer,
      key,
      params.file.mimetype || 'application/x-pkcs12',
    );

    const updated = await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: {
        certificate_s3_key: key,
        certificate_password_encrypted: this.encryption.encrypt(
          params.password.trim(),
        ),
        certificate_expiry: validation.expires ?? null,
        certificate_fingerprint: validation.fingerprint ?? null,
        certificate_subject: validation.subject ?? null,
        certificate_issuer: validation.issuer ?? null,
        certificate_serial_number: validation.serial_number ?? null,
        certificate_nit: validation.tax_id ?? null,
        certificate_source: 'manual_upload_validated',
        certificate_uploaded_at: new Date(),
        updated_at: new Date(),
      },
    });

    const nextSettings = {
      ...settings,
      last_tested_at: null,
      last_test_result: null,
      updated_by_user_id: params.userId,
      updated_at: new Date().toISOString(),
    };
    await this.saveSettings(nextSettings);

    return this.maskConfig(updated);
  }

  async testConnection(
    userId: number | null,
  ): Promise<NonNullable<SubscriptionFiscalSettings['last_test_result']>> {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);
    const fingerprint = this.configFingerprint(config);
    const environment = config.environment as SubscriptionFiscalEnvironment;

    let wsCredentials: WsSecurityCredentials | undefined;
    if (config.certificate_s3_key && config.certificate_password_encrypted) {
      const certPassword = this.encryption.decrypt(
        config.certificate_password_encrypted,
      );
      const p12Buffer = await this.s3Service.downloadImage(config.certificate_s3_key);
      const creds = this.dianXmlSigner.extractCredentials(p12Buffer, certPassword);
      wsCredentials = {
        private_key_pem: creds.private_key_pem,
        certificate_der_base64: creds.certificate_der_base64,
      };
    }

    const response = await this.dianSoapClient.getStatus(
      '00000000-0000-0000-0000-000000000000',
      environment,
      wsCredentials,
    );
    const ok =
      response.success ||
      response.is_soap_fault === true ||
      (response.status_code !== 'NETWORK_ERROR' &&
        response.status_code !== 'TIMEOUT' &&
        (response.raw_response ?? '').includes('Envelope'));
    const message = ok
      ? 'Conexión exitosa con los servicios DIAN'
      : 'No se pudo conectar con los servicios DIAN';

    const testedAt = new Date().toISOString();
    const testResult: NonNullable<SubscriptionFiscalSettings['last_test_result']> = {
      ok,
      message,
      dian_status: response.status_code,
      environment,
      config_fingerprint: fingerprint,
      tested_at: testedAt,
    };
    const nextSettings: SubscriptionFiscalSettings = {
      ...settings,
      last_tested_at: testedAt,
      last_test_result: testResult,
      updated_by_user_id: userId,
      updated_at: testedAt,
    };
    await this.saveSettings(nextSettings);
    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: config.id },
      data: {
        last_test_result: nextSettings.last_test_result as Prisma.InputJsonValue,
        enablement_status: environment === 'test' ? 'testing' : config.enablement_status,
        updated_at: new Date(),
      },
    });

    return testResult;
  }

  // ─────────────────────────────────────────────────────────
  // DIAN test set (habilitación) for the platform's own NIT
  // ─────────────────────────────────────────────────────────

  /**
   * Runs `DianTestService` — the same, already-hardened store implementation —
   * under a platform request context.
   *
   * `DianTestService` reads through the scoped `StorePrismaService`, so it needs
   * a context to exist. The platform has an organization but no store, and that
   * is exactly the shape the scopes already handle: `dian_configurations` scopes
   * as `organization_id` + `OR[store_id = ctx.store_id, store_id IS NULL]`
   * (with `store_id` undefined the OR is satisfied by the NULL branch), and
   * fiscal-entity models fall back to `store_id IS NULL`, which is where the
   * platform's resolution lives.
   *
   * Without this, Vendix could store DIAN credentials for its own NIT but had no
   * way to submit the 50-document test set that DIAN requires before enabling
   * production — the platform rail stopped one step short of usable.
   */
  private async runInPlatformContext<T>(
    settings: SubscriptionFiscalSettings,
    fn: () => Promise<T>,
  ): Promise<T> {
    return RequestContextService.run(
      {
        organization_id: settings.platform_organization_id!,
        store_id: undefined,
        user_id: RequestContextService.getUserId(),
        is_super_admin: true,
        is_owner: false,
        roles: ['super_admin'],
        permissions: [],
        app_type: 'VENDIX_ADMIN',
      },
      fn,
    );
  }

  /** Config + resolution ids the test set needs, or a 412 naming what is missing. */
  private async requireTestSetTargets(): Promise<{
    settings: SubscriptionFiscalSettings;
    configId: number;
    resolutionId: number;
  }> {
    const settings = await this.requireConfiguredSettings();
    const config = await this.getActiveConfig(settings);
    if (!settings.invoice_resolution_id) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_FISCAL_001,
        'Registra la resolución de numeración de la plataforma antes de enviar el set de pruebas.',
        { field: 'invoice_resolution_id' },
      );
    }
    return {
      settings,
      configId: config.id,
      resolutionId: settings.invoice_resolution_id,
    };
  }

  async runTestSet() {
    const { settings, configId, resolutionId } =
      await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.runTestSet(configId, resolutionId),
    );
  }

  async checkTestSetStatus() {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.checkTestSetStatus(configId),
    );
  }

  async getTestSetDocuments(sampleSize?: number) {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.getTestSetDocumentStatus(configId, sampleSize),
    );
  }

  async abandonTestSet() {
    const { settings, configId } = await this.requireTestSetTargets();
    return this.runInPlatformContext(settings, () =>
      this.dianTestService.abandonTestSet(configId),
    );
  }

  async listTransmissions(query: SubscriptionFiscalQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const where: Prisma.fiscal_transmissionsWhereInput = {
      source_type: 'subscription_invoice',
    };
    if (query.status) {
      where.transmission_status = query.status as any;
    }
    if (query.environment) {
      where.dian_configuration = { environment: query.environment };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { document_number: { contains: search, mode: 'insensitive' } },
        { cufe: { contains: search, mode: 'insensitive' } },
        { error_message: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.prisma.withoutScope().fiscal_transmissions.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          dian_configuration: {
            select: { id: true, name: true, environment: true, enablement_status: true },
          },
        },
      }),
      this.prisma.withoutScope().fiscal_transmissions.count({ where }),
    ]);

    const invoiceIds = rows.map((row) => row.source_id);
    const invoices = invoiceIds.length
      ? await this.prisma.withoutScope().subscription_invoices.findMany({
          where: { id: { in: invoiceIds } },
          select: {
            id: true,
            invoice_number: true,
            state: true,
            total: true,
            currency: true,
            store_id: true,
            issued_at: true,
            created_at: true,
          },
        })
      : [];
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    return {
      data: rows.map((row) => ({
        ...row,
        subscription_invoice: invoiceById.get(row.source_id) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  async issueForInvoice(
    invoiceId: number,
    opts: { manual?: boolean; source?: string } = {},
  ) {
    const settings = await this.getSettings();
    if (!settings.is_enabled) {
      return {
        skipped: true,
        reason: 'subscription_fiscal_billing_disabled',
      };
    }
    if (!settings.auto_issue && !opts.manual) {
      return {
        skipped: true,
        reason: 'subscription_fiscal_auto_issue_disabled',
      };
    }

    const invoice = await this.loadSubscriptionInvoice(invoiceId);
    if (invoice.state !== 'paid') {
      if (opts.manual) {
        throw new BadRequestException('Only paid subscription invoices can be issued electronically');
      }
      return { skipped: true, reason: 'subscription_invoice_not_paid' };
    }

    // Completeness gate BEFORE ensureTransmission — that call allocates the
    // fiscal consecutive, and a rejected document still burns its number.
    const missing = this.missingCustomerFiscalData(invoice);
    if (missing.length > 0) {
      const detail = {
        subscription_invoice_id: invoiceId,
        organization_id:
          invoice.store_subscription.store.organizations?.id ?? null,
        missing_fields: missing,
      };
      if (opts.manual) {
        throw new VendixHttpException(
          ErrorCodes.SUBSCRIPTION_FISCAL_001,
          `The organization is missing fiscal data required by DIAN: ${missing.join(', ')}`,
          detail,
        );
      }
      this.logger.warn(
        `Subscription fiscal issue skipped invoice=${invoiceId}: incomplete acquirer data (${missing.join(', ')})`,
      );
      return {
        skipped: true,
        reason: 'subscription_customer_fiscal_data_incomplete',
        missing_fields: missing,
      };
    }

    const config = await this.getActiveConfig(settings);
    const transmission = await this.ensureTransmission(invoice, settings, config);
    if (transmission.transmission_status === 'accepted') {
      return { skipped: false, transmission, already_accepted: true };
    }

    try {
      await this.markSubmitted(transmission.id);
      const response = await RequestContextService.run(
        {
          organization_id: settings.platform_organization_id!,
          store_id: undefined,
          user_id: RequestContextService.getUserId(),
          is_super_admin: true,
          is_owner: false,
          roles: ['super_admin'],
          permissions: [],
          app_type: 'VENDIX_ADMIN',
        },
        () => this.dianProvider.sendInvoice(this.buildProviderData(invoice, transmission.document_number)),
      );

      if (response.success) {
        await this.markAccepted(transmission.id, response);
      } else {
        await this.markRejected(transmission.id, response);
      }
    } catch (error) {
      await this.markError(transmission.id, error);
      this.logger.warn(
        `Subscription fiscal issue failed invoice=${invoiceId} transmission=${transmission.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.prisma.withoutScope().fiscal_transmissions.findUnique({
      where: { id: transmission.id },
    });
  }

  async retryTransmission(transmissionId: number) {
    const transmission = await this.prisma.withoutScope().fiscal_transmissions.findUnique({
      where: { id: transmissionId },
    });
    if (!transmission || transmission.source_type !== 'subscription_invoice') {
      throw new BadRequestException('Fiscal transmission not found');
    }
    if (transmission.transmission_status === 'accepted') {
      throw new BadRequestException('Accepted fiscal transmissions cannot be retried');
    }
    return this.issueForInvoice(transmission.source_id, { manual: true, source: 'retry' });
  }

  /**
   * List DIAN resolutions registered for the Vendix platform organization.
   *
   * Platform resolutions are scoped to `organization_id = PLATFORM_ORGANIZATION_ID`
   * and `store_id IS NULL`. The `environment` filter is informational — the
   * `invoice_resolutions` schema has no environment column, so the actual
   * environment is inherited from the linked DIAN configuration on the
   * platform fiscal settings. Filtering by environment here is best-effort: it
   * passes through to the caller via the response metadata.
   */
  async listResolutions(query: ListPlatformResolutionsQueryDto) {
    const where: Prisma.invoice_resolutionsWhereInput = {
      organization_id: PLATFORM_ORGANIZATION_ID,
      store_id: null,
    };
    if (query.document_type) {
      where.document_type = query.document_type;
    }
    if (query.is_active !== undefined) {
      where.is_active = query.is_active;
    }

    const rows = await this.prisma.withoutScope().invoice_resolutions.findMany({
      where,
      orderBy: [{ document_type: 'asc' }, { created_at: 'desc' }],
    });

    const settings = await this.getSettings();
    const platformEnv = settings.environment;

    // The model has no env column; surface the platform env so the UI can group.
    const data = rows.map((row) => ({
      ...row,
      environment: platformEnv,
    }));

    // Apply environment filter as a no-op when it equals the platform env;
    // when it does not match, the rows belong to a different config snapshot
    // and we should hide them to keep UI semantics consistent.
    const filtered = query.environment
      ? data.filter((row) => row.environment === query.environment)
      : data;

    return filtered;
  }

  /**
   * Create a DIAN resolution for the Vendix platform organization
   * (`organization_id = PLATFORM_ORGANIZATION_ID`, `store_id = NULL`).
   *
   * Uniqueness is enforced manually because the schema unique constraint does
   * not cover (organization_id, store_id NULL, document_type, prefix).
   */
  async createResolution(dto: CreatePlatformResolutionDto) {
    if (!PLATFORM_RESOLUTION_DOCUMENT_TYPES.includes(dto.document_type)) {
      throw new BadRequestException(
        `document_type must be one of ${PLATFORM_RESOLUTION_DOCUMENT_TYPES.join(', ')}`,
      );
    }
    if (dto.rango_inicial <= 0) {
      throw new BadRequestException('rango_inicial must be greater than 0');
    }
    if (dto.rango_final <= dto.rango_inicial) {
      throw new BadRequestException(
        'rango_final must be strictly greater than rango_inicial',
      );
    }

    const settings = await this.getSettings();
    if (!settings.accounting_entity_id) {
      throw new BadRequestException(
        'Configure the platform fiscal accounting entity before creating resolutions',
      );
    }

    // Manual uniqueness check: (organization_id, store_id IS NULL, document_type, prefix).
    // Environment is not on the model — for now uniqueness ignores it because
    // the platform uses a single DIAN config / environment at a time.
    const duplicate = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          organization_id: PLATFORM_ORGANIZATION_ID,
          store_id: null,
          document_type: dto.document_type as PlatformResolutionDocumentType,
          prefix: dto.prefix,
          is_active: true,
        },
        select: { id: true },
      });
    if (duplicate) {
      throw new BadRequestException(
        `A platform resolution with prefix "${dto.prefix}" already exists for ${dto.document_type}`,
      );
    }

    const now = new Date();
    const validFrom = dto.valid_from ? new Date(dto.valid_from) : now;
    const validTo = dto.valid_to
      ? new Date(dto.valid_to)
      : new Date(now.getFullYear() + 2, now.getMonth(), now.getDate());
    const resolutionDate = dto.resolution_date
      ? new Date(dto.resolution_date)
      : now;

    const created = await this.prisma.withoutScope().invoice_resolutions.create({
      data: {
        organization_id: PLATFORM_ORGANIZATION_ID,
        store_id: null,
        accounting_entity_id: settings.accounting_entity_id,
        document_type: dto.document_type as PlatformResolutionDocumentType,
        resolution_number: dto.resolution_number ?? `PLATFORM-${dto.prefix}-${Date.now()}`,
        resolution_date: resolutionDate,
        prefix: dto.prefix,
        range_from: dto.rango_inicial,
        range_to: dto.rango_final,
        current_number: dto.rango_inicial - 1,
        valid_from: validFrom,
        valid_to: validTo,
        is_active: true,
        technical_key: dto.technical_key ?? null,
      },
    });

    return {
      ...created,
      environment: dto.environment,
    };
  }

  private async getSettings(): Promise<SubscriptionFiscalSettings> {
    const row = await this.prisma.withoutScope().platform_settings.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const value = (row?.value ?? {}) as Partial<SubscriptionFiscalSettings>;
    return {
      is_enabled: value.is_enabled ?? false,
      auto_issue: value.auto_issue ?? false,
      environment: value.environment ?? 'test',
      platform_organization_id: value.platform_organization_id ?? null,
      accounting_entity_id: value.accounting_entity_id ?? null,
      dian_configuration_id: value.dian_configuration_id ?? null,
      invoice_resolution_id: value.invoice_resolution_id ?? null,
      last_tested_at: value.last_tested_at ?? null,
      last_test_result: value.last_test_result ?? null,
      updated_by_user_id: value.updated_by_user_id ?? null,
      updated_at: value.updated_at ?? null,
    };
  }

  private async saveSettings(settings: SubscriptionFiscalSettings): Promise<void> {
    await this.prisma.withoutScope().platform_settings.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
        default_trial_days: 14,
        description: 'Platform DIAN electronic billing settings for Vendix SaaS subscription invoices',
      },
      update: {
        value: settings as unknown as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });
  }

  private async requireConfiguredSettings(): Promise<SubscriptionFiscalSettings> {
    const settings = await this.getSettings();
    if (
      !settings.platform_organization_id ||
      !settings.accounting_entity_id ||
      !settings.dian_configuration_id
    ) {
      throw new BadRequestException('Subscription fiscal billing is not configured');
    }
    return settings;
  }

  private async getActiveConfig(settings: SubscriptionFiscalSettings) {
    if (!settings.dian_configuration_id) {
      throw new BadRequestException('DIAN configuration is required');
    }
    const config = await this.prisma.withoutScope().dian_configurations.findUnique({
      where: { id: settings.dian_configuration_id },
    });
    if (!config) {
      throw new BadRequestException('DIAN configuration not found');
    }
    return config;
  }

  private async createDianConfig(dto: UpsertSubscriptionFiscalConfigDto) {
    return this.prisma.withoutScope().dian_configurations.create({
      data: {
        organization_id: dto.platform_organization_id,
        store_id: null,
        accounting_entity_id: dto.accounting_entity_id,
        name: dto.name,
        nit: dto.nit,
        nit_dv: dto.nit_dv,
        nit_type: 'NIT',
        is_default: true,
        configuration_type: 'invoicing',
        operation_mode: 'own_software',
        software_id: dto.software_id,
        software_pin_encrypted: this.encryption.encrypt(dto.software_pin!),
        environment: dto.environment,
        enablement_status: this.nextEnablementStatus(dto),
        test_set_id: dto.test_set_id,
      },
    });
  }

  private async updateDianConfig(id: number, dto: UpsertSubscriptionFiscalConfigDto) {
    const data: Prisma.dian_configurationsUpdateInput = {
      name: dto.name,
      nit: dto.nit,
      nit_dv: dto.nit_dv,
      software_id: dto.software_id,
      environment: dto.environment,
      enablement_status: this.nextEnablementStatus(dto),
      test_set_id: dto.test_set_id,
      updated_at: new Date(),
    };
    if (dto.software_pin && dto.software_pin !== '****') {
      data.software_pin_encrypted = this.encryption.encrypt(dto.software_pin);
    }
    return this.prisma.withoutScope().dian_configurations.update({
      where: { id },
      data,
    });
  }

  private nextEnablementStatus(
    dto: UpsertSubscriptionFiscalConfigDto,
  ): 'testing' | 'not_started' {
    if (dto.is_enabled && dto.environment === 'test') return 'testing';
    return 'not_started';
  }

  private async ensureSingleDefault(
    configId: number,
    organizationId: number,
    accountingEntityId: number,
  ): Promise<void> {
    await this.prisma.withoutScope().dian_configurations.updateMany({
      where: {
        organization_id: organizationId,
        accounting_entity_id: accountingEntityId,
        configuration_type: 'invoicing',
        id: { not: configId },
      },
      data: { is_default: false },
    });
    await this.prisma.withoutScope().dian_configurations.update({
      where: { id: configId },
      data: { is_default: true },
    });
  }

  private async assertFiscalContext(
    organizationId: number,
    accountingEntityId: number,
  ): Promise<void> {
    const entity = await this.prisma.withoutScope().accounting_entities.findFirst({
      where: {
        id: accountingEntityId,
        organization_id: organizationId,
        is_active: true,
      },
    });
    if (!entity) {
      throw new BadRequestException(
        'The accounting entity must belong to the selected platform organization',
      );
    }
  }

  private async assertResolution(
    resolutionId: number,
    accountingEntityId: number,
  ): Promise<void> {
    // SaaS subscription invoices always use sales_invoice. The platform-level
    // resolution must belong to the platform organization (org=1), platform
    // accounting entity (store_id=null) and be active. Resolutions created via
    // POST /superadmin/subscriptions/fiscal/resolutions live under this scope.
    const resolution = await this.prisma.withoutScope().invoice_resolutions.findFirst({
      where: {
        id: resolutionId,
        organization_id: PLATFORM_ORGANIZATION_ID,
        store_id: null,
        accounting_entity_id: accountingEntityId,
        document_type: 'sales_invoice',
        is_active: true,
      },
    });
    if (!resolution) {
      throw new BadRequestException(
        'The fiscal resolution must be active, sales_invoice, and belong to the platform accounting entity',
      );
    }
  }

  private assertFreshProductionTest(
    settings: SubscriptionFiscalSettings,
    fingerprint: string,
    confirmed?: boolean,
  ): void {
    if (!confirmed) {
      throw new BadRequestException(
        'Production activation requires explicit confirmation',
      );
    }
    const testedAt = settings.last_tested_at
      ? new Date(settings.last_tested_at).getTime()
      : 0;
    const fresh = Date.now() - testedAt <= PRODUCTION_TEST_FRESHNESS_MS;
    const result = settings.last_test_result;
    if (
      !result?.ok ||
      result.environment !== 'production' ||
      result.config_fingerprint !== fingerprint ||
      !fresh
    ) {
      throw new BadRequestException(
        'Run a successful DIAN production connection test in the last hour before activating production',
      );
    }
  }

  private configFingerprint(config: {
    id: number;
    nit: string;
    software_id: string;
    environment: string;
    software_pin_encrypted?: string | null;
    certificate_fingerprint?: string | null;
  }): string {
    return createHash('sha256')
      .update(
        [
          config.id,
          config.nit,
          config.software_id,
          config.environment,
          config.software_pin_encrypted ?? '',
          config.certificate_fingerprint ?? '',
        ].join('|'),
      )
      .digest('hex');
  }

  private async countTransmissions(statuses: string[]): Promise<number> {
    return this.prisma.withoutScope().fiscal_transmissions.count({
      where: {
        source_type: 'subscription_invoice',
        transmission_status: { in: statuses as any },
      },
    });
  }

  private maskConfig(config: any) {
    return {
      ...config,
      software_pin_encrypted: config.software_pin_encrypted ? '****' : null,
      certificate_password_encrypted: config.certificate_password_encrypted
        ? '****'
        : null,
      has_certificate: !!config.certificate_s3_key,
    };
  }

  private async loadSubscriptionInvoice(
    invoiceId: number,
  ): Promise<SubscriptionInvoiceForFiscal> {
    const invoice = await this.prisma.withoutScope().subscription_invoices.findUnique({
      where: { id: invoiceId },
      include: {
        payments: { orderBy: { created_at: 'desc' } },
        store_subscription: {
          include: {
            plan: { select: { name: true, code: true } },
            store: {
              include: {
                organizations: {
                  select: {
                    id: true,
                    name: true,
                    legal_name: true,
                    tax_id: true,
                    email: true,
                    document_type: true,
                    verification_digit: true,
                    person_type: true,
                    tax_regime: true,
                    fiscal_responsibilities: true,
                    addresses: {
                      where: { type: 'billing' },
                      orderBy: [{ is_primary: 'desc' }, { id: 'asc' }],
                      take: 1,
                      select: {
                        address_line1: true,
                        address_line2: true,
                        city: true,
                        state_province: true,
                        country_code: true,
                        postal_code: true,
                        municipality_code: true,
                        is_primary: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!invoice) {
      throw new BadRequestException('Subscription invoice not found');
    }
    return invoice as unknown as SubscriptionInvoiceForFiscal;
  }

  private async ensureTransmission(
    invoice: SubscriptionInvoiceForFiscal,
    settings: SubscriptionFiscalSettings,
    config: { id: number; accounting_entity_id: number; organization_id: number },
  ) {
    const client = this.prisma.withoutScope();
    const existing = await client.fiscal_transmissions.findFirst({
      where: {
        source_type: 'subscription_invoice',
        source_id: invoice.id,
        accounting_entity_id: settings.accounting_entity_id!,
        document_type: 'sales_invoice',
      },
      orderBy: { created_at: 'desc' },
    });
    if (existing) {
      if (existing.transmission_status === 'accepted') return existing;
      return client.fiscal_transmissions.update({
        where: { id: existing.id },
        data: {
          transmission_status:
            existing.transmission_status === 'error' ? 'retrying' : 'queued',
          retry_count:
            existing.transmission_status === 'error'
              ? { increment: 1 }
              : existing.retry_count,
          last_retry_at:
            existing.transmission_status === 'error' ? new Date() : undefined,
          updated_at: new Date(),
        },
      });
    }

    return client.$transaction(async (tx: any) => {
      const number = await this.allocateFiscalNumber(tx, settings);
      const providerData = this.buildProviderData(invoice, number.invoice_number);
      return tx.fiscal_transmissions.create({
        data: {
          organization_id: config.organization_id,
          store_id: null,
          accounting_entity_id: settings.accounting_entity_id!,
          dian_configuration_id: config.id,
          document_type: 'sales_invoice',
          source_type: 'subscription_invoice',
          source_id: invoice.id,
          document_number: number.invoice_number,
          idempotency_key: `subscription_invoice:${invoice.id}`,
          request_hash: this.hash(providerData),
          transmission_status: 'queued',
          dian_status: 'pending',
          accounting_status: 'blocked',
          created_by_user_id: RequestContextService.getUserId() ?? null,
        },
      });
    });
  }

  private async allocateFiscalNumber(
    tx: any,
    settings: SubscriptionFiscalSettings,
  ): Promise<{ invoice_number: string; resolution_id: number }> {
    if (!settings.invoice_resolution_id) {
      throw new BadRequestException('A DIAN invoice resolution is required');
    }
    const lockKey = `subscription_fiscal_resolution:${settings.accounting_entity_id}:${settings.invoice_resolution_id}`;
    // pg_advisory_xact_lock returns void — must use $executeRaw, not $queryRaw.
    // Prisma's driver adapter (7.4.1) cannot map a `void` result column and
    // throws P2010 UnsupportedNativeDataType when this runs through $queryRaw.
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', lockKey);

    const resolution = await tx.invoice_resolutions.findFirst({
      where: {
        id: settings.invoice_resolution_id,
        accounting_entity_id: settings.accounting_entity_id,
        document_type: 'sales_invoice',
        is_active: true,
        valid_from: { lte: new Date() },
        valid_to: { gte: new Date() },
      },
    });
    if (!resolution) {
      throw new BadRequestException('No active DIAN sales invoice resolution found');
    }

    const updatedCount = await tx.invoice_resolutions.updateMany({
      where: {
        id: resolution.id,
        current_number: { lt: resolution.range_to },
      },
      data: { current_number: { increment: 1 } },
    });
    if (updatedCount.count !== 1) {
      throw new BadRequestException('DIAN invoice resolution is exhausted');
    }

    const updated = await tx.invoice_resolutions.findUnique({
      where: { id: resolution.id },
    });
    return {
      invoice_number: `${updated.prefix}${updated.current_number}`,
      resolution_id: updated.id,
    };
  }

  /**
   * Fields DIAN needs from the adquiriente that Vendix cannot invent. Returns
   * the list of what is missing (empty = complete) so the caller can name them
   * to whoever has to fix them, instead of failing with an opaque rejection
   * hours later.
   *
   * `person_type` and `document_type` are NOT required: the UBL builder derives
   * both from the NIT when absent, and that derivation is correct for the only
   * two shapes a paying organization can take.
   */
  private missingCustomerFiscalData(
    invoice: SubscriptionInvoiceForFiscal,
  ): string[] {
    const org = invoice.store_subscription.store.organizations;
    const missing: string[] = [];
    if (!org) return ['organization'];

    const { number, dv } = this.splitCustomerNit(org);
    if (!number) missing.push('tax_id');
    // A NIT without its DV cannot fill CompanyID/@schemeID. Other document
    // types (CC, CE) legitimately have no DV, so only demand it for NIT.
    // `dv` covers the persisted column, the inline `900123456-8` form, and the
    // derived checksum — all three are equally valid sources.
    const documentType = org.document_type ?? (org.tax_id ? '31' : null);
    if (documentType === '31' && !dv) {
      missing.push('verification_digit');
    }
    if (!org.legal_name?.trim()) missing.push('legal_name');
    if (!org.email?.trim()) missing.push('email');

    const address = org.addresses?.[0];
    if (!address) {
      missing.push('billing_address');
    } else if (!address.municipality_code) {
      // Without the DIAN municipality code the provider omits PhysicalLocation
      // and RegistrationAddress entirely, which DIAN rejects for a NIT acquirer.
      missing.push('billing_address.municipality_code');
    }

    return missing;
  }

  /**
   * Shapes the adquiriente's billing address the way `DianDirectProvider`
   * normalizes it (`address_line1` / `city` / `state_province` /
   * `municipality_code`). Returns undefined when the organization has no
   * billing address — the provider then omits PhysicalLocation entirely rather
   * than emitting a half-filled one.
   */
  private buildCustomerAddress(
    org: SubscriptionInvoiceForFiscal['store_subscription']['store']['organizations'],
  ): Record<string, unknown> | undefined {
    const address = org?.addresses?.[0];
    if (!address) return undefined;
    return {
      address_line: [address.address_line1, address.address_line2]
        .filter(Boolean)
        .join(' '),
      city: address.city,
      municipality_code: address.municipality_code ?? undefined,
      state_province: address.state_province ?? undefined,
      country_code: address.country_code,
      postal_code: address.postal_code ?? undefined,
    };
  }

  private buildProviderData(
    invoice: SubscriptionInvoiceForFiscal,
    fiscalNumber: string,
  ): ProviderInvoiceData {
    const issuedAt = invoice.issued_at ?? invoice.payments[0]?.paid_at ?? new Date();
    const org = invoice.store_subscription.store.organizations;
    const lineItems = Array.isArray(invoice.line_items)
      ? (invoice.line_items as Array<Record<string, any>>)
      : [];
    const items =
      lineItems.length > 0
        ? lineItems.map((item) => ({
            description: String(item.description ?? 'Plan Vendix'),
            quantity: String(item.quantity ?? '1'),
            unit_price: this.money(item.unit_price ?? item.total ?? invoice.subtotal),
            discount_amount: '0.00',
            tax_amount: this.money(item.tax_amount ?? 0),
            total_amount: this.money(item.total ?? invoice.total),
          }))
        : [
            {
              description:
                invoice.store_subscription.plan?.name ??
                invoice.store_subscription.plan?.code ??
                'Plan Vendix',
              quantity: '1',
              unit_price: this.money(invoice.subtotal),
              discount_amount: '0.00',
              tax_amount: this.money(invoice.tax_amount),
              total_amount: this.money(invoice.total),
            },
          ];

    return {
      invoice_number: fiscalNumber,
      invoice_type: 'sales_invoice',
      // The platform is the DIAN obligado here, so its own timezone governs:
      // date and offset must come from the same tz-aware conversion, never from
      // a UTC clock with an offset appended (that names a different instant and
      // silently rolls the day between 00:00Z and the offset).
      issue_date: localDateString(issuedAt, PLATFORM_TIMEZONE),
      issue_time: localTimeString(issuedAt, PLATFORM_TIMEZONE),
      due_date: localDateString(invoice.due_at, PLATFORM_TIMEZONE),
      customer_name: org?.legal_name ?? org?.name ?? invoice.store_subscription.store.name,
      // NOT onlyDigits: most rows store the NIT with the DV inline, and
      // concatenating them yields a document number that belongs to nobody.
      customer_tax_id: org ? this.splitCustomerNit(org).number : undefined,
      subtotal_amount: this.money(invoice.subtotal),
      discount_amount: '0.00',
      tax_amount: this.money(invoice.tax_amount ?? DECIMAL_ZERO),
      withholding_amount: '0.00',
      total_amount: this.money(invoice.total),
      currency: invoice.currency,
      items,
      taxes: this.buildTaxRows(invoice),
      notes: `Factura electrónica generada desde factura SaaS ${invoice.invoice_number}`,
      customer_email: org?.email ?? undefined,
      customer_address: this.buildCustomerAddress(org),
      // Read the adquiriente's real fiscal identity. The previous code inferred
      // '31'/'13' from the mere presence of a tax_id and hardcoded regime '49',
      // which mislabels every responsable de IVA. Falling back only when the
      // field is genuinely absent keeps old rows transmitting as before.
      customer_document_type:
        org?.document_type ?? (org?.tax_id ? '31' : '13'),
      customer_verification_digit: org
        ? this.splitCustomerNit(org).dv
        : undefined,
      customer_person_type: org?.person_type ?? undefined,
      customer_regime: org?.tax_regime ?? '49',
      customer_tax_responsibilities: org?.fiscal_responsibilities?.length
        ? org.fiscal_responsibilities
        : undefined,
      payment_form: '1',
      payment_method: invoice.payments[0]?.payment_method ?? 'subscription',
      order_reference: invoice.invoice_number,
    };
  }

  private buildTaxRows(invoice: SubscriptionInvoiceForFiscal) {
    const tax = new Prisma.Decimal(invoice.tax_amount ?? 0);
    if (tax.lessThanOrEqualTo(DECIMAL_ZERO)) return [];
    return [
      {
        tax_name: 'IVA',
        tax_rate: '19.00',
        taxable_amount: this.money(invoice.subtotal),
        tax_amount: this.money(tax),
      },
    ];
  }

  private async markSubmitted(transmissionId: number): Promise<void> {
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'submitted',
        sent_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  private async markAccepted(
    transmissionId: number,
    response: ProviderResponse,
  ): Promise<void> {
    const updated = await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        xml_hash: response.xml_document ? this.hash(response.xml_document) : undefined,
        provider_response: response.provider_data ?? response,
        accepted_at: new Date(),
        updated_at: new Date(),
      },
    });
    await this.createEvidences(updated, response);
  }

  private async markRejected(
    transmissionId: number,
    response: ProviderResponse,
  ): Promise<void> {
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'rejected',
        dian_status: 'rejected',
        accounting_status: 'blocked',
        tracking_id: response.tracking_id,
        cufe: response.cufe,
        qr_code: response.qr_code,
        xml_document: response.xml_document,
        pdf_url: response.pdf_url,
        provider_response: response.provider_data ?? response,
        error_message: response.message,
        rejected_at: new Date(),
        updated_at: new Date(),
      },
    });
  }

  private async markError(transmissionId: number, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.prisma.withoutScope().fiscal_transmissions.update({
      where: { id: transmissionId },
      data: {
        transmission_status: 'error',
        dian_status: 'error',
        accounting_status: 'blocked',
        error_code: 'SUBSCRIPTION_FISCAL_ISSUE_FAILED',
        error_message: message,
        updated_at: new Date(),
      },
    });
  }

  private async createEvidences(transmission: any, response: ProviderResponse) {
    const values: any[] = [];
    if (response.xml_document) {
      values.push(this.evidence(transmission, 'xml_signed', response.xml_document));
    }
    if (response.pdf_url) {
      values.push(this.evidence(transmission, 'pdf', response.pdf_url));
    }
    if (response.qr_code) {
      values.push(this.evidence(transmission, 'qr', response.qr_code));
    }
    values.push(this.evidence(transmission, 'dian_response', response));
    await this.prisma.withoutScope().fiscal_evidences.createMany({
      data: values,
      skipDuplicates: true,
    });
  }

  private evidence(transmission: any, evidenceType: string, value: unknown) {
    return {
      organization_id: transmission.organization_id,
      store_id: transmission.store_id,
      accounting_entity_id: transmission.accounting_entity_id,
      fiscal_transmission_id: transmission.id,
      evidence_type: evidenceType,
      content_hash: this.hash(value),
      metadata: typeof value === 'string' ? { value } : (value as any),
      created_by_user_id: transmission.created_by_user_id,
    };
  }

  private money(value: Prisma.Decimal.Value | null | undefined): string {
    return new Prisma.Decimal(value ?? 0).toFixed(2);
  }

  private onlyDigits(value?: string | null): string | undefined {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits || undefined;
  }

  /**
   * Splits `organizations.tax_id` into the DIAN document number and its DV.
   *
   * Most rows store the NIT with the DV already inline (`800987654-3`) — every
   * organization with a NIT in dev does. Stripping non-digits would produce
   * `8009876543`, a ten-digit "NIT" that is not the company's, so the
   * adquiriente on the invoice would be a party that does not exist.
   *
   * The DV is always the derived one. It is a checksum of the number, so any
   * stored digit that disagrees is wrong — and some do: the dev seed holds
   * `800987654-3` while the modulo-11 DV of that NIT is 4. A mismatch is logged
   * rather than silently preferred, because it usually means the row's NIT was
   * typed by hand.
   */
  private splitCustomerNit(org: {
    tax_id: string | null;
    verification_digit: string | null;
  }): { number?: string; dv?: string } {
    const parsed = normalizeNit(org.tax_id);
    if (!parsed.number) return {};
    if (parsed.dv_mismatch) {
      this.logger.warn(
        `Acquirer NIT ${parsed.number} carries DV ${parsed.provided_dv} but its modulo-11 DV is ${parsed.dv}; using the derived one`,
      );
    }
    if (
      org.verification_digit &&
      org.verification_digit !== parsed.dv
    ) {
      this.logger.warn(
        `organizations.verification_digit (${org.verification_digit}) disagrees with the DV of NIT ${parsed.number} (${parsed.dv}); using the derived one`,
      );
    }
    return { number: parsed.number, dv: parsed.dv };
  }

  private hash(value: unknown): string {
    return createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value ?? {}))
      .digest('hex');
  }
}
