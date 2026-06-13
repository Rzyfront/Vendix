import { Prisma } from '@prisma/client';

import { VendorSupportFiscalService } from './vendor-support-fiscal.service';

describe('VendorSupportFiscalService', () => {
  const PLATFORM_ORG_ID = 1;
  const PLATFORM_ACCOUNTING_ENTITY_ID = 100;
  const DIAN_CONFIG_ID = 7;
  const RESOLUTION_ID = 99;

  const baseDoc = {
    id: 42,
    organization_id: PLATFORM_ORG_ID,
    vendor_nit: '900123456',
    vendor_name: 'Proveedor SAS',
    invoice_number: 'F-2026-001',
    issue_date: new Date('2026-06-01T12:00:00.000Z'),
    subtotal: new Prisma.Decimal('100000'),
    tax_amount: new Prisma.Decimal('19000'),
    total: new Prisma.Decimal('119000'),
    currency: 'COP',
    description: 'Servicios de consultoría',
    status: 'approved',
  };

  const createService = (
    overrides: {
      settings?: any;
      doc?: any;
      sendResult?: any;
    } = {},
  ) => {
    const settings = {
      is_enabled: true,
      auto_transmit: true,
      environment: 'test',
      dian_configuration_id: DIAN_CONFIG_ID,
      invoice_resolution_id: RESOLUTION_ID,
      updated_by_user_id: null,
      updated_at: null,
      ...overrides.settings,
    };

    const platformSettings = {
      findUnique: jest.fn().mockResolvedValue({ value: settings }),
      upsert: jest.fn().mockResolvedValue({}),
    };
    const dianConfigurations = {
      findUnique: jest.fn().mockResolvedValue({
        id: DIAN_CONFIG_ID,
        organization_id: PLATFORM_ORG_ID,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        configuration_type: 'support_document',
        environment: 'test',
      }),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const vendorSupportDocuments = {
      findUnique: jest.fn().mockResolvedValue(overrides.doc ?? baseDoc),
      findMany: jest.fn().mockResolvedValue([]),
    };
    const invoiceResolutions = {
      findFirst: jest.fn().mockResolvedValue({
        id: RESOLUTION_ID,
        prefix: 'DSP',
        current_number: 100,
        range_to: 999_999,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        document_type: 'support_document',
      }),
      findUnique: jest.fn().mockResolvedValue({
        id: RESOLUTION_ID,
        prefix: 'DSP',
        current_number: 101,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    const fiscalTransmissions = {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({
        id: 555,
        transmission_status: 'accepted',
      }),
      create: jest.fn().mockResolvedValue({
        id: 555,
        organization_id: PLATFORM_ORG_ID,
        store_id: null,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        document_number: 'DSP101',
        transmission_status: 'queued',
      }),
      update: jest.fn().mockResolvedValue({
        id: 555,
        organization_id: PLATFORM_ORG_ID,
        store_id: null,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        document_number: 'DSP101',
        transmission_status: 'accepted',
        created_by_user_id: null,
      }),
      count: jest.fn().mockResolvedValue(0),
    };
    const fiscalEvidences = {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    };

    const tx = {
      $queryRawUnsafe: jest.fn().mockResolvedValue(undefined),
      invoice_resolutions: invoiceResolutions,
      fiscal_transmissions: fiscalTransmissions,
    };

    const wsClient: any = {
      platform_settings: platformSettings,
      dian_configurations: dianConfigurations,
      vendor_support_documents: vendorSupportDocuments,
      invoice_resolutions: invoiceResolutions,
      fiscal_transmissions: fiscalTransmissions,
      fiscal_evidences: fiscalEvidences,
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const prisma = {
      withoutScope: jest.fn(() => wsClient),
    };

    const platformOrgService = {
      getPlatformContext: jest.fn().mockResolvedValue({
        organization_id: PLATFORM_ORG_ID,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        fiscal_scope: 'ORGANIZATION',
        operating_scope: 'ORGANIZATION',
      }),
      requirePlatformContext: jest.fn().mockResolvedValue({
        organization_id: PLATFORM_ORG_ID,
        accounting_entity_id: PLATFORM_ACCOUNTING_ENTITY_ID,
        fiscal_scope: 'ORGANIZATION',
        operating_scope: 'ORGANIZATION',
      }),
    };

    const sendResult =
      overrides.sendResult ??
      ({
        success: true,
        tracking_id: 'TRK-1',
        cuds: 'CUDS-1',
        qr_code: 'https://qr/CUDS-1',
        xml_document: '<xml></xml>',
        message: 'ok',
        provider_data: {},
      } as any);
    const dianProvider = {
      sendSupportDocument: jest.fn().mockResolvedValue(sendResult),
    };

    const service = new VendorSupportFiscalService(
      prisma as any,
      platformOrgService as any,
      dianProvider as any,
    );

    return {
      service,
      mocks: {
        prisma,
        wsClient,
        platformOrgService,
        dianProvider,
        platformSettings,
        dianConfigurations,
        vendorSupportDocuments,
        invoiceResolutions,
        fiscalTransmissions,
        fiscalEvidences,
        tx,
      },
    };
  };

  describe('buildProviderData', () => {
    it('maps a vendor_support_document into ProviderInvoiceData with correct totals and vendor identification', () => {
      const { service } = createService();
      const data = (service as any).buildProviderData(baseDoc, 'DSP101');

      expect(data.invoice_number).toBe('DSP101');
      expect(data.invoice_type).toBe('support_document');
      expect(data.customer_tax_id).toBe('900123456');
      expect(data.customer_name).toBe('Proveedor SAS');
      expect(data.subtotal_amount).toBe('100000.00');
      expect(data.tax_amount).toBe('19000.00');
      expect(data.total_amount).toBe('119000.00');
      expect(data.currency).toBe('COP');
      expect(data.items).toHaveLength(1);
      expect(data.items[0].total_amount).toBe('119000.00');
      expect(data.taxes).toHaveLength(1);
      expect(data.taxes[0].tax_name).toBe('IVA');
      expect(data.taxes[0].tax_type).toBe('iva');
      expect(data.order_reference).toBe('F-2026-001');
    });

    it('emits no tax rows when tax_amount is zero', () => {
      const { service } = createService();
      const data = (service as any).buildProviderData(
        { ...baseDoc, tax_amount: new Prisma.Decimal(0) },
        'DSP101',
      );
      expect(data.taxes).toEqual([]);
    });
  });

  describe('transmit', () => {
    it('skips when feature is disabled', async () => {
      const { service, mocks } = createService({
        settings: { is_enabled: false },
      });
      const result = await service.transmit(baseDoc.id);
      expect(result).toEqual({
        skipped: true,
        reason: 'vendor_support_fiscal_disabled',
      });
      expect(mocks.dianProvider.sendSupportDocument).not.toHaveBeenCalled();
    });

    it('skips auto-transmit when auto_transmit is off and not manual', async () => {
      const { service, mocks } = createService({
        settings: { auto_transmit: false },
      });
      const result = await service.transmit(baseDoc.id);
      expect(result).toEqual({
        skipped: true,
        reason: 'vendor_support_fiscal_auto_transmit_disabled',
      });
      expect(mocks.dianProvider.sendSupportDocument).not.toHaveBeenCalled();
    });

    it('creates a fiscal_transmission with correct source/document type and calls DianDirectProvider.sendSupportDocument', async () => {
      const { service, mocks } = createService();
      await service.transmit(baseDoc.id, { manual: true });

      // fiscal_transmission was created with the right source_type/document_type
      const createCall = mocks.fiscalTransmissions.create.mock.calls[0]?.[0];
      expect(createCall).toBeDefined();
      expect(createCall.data.source_type).toBe('vendor_support_document');
      expect(createCall.data.document_type).toBe('support_document');
      expect(createCall.data.source_id).toBe(baseDoc.id);
      expect(createCall.data.organization_id).toBe(PLATFORM_ORG_ID);
      expect(createCall.data.store_id).toBeNull();
      expect(createCall.data.accounting_entity_id).toBe(
        PLATFORM_ACCOUNTING_ENTITY_ID,
      );
      expect(createCall.data.dian_configuration_id).toBe(DIAN_CONFIG_ID);
      expect(createCall.data.idempotency_key).toBe(
        `vendor_support_document:${baseDoc.id}`,
      );
      expect(createCall.data.document_number).toBe('DSP101');

      // DIAN provider was called with the mapped invoice data
      expect(mocks.dianProvider.sendSupportDocument).toHaveBeenCalledTimes(1);
      const providerArg = mocks.dianProvider.sendSupportDocument.mock.calls[0][0];
      expect(providerArg.invoice_number).toBe('DSP101');
      expect(providerArg.invoice_type).toBe('support_document');
      expect(providerArg.customer_tax_id).toBe('900123456');

      // advisory lock was taken
      expect(mocks.tx.$queryRawUnsafe).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        `vendor_support_fiscal_resolution:${PLATFORM_ACCOUNTING_ENTITY_ID}:${RESOLUTION_ID}`,
      );
    });

    it('refuses to transmit a non-approved document when called manually', async () => {
      const { service } = createService({
        doc: { ...baseDoc, status: 'pending' },
      });
      await expect(
        service.transmit(baseDoc.id, { manual: true }),
      ).rejects.toThrow(/must be approved/);
    });
  });
});
