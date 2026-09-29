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

  // Reproduce el defecto reportado: un documento expedido bajo contingencia
  // (Anexo Técnico 1.9 §12.2) queda con `contingency_type` vacío en el primer
  // intento y `'04'` en el reintento que declara la contingencia — es el ÚNICO
  // campo que `InvoiceFlowService.send()` llena distinto entre ambos. Antes de
  // este fix, ese cambio esperado disparaba el mismo `FISCAL_IDEMPOTENCY_CONFLICT`
  // que un payload realmente adulterado, y el reintento legítimo quedaba
  // autobloqueado.
  it('allows a contingency retry even though contingency_type changed', async () => {
    const originalHash = createHash('sha256')
      .update(JSON.stringify({ total: 100 }))
      .digest('hex');
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({ id: 100, ...data }),
    );
    const { service } = createService({
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          request_hash: originalHash,
          transmission_status: 'error',
          retry_count: 0,
        }),
        create: jest.fn(),
        update,
      },
      fiscal_evidences: { createMany: jest.fn() },
    });

    const result = await service.ensureInvoiceTransmission({
      invoice,
      provider_data: { total: 100, contingency_type: '04' },
    });

    expect(result).toMatchObject({ id: 100, transmission_status: 'retrying' });
    expect(update).toHaveBeenCalledTimes(1);
  });

  // Un cambio real en el payload —no sólo `contingency_type`— sigue
  // detectándose incluso disfrazado de reintento de contingencia: la
  // exclusión del hash es puntual, no una puerta abierta a cualquier campo.
  it('still rejects a contingency retry whose non-contingency fields changed', async () => {
    const originalHash = createHash('sha256')
      .update(JSON.stringify({ total: 100 }))
      .digest('hex');
    const { service } = createService({
      fiscal_transmissions: {
        findFirst: jest.fn().mockResolvedValue({
          id: 100,
          request_hash: originalHash,
          transmission_status: 'error',
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
        provider_data: { total: 999, contingency_type: '04' },
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
    client.fiscal_transmissions.findFirst.mockResolvedValueOnce({
      transmission_status: 'accepted',
    });

    await expect(service.claimSubmission(100)).rejects.toMatchObject({
      errorCode: 'FISCAL_IDEMPOTENCY_CONFLICT',
    });
  });

  it('rejects a claim on a fresh submitted transmission with FISCAL_SEND_IN_PROGRESS', async () => {
    const { service, client } = createService();
    client.fiscal_transmissions.updateMany.mockResolvedValueOnce({ count: 0 });
    client.fiscal_transmissions.findFirst.mockResolvedValueOnce({
      transmission_status: 'submitted',
    });

    await expect(service.claimSubmission(100)).rejects.toMatchObject({
      errorCode: 'FISCAL_SEND_IN_PROGRESS',
    });
  });

  it('claims with a where that allows stale submitted rows but not fresh ones', async () => {
    const { service, client } = createService();

    await expect(service.claimSubmission(100)).resolves.toBeUndefined();

    const args = client.fiscal_transmissions.updateMany.mock.calls[0][0];
    expect(args.where.id).toBe(100);
    const [claimable, stale] = args.where.OR;
    expect(claimable.transmission_status.in).not.toContain('submitted');
    expect(claimable.transmission_status.in).not.toContain('accepted');
    expect(stale.transmission_status).toBe('submitted');
    const cutoff = stale.sent_at.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(3 * 60_000 - 50);
    expect(Date.now() - cutoff).toBeLessThan(3 * 60_000 + 5_000);
    expect(args.data.transmission_status).toBe('submitted');
  });

  it('markSubmitted delegates to claimSubmission', async () => {
    const { service, client } = createService();
    await service.markSubmitted(100);
    expect(client.fiscal_transmissions.updateMany).toHaveBeenCalledTimes(1);
  });

  it('ensureInvoiceTransmission does not reset a submitted transmission', async () => {
    const existingRow = {
      id: 100,
      transmission_status: 'submitted',
      request_hash: null,
      retry_count: 0,
    };
    const { service, client } = createService();
    client.fiscal_transmissions.findFirst.mockResolvedValueOnce(existingRow);

    const result = await service.ensureInvoiceTransmission({
      invoice,
      provider_data: { total: 100 },
    });

    expect(result).toBe(existingRow);
    expect(client.fiscal_transmissions.update).not.toHaveBeenCalled();
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
