import { ContractsService, ContractStatus } from './contracts.service';
import { VendixHttpException } from 'src/common/errors';
import { RequestContextService } from '@common/context/request-context.service';

describe('ContractsService lectura y transiciones (C.2/P1.4)', () => {
  const contractsMock = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    updateMany: jest.fn(),
  };
  const invoicesMock = { findFirst: jest.fn() };
  const tx = {
    $queryRaw: jest.fn(),
    contracts: contractsMock,
    invoices: invoicesMock,
  };
  const prisma = {
    contracts: contractsMock,
    withoutScope: jest.fn(() => ({
      $transaction: jest.fn((callback: (transaction: typeof tx) => unknown) =>
        callback(tx),
      ),
    })),
  };
  const service = new ContractsService(prisma as any);
  const context = { store_id: 12, organization_id: 34, user_id: 5 };
  const activeContract = (overrides: Record<string, unknown> = {}) => ({
    id: 5,
    status: 'active',
    updated_at: new Date('2026-10-10T10:00:00.000Z'),
    invoices: [],
    ...overrides,
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue(context as any);
    contractsMock.updateMany.mockResolvedValue({ count: 1 });
    invoicesMock.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([]);
  });

  it('findAll devuelve el envoltorio { data, pagination } del frontend', async () => {
    contractsMock.findMany.mockResolvedValue([{ id: 1, status: 'draft', invoices: [] }]);
    contractsMock.count.mockResolvedValue(25);

    const result = await service.findAll({ page: 2, limit: 10 });

    expect(result).toEqual({
      data: [{ id: 1, administrative_status: 'draft', status: 'draft', invoice: null }],
      pagination: { total: 25, page: 2, limit: 10, totalPages: 3 },
    });
    expect(contractsMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('findAll filtra search y estado efectivo activo incluyendo históricos incoherentes', async () => {
    contractsMock.findMany.mockResolvedValue([]);
    contractsMock.count.mockResolvedValue(0);

    await service.findAll({ search: 'CT-2026', status: 'active' });

    expect(contractsMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { contract_number: { contains: 'CT-2026', mode: 'insensitive' } },
                { notes: { contains: 'CT-2026', mode: 'insensitive' } },
              ],
            },
            {
              status: { in: ['active', 'invoiced'] },
              NOT: {
                invoices: {
                  some: {
                    store_id: 12,
                    organization_id: 34,
                    status: 'accepted',
                    accepted_at: { not: null },
                    cufe: { not: '' },
                  },
                },
              },
            },
          ],
        },
      }),
    );
  });

  it('findAll status invoiced exige factura aceptada con evidencia fiscal', async () => {
    contractsMock.findMany.mockResolvedValue([]);
    contractsMock.count.mockResolvedValue(0);

    await service.findAll({ status: 'invoiced' });

    expect(contractsMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          invoices: {
            some: {
              store_id: 12,
              organization_id: 34,
              status: 'accepted',
              accepted_at: { not: null },
              cufe: { not: '' },
            },
          },
        },
      }),
    );
  });

  it('findOne ajeno responde 404 accionable con el id', async () => {
    contractsMock.findFirst.mockResolvedValue(null);

    const error = await service.findOne(999).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(404);
    expect(error.errorCode).toBe('SYS_NOT_FOUND_001');
    expect(JSON.stringify(error.getResponse())).toContain('999');
  });

  it('expone factura mínima con scope explícito y deriva `invoiced` de evidencia fiscal', async () => {
    contractsMock.findFirst.mockResolvedValue({
      id: 8,
      status: 'invoiced',
      invoices: [
        {
          id: 91,
          invoice_number: 'FV-91',
          status: 'accepted',
          total_amount: '123.00',
          dian_status: 'accepted',
          accepted_at: new Date('2026-10-10T10:00:00.000Z'),
          cufe: 'f'.repeat(96),
        },
      ],
    });

    const contract = await service.findOne(8);

    expect(contract).toEqual({
      id: 8,
      administrative_status: 'invoiced',
      status: 'invoiced',
      invoice: {
        id: 91,
        invoice_number: 'FV-91',
        status: 'accepted',
        total_amount: '123.00',
        dian_status: 'accepted',
      },
    });
    const include = contractsMock.findFirst.mock.calls[0][0].include;
    expect(include.invoices).toMatchObject({
      where: {
        store_id: 12,
        organization_id: 34,
        status: { notIn: ['cancelled', 'voided'] },
      },
      take: 1,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        invoice_number: true,
        status: true,
        total_amount: true,
        dian_status: true,
        accepted_at: true,
        cufe: true,
      },
    });
  });

  it.each(['draft', 'validated', 'sent', 'rejected', 'accepted'])(
    'historical raw invoiced with a %s invoice is exposed as active, never rewritten',
    async (invoiceStatus) => {
      contractsMock.findFirst.mockResolvedValue({
        id: 8,
        status: 'invoiced',
        invoices: [
          {
            id: 91,
            invoice_number: 'FV-91',
            status: invoiceStatus,
            total_amount: '123.00',
            dian_status: invoiceStatus,
            accepted_at: invoiceStatus === 'accepted' ? null : null,
            cufe: null,
          },
        ],
      });

      const result = await service.findOne(8);

      expect(result.status).toBe('active');
      expect(result.administrative_status).toBe('invoiced');
      expect(contractsMock.updateMany).not.toHaveBeenCalled();
    },
  );

  it('historical raw invoiced without invoice is exposed as active', async () => {
    contractsMock.findFirst.mockResolvedValue({ id: 8, status: 'invoiced', invoices: [] });
    const result = await service.findOne(8);
    expect(result).toMatchObject({ status: 'active', administrative_status: 'invoiced' });
  });

  it.each([
    ['draft', 'active'],
    ['draft', 'cancelled'],
    ['active', 'cancelled'],
  ])('permite %s -> %s bajo lock y CAS scoped', async (from, to) => {
    contractsMock.findFirst
      .mockResolvedValueOnce(activeContract({ status: from }))
      .mockResolvedValueOnce(activeContract({ status: to }));

    const result = await service.updateStatus(5, to as ContractStatus);

    expect(result).toMatchObject({ status: to, administrative_status: to, invoice: null });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(contractsMock.updateMany).toHaveBeenCalledWith({
      where: {
        id: 5,
        store_id: 12,
        organization_id: 34,
        status: from,
        updated_at: new Date('2026-10-10T10:00:00.000Z'),
      },
      data: expect.objectContaining({ status: to, updated_at: expect.any(Date) }),
    });
  });

  it('rechaza la transición manual active -> invoiced aunque el DTO la reciba', async () => {
    contractsMock.findFirst.mockResolvedValueOnce(activeContract());

    const error = await service.updateStatus(5, 'invoiced').catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('CONTRACT_STATUS_001');
    expect(contractsMock.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['draft', 'invoiced'],
    ['draft', 'draft'],
    ['active', 'draft'],
    ['active', 'active'],
    ['invoiced', 'active'],
    ['cancelled', 'active'],
    ['cancelled', 'cancelled'],
  ])('rechaza %s -> %s con 422 CONTRACT_STATUS_001', async (from, to) => {
    contractsMock.findFirst.mockResolvedValueOnce(activeContract({ status: from }));

    const error = await service.updateStatus(5, to as ContractStatus).catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.errorCode).toBe('CONTRACT_STATUS_001');
    expect(contractsMock.updateMany).not.toHaveBeenCalled();
  });

  it('bloquea cancelación si existe una factura draft activa con acción correctiva', async () => {
    contractsMock.findFirst.mockResolvedValueOnce(activeContract());
    invoicesMock.findFirst.mockResolvedValue({
      id: 91,
      invoice_number: 'FV-91',
      status: 'draft',
    });

    const error = await service.updateStatus(5, 'cancelled').catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.errorCode).toBe('CONTRACT_INVOICE_001');
    expect(error.getResponse()).toEqual(
      expect.objectContaining({
        details: expect.objectContaining({
          invoice_id: 91,
          required_action: 'resolve_invoice_first',
        }),
      }),
    );
    expect(contractsMock.updateMany).not.toHaveBeenCalled();
  });

  it.each(['validated', 'sent', 'rejected'])(
    'también bloquea cancelación ante factura %s no resuelta',
    async (invoiceStatus) => {
      contractsMock.findFirst.mockResolvedValueOnce(activeContract());
      invoicesMock.findFirst.mockResolvedValue({
        id: 93,
        invoice_number: 'FV-93',
        status: invoiceStatus,
      });

      const error = await service.updateStatus(5, 'cancelled').catch((e) => e);

      expect(error.errorCode).toBe('CONTRACT_INVOICE_001');
      expect(error.getResponse().details.required_action).toBe(
        'resolve_invoice_first',
      );
      expect(contractsMock.updateMany).not.toHaveBeenCalled();
    },
  );

  it('bloquea cancelación de factura aceptada con política pendiente de nota crédito', async () => {
    contractsMock.findFirst.mockResolvedValueOnce(activeContract());
    invoicesMock.findFirst.mockResolvedValue({
      id: 92,
      invoice_number: 'FV-92',
      status: 'accepted',
    });

    const error = await service.updateStatus(5, 'cancelled').catch((e) => e);

    expect(error.errorCode).toBe('CONTRACT_INVOICE_001');
    expect(error.getResponse().details.required_action).toBe('credit_note_policy_pending');
    expect(contractsMock.updateMany).not.toHaveBeenCalled();
  });

  it('contrato ajeno devuelve 404 antes de transicionar y el raw lock es tenant-safe', async () => {
    contractsMock.findFirst.mockResolvedValueOnce(null);

    const error = await service.updateStatus(999, 'active').catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(404);
    expect(contractsMock.updateMany).not.toHaveBeenCalled();
    const [sql, id, storeId, organizationId] = tx.$queryRaw.mock.calls[0];
    expect(String(sql)).toContain('FOR UPDATE');
    expect([id, storeId, organizationId]).toEqual([999, 12, 34]);
  });
});
