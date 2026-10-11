import { ContractsService } from './contracts.service';
import { RequestContextService } from '@common/context/request-context.service';
import { contractNumberPrefix } from './contracts-snapshot';

describe('ContractsService.createFromQuotation (P0.3)', () => {
  const context = { store_id: 12, organization_id: 34, user_id: 56 };
  let service: ContractsService;
  let tx: any;
  let quotation: any;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(context as any);
    quotation = {
      id: 7,
      destination: 'contract',
      status: 'accepted',
      customer_id: 3,
      subtotal_amount: '100',
      discount_amount: '0',
      tax_amount: '0',
      grand_total: '100',
      quotation_items: [],
    };
    tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      quotations: {
        findFirst: jest.fn().mockResolvedValue(quotation),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      contracts: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 99, invoices: [] }),
      },
    };
    const prisma: any = {
      quotations: { findFirst: jest.fn().mockResolvedValue(quotation) },
      contracts: { findFirst: jest.fn().mockResolvedValue(null) },
      withoutScope: () => ({ $transaction: (callback: any) => callback(tx) }),
    };
    service = new ContractsService(prisma, { resolveForQuotation: jest.fn() } as any);
  });

  it('serializa por tienda, relee y transicióna accepted dentro del tx con tenant explícito', async () => {
    const result = await service.createFromQuotation(7);

    expect(tx.$executeRaw).toHaveBeenCalled();
    const [template, storeId, lockNamespace] = tx.$executeRaw.mock.calls[0];
    expect(String(template)).toContain('pg_advisory_xact_lock');
    expect(storeId).toBe(12);
    expect(lockNamespace).toMatch(/^contracts:number:CT-/);
    expect(tx.quotations.findFirst).toHaveBeenCalledWith({
      where: {
        id: 7,
        store_id: 12,
        store: { is: { organization_id: 34 } },
      },
      include: { quotation_items: true },
    });
    expect(tx.quotations.updateMany).toHaveBeenCalledWith({
      where: {
        id: 7,
        store_id: 12,
        store: { is: { organization_id: 34 } },
        destination: 'contract',
        status: 'accepted',
      },
      data: expect.objectContaining({ status: 'contracted' }),
    });
    expect(tx.contracts.create).toHaveBeenCalled();
    expect(result).toEqual({ id: 99, invoice: null });
  });

  it('si una cancelación ganó la carrera, no actualiza ni crea contrato', async () => {
    tx.quotations.findFirst.mockResolvedValue({ ...quotation, status: 'cancelled' });

    await expect(service.createFromQuotation(7)).rejects.toMatchObject({
      errorCode: 'QUOTE_CONVERT_STATUS_001',
    });
    expect(tx.quotations.updateMany).not.toHaveBeenCalled();
    expect(tx.contracts.create).not.toHaveBeenCalled();
  });

  it('si falla el CAS aunque la rerelectura fue accepted, no inserta contrato', async () => {
    tx.quotations.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.createFromQuotation(7)).rejects.toMatchObject({
      errorCode: 'QUOTE_CONVERT_STATUS_001',
    });
    expect(tx.contracts.create).not.toHaveBeenCalled();
  });

  it('asigna el consecutivo siguiente bajo el lock cuando ya existe el 0001', async () => {
    const prefix = contractNumberPrefix();
    tx.contracts.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ contract_number: `${prefix}0001` });

    await service.createFromQuotation(7);

    expect(tx.contracts.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ contract_number: `${prefix}0002` }),
      }),
    );
  });

  it('serializa reintentos y devuelve 409 con el contrato ganador del tenant', async () => {
    tx.contracts.findFirst.mockResolvedValue(null);
    tx.quotations.updateMany.mockResolvedValue({ count: 1 });
    tx.contracts.create.mockRejectedValue({ code: 'P2002' });
    const prisma = (service as any).prisma;
    prisma.contracts.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 91 });

    const error = await service.createFromQuotation(7).catch((value) => value);

    expect(error.getStatus()).toBe(409);
    expect(error.errorCode).toBe('QUOTE_CONTRACT_001');
    expect(JSON.stringify(error.getResponse())).toContain('91');
    expect(prisma.contracts.findFirst).toHaveBeenLastCalledWith({
      where: { quotation_id: 7, store_id: 12, organization_id: 34 },
      select: { id: true },
    });
  });

  it('no revela un ganador P2002 que no se puede encontrar en el tenant propio', async () => {
    tx.contracts.create.mockRejectedValue({ code: 'P2002' });
    const prisma = (service as any).prisma;
    prisma.contracts.findFirst.mockResolvedValue(null);

    const error = await service.createFromQuotation(7).catch((value) => value);

    expect(error).toEqual({ code: 'P2002' });
    expect(error.errorCode).not.toBe('QUOTE_CONTRACT_001');
    expect(prisma.contracts.findFirst).toHaveBeenLastCalledWith({
      where: { quotation_id: 7, store_id: 12, organization_id: 34 },
      select: { id: true },
    });
  });
});
