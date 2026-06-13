import { WithholdingTaxService } from './withholding-tax.service';

/**
 * Unit tests for the calculations audit list (`findAllCalculations`).
 * The scoped Prisma client is mocked — tenant scoping itself is owned by
 * StorePrismaService and is out of scope here. These tests pin down the
 * where-clause building (role / counterparty / year vs month-range filters)
 * and the pagination contract returned to the controller.
 */
describe('WithholdingTaxService.findAllCalculations', () => {
  const findMany = jest.fn();
  const count = jest.fn();

  const mock_prisma = {
    withholding_calculations: { findMany, count },
  };

  // Only `prisma` is exercised by findAllCalculations; other deps are unused.
  const service = new WithholdingTaxService(
    mock_prisma as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
  );

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([{ id: 1 }]);
    count.mockReset().mockResolvedValue(1);
  });

  it('returns paginated envelope inputs with defaults (page=1, limit=20)', async () => {
    const result = await service.findAllCalculations({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        orderBy: { created_at: 'desc' },
        skip: 0,
        take: 20,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where: {} });
    expect(result).toEqual({ data: [{ id: 1 }], total: 1, page: 1, limit: 20 });
  });

  it('applies role, supplier and concept filters', async () => {
    await service.findAllCalculations({
      role: 'practiced',
      supplier_id: 7,
      concept_id: 3,
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'practiced', supplier_id: 7, concept_id: 3 },
      }),
    );
  });

  it('filters by year column when only year is provided', async () => {
    await service.findAllCalculations({ year: 2025 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { year: 2025 } }),
    );
  });

  it('filters by created_at month range when year + month are provided', async () => {
    await service.findAllCalculations({ year: 2025, month: 3 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          created_at: {
            gte: new Date(2025, 2, 1),
            lt: new Date(2025, 3, 1),
          },
        },
      }),
    );
  });

  it('computes skip/take from page and limit', async () => {
    await service.findAllCalculations({ page: 3, limit: 10 });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('includes concept, supplier, customer and invoice relations', async () => {
    await service.findAllCalculations({});

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          concept: expect.anything(),
          supplier: expect.anything(),
          customer: expect.anything(),
          invoice: expect.anything(),
        }),
      }),
    );
  });
});
