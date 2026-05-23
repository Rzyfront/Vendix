import { FiscalTransmissionLedgerService } from './fiscal-transmission-ledger.service';
import { createHash } from 'crypto';

describe('FiscalTransmissionLedgerService', () => {
  const invoice = {
    id: 10,
    organization_id: 1,
    store_id: 2,
    accounting_entity_id: 77,
    invoice_type: 'sales_invoice',
    invoice_number: 'FE11',
  };

  const createService = (overrides: any = {}) => {
    const client = {
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 100,
            ...data,
          }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: 100,
            organization_id: 1,
            store_id: 2,
            accounting_entity_id: 77,
            created_by_user_id: 9,
            ...data,
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      fiscal_evidences: {
        createMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
      ...overrides,
    };
    const prisma = { withoutScope: () => client };
    return {
      service: new FiscalTransmissionLedgerService(prisma as any),
      client,
    };
  };

  it('creates an immutable fiscal transmission scoped to accounting entity', async () => {
    const { service, client } = createService();

    const result = await service.ensureInvoiceTransmission({
      invoice,
      provider_data: { total: 100 },
      dian_configuration_id: 5,
      user_id: 9,
    });

    expect(result).toMatchObject({
      organization_id: 1,
      store_id: 2,
      accounting_entity_id: 77,
      dian_configuration_id: 5,
      document_type: 'sales_invoice',
      source_type: 'invoice',
      source_id: 10,
      idempotency_key: 'invoice:10:sales_invoice:FE11',
      transmission_status: 'queued',
      dian_status: 'pending',
      accounting_status: 'blocked',
    });
    expect(client.fiscal_transmissions.create).toHaveBeenCalledTimes(1);
  });

  it('rejects idempotent retries with a different request hash', async () => {
    const firstHash = createHash('sha256')
      .update(JSON.stringify({ total: 100 }))
      .digest('hex');
    const { service } = createService({
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          request_hash: firstHash,
          transmission_status: 'queued',
          retry_count: 0,
        }),
        create: jest.fn(),
        update: jest.fn(),
      },
      fiscal_evidences: { createMany: jest.fn() },
    });

    await expect(
      service.ensureInvoiceTransmission({
        invoice,
        provider_data: { total: 200 },
      }),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_IDEMPOTENCY_CONFLICT' });
  });

  it('blocks resubmitting an already accepted fiscal transmission', async () => {
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ total: 100 }))
      .digest('hex');
    const fiscalTransmissions = {
      findFirst: jest.fn().mockResolvedValue({
        id: 100,
        request_hash: requestHash,
        transmission_status: 'accepted',
        retry_count: 0,
      }),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    };
    const { service } = createService({
      fiscal_transmissions: fiscalTransmissions,
      fiscal_evidences: { createMany: jest.fn() },
    });

    await expect(
      service.ensureInvoiceTransmission({
        invoice,
        provider_data: { total: 100 },
      }),
    ).rejects.toMatchObject({ errorCode: 'FISCAL_IDEMPOTENCY_CONFLICT' });

    expect(fiscalTransmissions.update).not.toHaveBeenCalled();
    expect(fiscalTransmissions.updateMany).not.toHaveBeenCalled();
  });

  it('does not submit terminal accepted transmissions', async () => {
    const { service, client } = createService();
    client.fiscal_transmissions.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(service.markSubmitted(100)).rejects.toMatchObject({
      errorCode: 'FISCAL_IDEMPOTENCY_CONFLICT',
    });
  });

  it('marks accepted transmissions and stores DIAN evidence without posting accounting', async () => {
    const { service, client } = createService();

    await service.markAccepted(100, {
      success: true,
      tracking_id: 'track-1',
      cufe: 'cufe-1',
      qr_code: 'qr',
      xml_document: '<xml/>',
      pdf_url: 's3://pdf',
      message: 'accepted',
    });

    expect(client.fiscal_transmissions.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        transmission_status: 'accepted',
        dian_status: 'accepted',
        accounting_status: 'provisional',
        cufe: 'cufe-1',
      }),
    });
    expect(client.fiscal_evidences.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ evidence_type: 'xml_signed' }),
        expect.objectContaining({ evidence_type: 'pdf' }),
        expect.objectContaining({ evidence_type: 'qr' }),
        expect.objectContaining({ evidence_type: 'dian_response' }),
      ]),
      skipDuplicates: true,
    });
  });
});
