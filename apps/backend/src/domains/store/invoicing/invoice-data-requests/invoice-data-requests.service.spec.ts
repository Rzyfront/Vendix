import { StoreContextRunner } from '@common/context/store-context-runner.service';
import { RequestContextService } from '@common/context/request-context.service';
import { InvoiceDataRequestsService } from './invoice-data-requests.service';
import { DianMunicipalitiesService } from '../../addresses/dian-municipalities.service';

describe('InvoiceDataRequestsService: lazy public demand and durable delegation', () => {
  let service: InvoiceDataRequestsService,
    prisma: any,
    tx: any,
    links: any,
    motor: any,
    requests: any[];
  const binding = {
    store_id: 2,
    organization_id: 1,
    order_id: 4,
    invoice_id: 5,
    expires_at: new Date('2026-11-13T12:00:00Z'),
  };
  const capture = {
    person_type: 'NATURAL' as const,
    document_type: 'CC',
    document_number: '1023456789',
    first_name: 'Ana',
    last_name: 'Díaz',
    email: 'ANA@example.test',
    address: {
      address_line1: 'Calle 10 # 1-2',
      city: 'Bogotá, D.c.',
      state_province: 'Bogotá',
      country_code: 'CO',
      municipality_code: '11001',
    },
  };
  beforeEach(() => {
    requests = [];
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 4 }]),
      invoice_holder_changes: { findFirst: jest.fn().mockResolvedValue(null) },
      invoice_data_requests: {
        findMany: jest.fn().mockImplementation(async () => requests),
        create: jest.fn().mockImplementation(async ({ data }) => {
          const r = { id: 7, new_invoice_id: null, ...data };
          requests.push(r);
          return r;
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      orders: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: 4, order_number: 'ORD-4' }),
      },
      stores: {
        findFirst: jest.fn().mockResolvedValue({ id: 2, name: 'Shop' }),
      },
      invoice_data_requests: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      invoice_holder_changes: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    links = {
      resolveToken: jest.fn().mockResolvedValue(binding),
      isAdmissionEnabled: jest.fn().mockReturnValue(true),
    };
    motor = {
      adoptLegacySubmittedRequest: jest
        .fn()
        .mockResolvedValue({ id: 12, run_status: 'waiting' }),
      startPublic: jest.fn().mockResolvedValue({
        id: 9,
        phase: 'waiting_credit_note_dian',
        run_status: 'waiting',
        new_invoice_id: null,
      }),
      resume: jest.fn(),
    };
    const runner = {
      runInStoreContext: jest.fn(async (_store: number, callback: any) =>
        callback(),
      ),
    };
    service = new InvoiceDataRequestsService(
      prisma,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      links,
      {} as any,
      runner as any,
      motor,
      new DianMunicipalitiesService(),
    );
  });
  it('opens once, reuses canonical request and never emits fiscal documents', async () => {
    const first = await service.getByToken('signed'),
      second = await service.getByToken('signed');
    expect(first.id).toBe(second.id);
    expect(tx.invoice_data_requests.create).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveProperty('token');
    expect(first).not.toHaveProperty('email');
    expect(motor.startPublic).not.toHaveBeenCalled();
  });
  it('status and token-guarded catalog validation do not materialize requests', async () => {
    expect(await service.getStatus('signed')).toMatchObject({
      status: 'not_opened',
    });
    await service.validatePublicToken('signed');
    expect(tx.invoice_data_requests.create).not.toHaveBeenCalled();
    expect(tx.invoice_data_requests.updateMany).not.toHaveBeenCalled();
  });
  it('reads a materialized legacy request without writes when admissions are off', async () => {
    tx.invoice_data_requests.findMany.mockResolvedValue([{
      id: 7, status: 'completed', store_id: 2, order_id: 4, invoice_id: 5,
      expires_at: new Date(Date.now() + 86400000), new_invoice_id: 15,
    }]);
    links.isAdmissionEnabled.mockReturnValue(false);
    const result = await service.getByToken('legacy');
    expect(result.capabilities.can_submit).toBe(false);
    expect(links.resolveToken).toHaveBeenCalledWith('legacy', 'status');
    expect(tx.invoice_data_requests.create).not.toHaveBeenCalled();
    expect(tx.invoice_data_requests.updateMany).not.toHaveBeenCalled();
  });
  it('neutral public form ignores a staff session from another tenant', async () => {
    (service as any).contextRunner = new StoreContextRunner({
      stores: {
        findUnique: jest.fn().mockResolvedValue({ organization_id: 1 }),
      },
    } as any);
    prisma.$transaction.mockImplementation(async (callback: any) => {
      expect(RequestContextService.getContext()).toMatchObject({
        store_id: 2,
        organization_id: 1,
        is_super_admin: false,
        is_owner: false,
      });
      expect(RequestContextService.getContext()?.user_id).toBeUndefined();
      return callback(tx);
    });
    await RequestContextService.runIsolated(
      {
        store_id: 99,
        organization_id: 99,
        user_id: 88,
        is_super_admin: false,
        is_owner: false,
      },
      () => service.getByToken('signed'),
    );
    expect(prisma.orders.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 4, store_id: 2 } }),
    );
  });
  it('invalid and expired tokens fail before a transaction or new request', async () => {
    links.resolveToken.mockRejectedValue(new Error('invalid'));
    await expect(service.getByToken('bad')).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
  it('never presents pending DIAN as completed and delegates normalized capture/hash', async () => {
    const result = await service.submitData('signed', capture);
    expect(result).toMatchObject({
      status: 'processing',
      phase: 'waiting_credit_note_dian',
      operation_id: 9,
    });
    expect(motor.startPublic).toHaveBeenCalledWith(
      7,
      2,
      expect.objectContaining({ email: 'ana@example.test' }),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
  });
  it('rejects invalid DV, sentinel CF and missing municipality before motor', async () => {
    for (const data of [
      { ...capture, document_number: '222222222222' },
      {
        ...capture,
        address: { ...capture.address, municipality_code: '99999' },
      },
      {
        ...capture,
        person_type: 'JURIDICA',
        document_type: 'NIT',
        document_number: '900123456',
        verification_digit: '0',
        legal_name: 'Empresa SAS',
      },
    ])
      await expect(service.submitData('signed', data as any)).rejects.toThrow();
    expect(motor.startPublic).not.toHaveBeenCalled();
    expect(tx.invoice_data_requests.create).not.toHaveBeenCalled();
  });
  it('existing saga status survives unlink and never materializes another demand', async () => {
    tx.invoice_holder_changes.findFirst.mockResolvedValue({
      id: 9,
      phase: 'completed',
      run_status: 'completed',
      new_invoice_id: 88,
    });
    const result = await service.getByToken('signed');
    expect(result).toMatchObject({ status: 'completed', new_invoice_id: 88 });
    expect(tx.invoice_data_requests.create).not.toHaveBeenCalled();
  });
  it('admin process resumes the existing durable operation, not a second converter', async () => {
    prisma.invoice_data_requests.findFirst.mockResolvedValue({ id: 7 });
    prisma.invoice_holder_changes.findFirst.mockResolvedValue({ id: 9 });
    await service.processRequest(7, 2);
    expect(motor.resume).toHaveBeenCalledWith(9);
  });
  it('submitted legacy delegates proof-based adoption to the single motor', async () => {
    prisma.invoice_data_requests.findFirst.mockResolvedValue({
      id: 7,
      status: 'submitted',
    });
    prisma.invoice_holder_changes.findFirst.mockResolvedValue(null);
    await service.processRequest(7, 2);
    expect(motor.adoptLegacySubmittedRequest).toHaveBeenCalledWith(7);
  });
  it('legacy demand without a recoverable saga requires review rather than best-effort success', async () => {
    prisma.invoice_data_requests.findFirst.mockResolvedValue({ id: 7 });
    prisma.invoice_holder_changes.findFirst.mockResolvedValue(null);
    await expect(service.processRequest(7, 2)).rejects.toMatchObject({
      errorCode: 'CF_HOLDER_LEGACY_REVIEW_REQUIRED',
    });
  });
  it('default inbox omits unrequested legacy pending and keeps summary in the same universe', async () => {
    await service.findByStore(2);
    await service.summaryByStore(2);
    expect(
      prisma.invoice_data_requests.findMany.mock.calls[0][0].where,
    ).toEqual(prisma.invoice_data_requests.groupBy.mock.calls[0][0].where);
    expect(
      JSON.stringify(
        prisma.invoice_data_requests.groupBy.mock.calls[0][0].where,
      ),
    ).toContain('submitted_at');
  });
});

describe('InvoiceDataRequestsService (paso 3: summary guest)', () => {
  const service = new InvoiceDataRequestsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const kitchenStatusFor = (rows: { id: number; status: string }[] | null) =>
    (service as any).kitchenStatusFor(rows);

  it('prefiere la fila in-flight sobre la terminal más reciente', () => {
    // order 448 / item 915 en dev: pending (id 31) + delivered (id 79),
    // el backend entrega desc por id → [delivered, pending].
    expect(
      kitchenStatusFor([
        { id: 79, status: 'delivered' },
        { id: 31, status: 'pending' },
      ]),
    ).toBe('pending');
  });

  it('sin filas in-flight devuelve la más reciente (desc por id)', () => {
    expect(
      kitchenStatusFor([
        { id: 78, status: 'cancelled' },
        { id: 55, status: 'cancelled' },
      ]),
    ).toBe('cancelled');
    expect(
      kitchenStatusFor([
        { id: 82, status: 'delivered' },
        { id: 80, status: 'cancelled' },
      ]),
    ).toBe('delivered');
  });

  it('sin filas (nunca disparado) devuelve null', () => {
    expect(kitchenStatusFor([])).toBeNull();
    expect(kitchenStatusFor(null)).toBeNull();
  });
});
