import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { PlatformOrgService } from '../../../../common/services/platform-org.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { DianDirectProvider } from '../../../store/invoicing/providers/dian-direct/dian-direct.provider';
import {
  ProviderInvoiceData,
  ProviderResponse,
} from '../../../store/invoicing/providers/invoice-provider.interface';
import {
  PatchVendorSupportFiscalConfigDto,
  VendorSupportFiscalEnvironment,
  VendorSupportFiscalQueryDto,
} from './dto/vendor-support-fiscal.dto';

const SETTINGS_KEY = 'vendor_support_fiscal';
const DECIMAL_ZERO = new Prisma.Decimal(0);

export interface VendorSupportFiscalSettings {
  is_enabled: boolean;
  auto_transmit: boolean;
  environment: VendorSupportFiscalEnvironment;
  dian_configuration_id: number | null;
  invoice_resolution_id: number | null;
  updated_by_user_id?: number | null;
  updated_at?: string | null;
}

interface VendorDocForFiscal {
  id: number;
  organization_id: number;
  vendor_nit: string;
  vendor_name: string;
  invoice_number: string;
  issue_date: Date;
  subtotal: Prisma.Decimal | null;
  tax_amount: Prisma.Decimal | null;
  total: Prisma.Decimal;
  currency: string;
  description: string | null;
  status: string;
}

/**
 * VendorSupportFiscalService — fiscal adapter that transmits approved
 * vendor support documents (documento soporte) to DIAN under the platform
 * organization context.
 *
 * Mirrors the SubscriptionFiscalService pattern:
 *  - settings persisted in `platform_settings['vendor_support_fiscal']`
 *  - DIAN config row is `dian_configurations` with configuration_type='support_document'
 *  - on first enable, clones the existing sales_invoice config to inherit cert + software
 *  - transmissions tracked in `fiscal_transmissions` with source_type='vendor_support_document'
 *  - business state of vendor_support_document is NEVER mixed with DIAN state
 *  - calls run inside RequestContextService.run({ org_id: platform, store_id: undefined })
 */
@Injectable()
export class VendorSupportFiscalService {
  private readonly logger = new Logger(VendorSupportFiscalService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly platformOrgService: PlatformOrgService,
    private readonly dianProvider: DianDirectProvider,
  ) {}

  // ─────────────────────────────────────────────────────────
  // Configuration
  // ─────────────────────────────────────────────────────────

