import { ContractsService, ContractStatus } from './contracts.service';
import { VendixHttpException } from 'src/common/errors';

/**
 * C.2 (FB-07, ERR-06) — lectura y transiciones sin base de datos: el
 * delegate `contracts` se mockea y se verifican envoltorio, 404
 * accionable y matriz de estados.
 */
describe('ContractsService lectura y transiciones (C.2)', () => {
  const contractsMock = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    update: jest.fn(),
  };
  const service = new ContractsService(
    { contracts: contractsMock } as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('findAll devuelve el envoltorio { data, pagination } del frontend', async () => {
    contractsMock.findMany.mockResolvedValue([{ id: 1 }]);
    contractsMock.count.mockResolvedValue(25);

    const result = await service.findAll({ page: 2, limit: 10 });

    expect(result).toEqual({
      data: [{ id: 1 }],
      pagination: { total: 25, page: 2, limit: 10, totalPages: 3 },
    });
    expect(contractsMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 10 }),
    );
  });

  it('findAll filtra por search (numero/notas) y status', async () => {
    contractsMock.findMany.mockResolvedValue([]);
    contractsMock.count.mockResolvedValue(0);

    await service.findAll({ search: 'CT-2026', status: 'active' });

    expect(contractsMock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            {
              contract_number: { contains: 'CT-2026', mode: 'insensitive' },
            },
            { notes: { contains: 'CT-2026', mode: 'insensitive' } },
          ],
          status: 'active',
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

  it.each([
    ['draft', 'active'],
    ['draft', 'cancelled'],
    ['active', 'invoiced'],
    ['active', 'cancelled'],
  ])('permite %s -> %s', async (from, to) => {
    contractsMock.findFirst.mockResolvedValue({ id: 5, status: from });
    contractsMock.update.mockResolvedValue({ id: 5, status: to });

    const result = await service.updateStatus(
      5,
      to as ContractStatus,
    );

    expect(result).toEqual({ id: 5, status: to });
    expect(contractsMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 5 },
        data: expect.objectContaining({ status: to }),
      }),
    );
  });

  it.each([
    ['draft', 'invoiced'],
    ['draft', 'draft'],
    ['active', 'draft'],
    ['active', 'active'],
    ['invoiced', 'cancelled'],
    ['invoiced', 'active'],
    ['cancelled', 'active'],
    ['cancelled', 'cancelled'],
  ])('rechaza %s -> %s con 422 CONTRACT_STATUS_001', async (from, to) => {
    contractsMock.findFirst.mockResolvedValue({ id: 5, status: from });

    const error = await service
      .updateStatus(5, to as ContractStatus)
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(422);
    expect(error.errorCode).toBe('CONTRACT_STATUS_001');
    expect(contractsMock.update).not.toHaveBeenCalled();
  });

  it('sobre contrato ajeno el PATCH responde 404 antes que 422', async () => {
    contractsMock.findFirst.mockResolvedValue(null);

    const error = await service
      .updateStatus(999, 'active')
      .catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(404);
    expect(contractsMock.update).not.toHaveBeenCalled();
  });
});
