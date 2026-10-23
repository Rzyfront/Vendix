import { ExpensesService } from './expenses.service';
import { RequestContextService } from '@common/context/request-context.service';

describe('ExpensesService date-only range (QUI-552)', () => {
  let service: ExpensesService;
  let prisma: any;

  const START = new Date('2026-08-01T00:00:00.000Z');
  const END = new Date('2026-08-03T23:59:59.999Z');

  beforeEach(() => {
    prisma = {
      store_settings: {
        findFirst: jest.fn().mockResolvedValue({
          settings: { general: { timezone: 'America/Bogota' } },
          stores: { timezone: 'America/Bogota' },
        }),
      },
      expenses: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { amount: 0 }, _count: { id: 0 } }),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      expense_categories: { findMany: jest.fn().mockResolvedValue([]) },
    };
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 12,
      store_id: 1,
      is_super_admin: false,
      is_owner: false,
    } as any);
    service = new ExpensesService(prisma);
  });

  afterEach(() => jest.restoreAllMocks());

  const findAllWhere = () => prisma.expenses.findMany.mock.calls[0][0].where;

  describe('findAll', () => {
    it('includes the whole last day when both bounds are given', async () => {
      await service.findAll({
        date_from: '2026-08-01',
        date_to: '2026-08-03',
      } as any);
      expect(findAllWhere().expense_date).toEqual({ gte: START, lte: END });
    });

    it('applies only lte (end of day) with just date_to', async () => {
      await service.findAll({ date_to: '2026-08-03' } as any);
      expect(findAllWhere().expense_date).toEqual({ lte: END });
    });

    it('applies only gte (start of day) with just date_from', async () => {
      await service.findAll({ date_from: '2026-08-01' } as any);
      expect(findAllWhere().expense_date).toEqual({ gte: START });
    });

    it('does not filter by date without bounds', async () => {
      await service.findAll({} as any);
      expect(findAllWhere()).not.toHaveProperty('expense_date');
    });
  });

  describe('getExpensesSummary', () => {
    it('applies the filter with a single bound on aggregate and both groupBy', async () => {
      await service.getExpensesSummary(undefined, '2026-08-03');
      expect(
        prisma.expenses.aggregate.mock.calls[0][0].where.expense_date,
      ).toEqual({ lte: END });
      for (const call of prisma.expenses.groupBy.mock.calls) {
        expect(call[0].where.expense_date).toEqual({ lte: END });
      }
    });

    it('applies both bounds inclusively', async () => {
      await service.getExpensesSummary('2026-08-01', '2026-08-03');
      expect(
        prisma.expenses.aggregate.mock.calls[0][0].where.expense_date,
      ).toEqual({
        gte: START,
        lte: END,
      });
    });

    it('does not filter by date without bounds', async () => {
      await service.getExpensesSummary();
      expect(
        prisma.expenses.aggregate.mock.calls[0][0].where,
      ).not.toHaveProperty('expense_date');
      expect(prisma.expenses.groupBy.mock.calls[0][0].where).not.toHaveProperty(
        'expense_date',
      );
    });
  });
});