  async getConfig() {
    const settings = await this.getSettings();
    const platform = await this.platformOrgService.getPlatformContext();

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
      platform_organization_id: platform?.organization_id ?? null,
      accounting_entity_id: platform?.accounting_entity_id ?? null,
      dian_config: config ? this.maskConfig(config) : null,
      resolution,
      stats: { accepted, errors, pending },
    };
  }

  async patchConfig(
    dto: PatchVendorSupportFiscalConfigDto,
    userId: number | null,
  ) {
    const platform = await this.platformOrgService.requirePlatformContext();
    const previous = await this.getSettings();

    let configId = previous.dian_configuration_id;

    // First-time enable: clone the sales_invoice config (cert + software)
    // into a sibling support_document row so the platform reuses the
    // existing fiscal credentials for vendor docs.
    if (dto.is_enabled && !configId) {
      configId = await this.cloneOrFindSupportDocumentConfig(platform);
    }

    if (dto.invoice_resolution_id) {
      await this.assertResolution(
        dto.invoice_resolution_id,
        platform.accounting_entity_id,
      );
    }

    // Keep environment + enablement status in sync with the toggle.
    if (configId) {
      await this.prisma.withoutScope().dian_configurations.update({
        where: { id: configId },
        data: {
          environment: dto.environment,
          enablement_status:
            dto.is_enabled && dto.environment === 'test'
              ? 'testing'
              : dto.is_enabled
                ? 'enabled'
                : 'not_started',
          updated_at: new Date(),
        },
      });
    }

    const nextSettings: VendorSupportFiscalSettings = {
      ...previous,
      is_enabled: dto.is_enabled,
      auto_transmit: dto.auto_transmit,
      environment: dto.environment,
      dian_configuration_id: configId,
      invoice_resolution_id:
        dto.invoice_resolution_id ?? previous.invoice_resolution_id,
      updated_by_user_id: userId,
      updated_at: new Date().toISOString(),
    };

    await this.saveSettings(nextSettings);
    return this.getConfig();
  }

  // ─────────────────────────────────────────────────────────
  // Transmission
  // ─────────────────────────────────────────────────────────

  async transmit(
    vendorSupportDocId: number,
    opts: { manual?: boolean; source?: string } = {},
  ) {
    const settings = await this.getSettings();
    if (!settings.is_enabled) {
      return {
        skipped: true,
        reason: 'vendor_support_fiscal_disabled',
      };
    }
    if (!settings.auto_transmit && !opts.manual) {
      return {
        skipped: true,
        reason: 'vendor_support_fiscal_auto_transmit_disabled',
      };
    }

    const platform = await this.platformOrgService.requirePlatformContext();
    const doc = await this.loadDocument(vendorSupportDocId);

    if (doc.status !== 'approved' && doc.status !== 'paid') {
      if (opts.manual) {
        throw new VendixHttpException(
          ErrorCodes.SYS_CONFLICT_001,
          `Vendor support document #${doc.id} must be approved before electronic transmission (status: '${doc.status}')`,
        );
      }
      return { skipped: true, reason: 'vendor_support_not_approved' };
    }

    const config = await this.getActiveConfig(settings);
    const transmission = await this.ensureTransmission(doc, settings, config, platform);

    if (transmission.transmission_status === 'accepted') {
      return { skipped: false, transmission, already_accepted: true };
    }

    try {
      await this.markSubmitted(transmission.id);
      const response = await RequestContextService.run(
        {
          organization_id: platform.organization_id,
          store_id: undefined,
          user_id: RequestContextService.getUserId(),
          is_super_admin: true,
          is_owner: false,
          roles: ['super_admin'],
          permissions: [],
          app_type: 'VENDIX_ADMIN',
        },
        () =>
          this.dianProvider.sendSupportDocument(
            this.buildProviderData(doc, transmission.document_number),
          ),
      );

      if (response.success) {
        await this.markAccepted(transmission.id, response);
      } else {
        await this.markRejected(transmission.id, response);
      }
    } catch (error) {
      await this.markError(transmission.id, error);
      this.logger.warn(
        `Vendor support fiscal transmit failed doc=${vendorSupportDocId} transmission=${transmission.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return this.prisma.withoutScope().fiscal_transmissions.findUnique({
      where: { id: transmission.id },
    });
  }

  async retryTransmission(transmissionId: number) {
    const transmission = await this.prisma
      .withoutScope()
      .fiscal_transmissions.findUnique({
        where: { id: transmissionId },
      });
    if (
      !transmission ||
      transmission.source_type !== 'vendor_support_document'
    ) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Vendor support fiscal transmission not found',
      );
    }
    if (transmission.transmission_status === 'accepted') {
      throw new VendixHttpException(
        ErrorCodes.SYS_CONFLICT_001,
        'Accepted fiscal transmissions cannot be retried',
      );
    }
    return this.transmit(transmission.source_id, {
      manual: true,
      source: 'retry',
    });
  }

  async listTransmissions(query: VendorSupportFiscalQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(Math.max(1, query.limit ?? 20), 100);
    const where: Prisma.fiscal_transmissionsWhereInput = {
      source_type: 'vendor_support_document',
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
        { cuds: { contains: search, mode: 'insensitive' } },
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
            select: {
              id: true,
              name: true,
              environment: true,
              enablement_status: true,
            },
          },
        },
      }),
      this.prisma.withoutScope().fiscal_transmissions.count({ where }),
    ]);

    const docIds = rows.map((row) => row.source_id);
    const docs = docIds.length
      ? await this.prisma.withoutScope().vendor_support_documents.findMany({
          where: { id: { in: docIds } },
          select: {
            id: true,
            invoice_number: true,
            status: true,
            total: true,
            currency: true,
            vendor_nit: true,
            vendor_name: true,
            issue_date: true,
            created_at: true,
          },
        })
      : [];
    const docById = new Map(docs.map((d) => [d.id, d]));

    return {
      data: rows.map((row) => ({
        ...row,
        vendor_support_document: docById.get(row.source_id) ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  // ─────────────────────────────────────────────────────────
  // Internal helpers
  // ─────────────────────────────────────────────────────────

  private async getSettings(): Promise<VendorSupportFiscalSettings> {
    const row = await this.prisma.withoutScope().platform_settings.findUnique({
      where: { key: SETTINGS_KEY },
    });
    const value = (row?.value ?? {}) as Partial<VendorSupportFiscalSettings>;
    return {
      is_enabled: value.is_enabled ?? false,
      auto_transmit: value.auto_transmit ?? false,
      environment: value.environment ?? 'test',
      dian_configuration_id: value.dian_configuration_id ?? null,
      invoice_resolution_id: value.invoice_resolution_id ?? null,
      updated_by_user_id: value.updated_by_user_id ?? null,
      updated_at: value.updated_at ?? null,
    };
  }

  private async saveSettings(
    settings: VendorSupportFiscalSettings,
  ): Promise<void> {
    await this.prisma.withoutScope().platform_settings.upsert({
      where: { key: SETTINGS_KEY },
      create: {
        key: SETTINGS_KEY,
        value: settings as unknown as Prisma.InputJsonValue,
        default_trial_days: 14,
        description:
          'Platform DIAN electronic vendor-support-document settings (documento soporte)',
      },
      update: {
        value: settings as unknown as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });
  }

  /**
   * Clones the platform's sales_invoice DIAN configuration into a sibling
   * support_document configuration. Returns the id of the existing or
   * newly cloned support_document config.
   */
  private async cloneOrFindSupportDocumentConfig(platform: {
    organization_id: number;
    accounting_entity_id: number;
  }): Promise<number> {
    const client = this.prisma.withoutScope();

    const existing = await client.dian_configurations.findFirst({
      where: {
        organization_id: platform.organization_id,
        accounting_entity_id: platform.accounting_entity_id,
        configuration_type: 'support_document',
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    if (existing) return existing.id;

    const salesInvoiceConfig = await client.dian_configurations.findFirst({
      where: {
        organization_id: platform.organization_id,
        accounting_entity_id: platform.accounting_entity_id,
        configuration_type: 'invoicing',
      },
      orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
    });
    if (!salesInvoiceConfig) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Platform sales_invoice DIAN configuration must exist before enabling vendor support documents',
      );
    }

    const cloned = await client.dian_configurations.create({
      data: {
        organization_id: salesInvoiceConfig.organization_id,
        store_id: null,
        accounting_entity_id: salesInvoiceConfig.accounting_entity_id,
        name: `${salesInvoiceConfig.name} (Documento Soporte)`,
        nit: salesInvoiceConfig.nit,
        nit_dv: salesInvoiceConfig.nit_dv,
        nit_type: salesInvoiceConfig.nit_type,
        is_default: true,
        configuration_type: 'support_document',
        operation_mode: salesInvoiceConfig.operation_mode,
        software_id: salesInvoiceConfig.software_id,
        software_pin_encrypted: salesInvoiceConfig.software_pin_encrypted,
        certificate_s3_key: salesInvoiceConfig.certificate_s3_key,
        certificate_password_encrypted:
          salesInvoiceConfig.certificate_password_encrypted,
        certificate_expiry: salesInvoiceConfig.certificate_expiry,
        certificate_fingerprint: salesInvoiceConfig.certificate_fingerprint,
        certificate_subject: salesInvoiceConfig.certificate_subject,
        certificate_issuer: salesInvoiceConfig.certificate_issuer,
        certificate_serial_number: salesInvoiceConfig.certificate_serial_number,
        certificate_nit: salesInvoiceConfig.certificate_nit,
        certificate_source: salesInvoiceConfig.certificate_source,
        certificate_uploaded_at: salesInvoiceConfig.certificate_uploaded_at,
        environment: salesInvoiceConfig.environment,
        enablement_status: 'testing',
        test_set_id: salesInvoiceConfig.test_set_id,
      },
    });
    return cloned.id;
  }

  private async getActiveConfig(settings: VendorSupportFiscalSettings) {
    if (!settings.dian_configuration_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_CONFIG_INCOMPLETE,
        'Vendor support DIAN configuration is required',
      );
    }
    const config = await this.prisma
      .withoutScope()
      .dian_configurations.findUnique({
        where: { id: settings.dian_configuration_id },
      });
    if (!config) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Vendor support DIAN configuration not found',
      );
    }
    return config;
  }

  private async assertResolution(
    resolutionId: number,
    accountingEntityId: number,
  ): Promise<void> {
    const resolution = await this.prisma
      .withoutScope()
      .invoice_resolutions.findFirst({
        where: {
          id: resolutionId,
          accounting_entity_id: accountingEntityId,
          document_type: 'support_document',
          is_active: true,
        },
      });
    if (!resolution) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_MISSING,
        'The DIAN resolution must be active, support_document, and belong to the platform accounting entity',
      );
    }
  }

  private async countTransmissions(statuses: string[]): Promise<number> {
    return this.prisma.withoutScope().fiscal_transmissions.count({
      where: {
        source_type: 'vendor_support_document',
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

  private async loadDocument(docId: number): Promise<VendorDocForFiscal> {
    const doc = await this.prisma
      .withoutScope()
      .vendor_support_documents.findUnique({
        where: { id: docId },
      });
    if (!doc) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        `Vendor support document #${docId} not found`,
      );
    }
    return doc as unknown as VendorDocForFiscal;
  }

  private async ensureTransmission(
    doc: VendorDocForFiscal,
    settings: VendorSupportFiscalSettings,
    config: {
      id: number;
      accounting_entity_id: number;
      organization_id: number;
    },
    platform: { organization_id: number; accounting_entity_id: number },
  ) {
    const client = this.prisma.withoutScope();
    const existing = await client.fiscal_transmissions.findFirst({
      where: {
        source_type: 'vendor_support_document',
        source_id: doc.id,
        accounting_entity_id: platform.accounting_entity_id,
        document_type: 'support_document',
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
      const number = await this.allocateFiscalNumber(tx, settings, platform);
      const providerData = this.buildProviderData(doc, number.invoice_number);
      return tx.fiscal_transmissions.create({
        data: {
          organization_id: platform.organization_id,
          store_id: null,
          accounting_entity_id: platform.accounting_entity_id,
          dian_configuration_id: config.id,
          document_type: 'support_document',
          source_type: 'vendor_support_document',
          source_id: doc.id,
          document_number: number.invoice_number,
          idempotency_key: `vendor_support_document:${doc.id}`,
          request_hash: this.hash(providerData),
          transmission_status: 'queued',
          dian_status: 'pending',
          accounting_status: 'blocked',
          created_by_user_id: RequestContextService.getUserId() ?? null,
        },
      });
    });
  }

  /**
   * Allocates the next support_document number under a per-resolution
   * advisory xact lock (replicates SubscriptionFiscalService.withInvoiceNumberLock).
   */
  private async allocateFiscalNumber(
    tx: any,
    settings: VendorSupportFiscalSettings,
    platform: { accounting_entity_id: number },
  ): Promise<{ invoice_number: string; resolution_id: number }> {
    if (!settings.invoice_resolution_id) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_MISSING,
        'A DIAN support_document resolution is required',
      );
    }
    const lockKey = `vendor_support_fiscal_resolution:${platform.accounting_entity_id}:${settings.invoice_resolution_id}`;
    // pg_advisory_xact_lock returns void — must use $executeRaw, not $queryRaw.
    // Prisma's driver adapter (7.4.1) cannot map a `void` result column and
    // throws P2010 UnsupportedNativeDataType when this runs through $queryRaw.
    await tx.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      lockKey,
    );

    const now = new Date();
    const resolution = await tx.invoice_resolutions.findFirst({
      where: {
        id: settings.invoice_resolution_id,
        accounting_entity_id: platform.accounting_entity_id,
        document_type: 'support_document',
        is_active: true,
        valid_from: { lte: now },
        valid_to: { gte: now },
      },
    });
    if (!resolution) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_MISSING,
        'No active DIAN support_document resolution found',
      );
    }

    const updatedCount = await tx.invoice_resolutions.updateMany({
      where: {
        id: resolution.id,
        current_number: { lt: resolution.range_to },
      },
      data: { current_number: { increment: 1 } },
    });
    if (updatedCount.count !== 1) {
      throw new VendixHttpException(
        ErrorCodes.FISCAL_RESOLUTION_EXHAUSTED,
        'DIAN support_document resolution is exhausted',
      );
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
   * Maps a vendor_support_document into the DIAN ProviderInvoiceData
   * contract. For documento soporte the "supplier" reported to DIAN is the
   * vendor (the non-obligated supplier), while the "issuer" is the platform.
   *
   * The DianDirectProvider builds the XML with the platform as the buyer
   * (loaded from config) and the customer fields as the vendor (seller).
   */
  buildProviderData(
    doc: VendorDocForFiscal,
    fiscalNumber: string,
  ): ProviderInvoiceData {
    const issueDate = doc.issue_date instanceof Date
      ? doc.issue_date
      : new Date(doc.issue_date);
    const subtotal = doc.subtotal ?? doc.total;
    const tax = doc.tax_amount ?? DECIMAL_ZERO;

    const items = [
      {
        description: doc.description ?? `Compra a ${doc.vendor_name}`,
        quantity: '1',
        unit_price: this.money(subtotal),
        discount_amount: '0.00',
        tax_amount: this.money(tax),
        total_amount: this.money(doc.total),
      },
    ];

    return {
      invoice_number: fiscalNumber,
      invoice_type: 'support_document',
      issue_date: issueDate.toISOString().split('T')[0],
      issue_time: `${issueDate.toISOString().split('T')[1]?.split('.')[0] ?? '00:00:00'}-05:00`,
      due_date: issueDate.toISOString().split('T')[0],
      // For documento soporte the "customer" fields carry the vendor (supplier)
      // identification — the DIAN provider uses them as the seller.
      customer_name: doc.vendor_name,
      customer_tax_id: this.onlyDigits(doc.vendor_nit) ?? doc.vendor_nit,
      customer_document_type: '13',
      customer_regime: '49',
      subtotal_amount: this.money(subtotal),
      discount_amount: '0.00',
      tax_amount: this.money(tax),
      withholding_amount: '0.00',
      total_amount: this.money(doc.total),
      currency: doc.currency,
      items,
      taxes: this.buildTaxRows(doc),
      notes: `Documento soporte generado desde compra ${doc.invoice_number}`,
      payment_form: '1',
      payment_method: 'vendor_support',
      order_reference: doc.invoice_number,
    };
  }

  private buildTaxRows(doc: VendorDocForFiscal) {
    const tax = new Prisma.Decimal(doc.tax_amount ?? 0);
    if (tax.lessThanOrEqualTo(DECIMAL_ZERO)) return [];
    const subtotal = doc.subtotal ?? doc.total;
    return [
      {
        tax_name: 'IVA',
        tax_rate: '19.00',
        taxable_amount: this.money(subtotal),
        tax_amount: this.money(tax),
        tax_type: 'iva',
      },
    ];
  }

  // ─────────────────────────────────────────────────────────
  // Transmission state machine
  // ─────────────────────────────────────────────────────────

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
    const updated = await this.prisma
      .withoutScope()
      .fiscal_transmissions.update({
        where: { id: transmissionId },
        data: {
          transmission_status: 'accepted',
          dian_status: 'accepted',
          accounting_status: 'provisional',
          tracking_id: response.tracking_id,
          cuds: response.cuds ?? response.tracking_id,
          qr_code: response.qr_code,
          xml_document: response.xml_document,
          pdf_url: response.pdf_url,
          xml_hash: response.xml_document
            ? this.hash(response.xml_document)
            : undefined,
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
        cuds: response.cuds,
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
        error_code: 'VENDOR_SUPPORT_FISCAL_TRANSMIT_FAILED',
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

  private hash(value: unknown): string {
    return createHash('sha256')
      .update(typeof value === 'string' ? value : JSON.stringify(value ?? {}))
      .digest('hex');
  }
}
