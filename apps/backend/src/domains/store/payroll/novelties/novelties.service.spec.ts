import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors';
import { NoveltiesService } from './novelties.service';

describe('NoveltiesService', () => {
  const buildPrisma = (overrides: Record<string, any> = {}) => {
    const prisma: any = {
      employees: {
        findFirst: jest.fn().mockResolvedValue({ id: 700, status: 'active' }),
      },
      payroll_novelties: {
        create: jest.fn().mockImplementation(({ data }: any) =>
          Promise.resolve({ id: 1, status: 'pending', ...data }),
        ),
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockImplementation(({ where, data }: any) =>
          Promise.resolve({ id: where.id, ...data }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({ id: 1 }),
      },
      ...overrides,
    };
    return prisma;
  };

  const withContext = <T>(fn: () => Promise<T>): Promise<T> =>
    RequestContextService.run(
      { organization_id: 1, store_id: 2, user_id: 9 } as any,
      fn,
    );

  // ─── create ───

  it('creates a pending novelty with org/store/user from the request context', async () => {
    const prisma = buildPrisma();
    const service = new NoveltiesService(prisma);

    const result = await withContext(() =>
      service.create({
        employee_id: 700,
        novelty_type: 'overtime_nocturna',
        date_start: '2026-06-05',
        hours: 10,
      } as any),
    );

    expect(prisma.payroll_novelties.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organization_id: 1,
          store_id: 2,
          employee_id: 700,
          novelty_type: 'overtime_nocturna',
          status: 'pending',
          created_by_user_id: 9,
        }),
      }),
    );
    expect(result.status).toBe('pending');
  });

  it('rejects creation for a missing/inactive employee', async () => {
    const prisma = buildPrisma({
      employees: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = new NoveltiesService(prisma);

    await expect(
      withContext(() =>
        service.create({
          employee_id: 999,
          novelty_type: 'bonus',
          date_start: '2026-06-05',
          amount: 100,
        } as any),
      ),
    ).rejects.toThrow(VendixHttpException);
  });

  it('rejects an hourly novelty without hours', async () => {
    const prisma = buildPrisma();
    const service = new NoveltiesService(prisma);

    await expect(
      withContext(() =>
        service.create({
          employee_id: 700,
          novelty_type: 'overtime_diurna',
          date_start: '2026-06-05',
        } as any),
      ),
    ).rejects.toThrow(VendixHttpException);
    expect(prisma.payroll_novelties.create).not.toHaveBeenCalled();
  });

  it('rejects a day-based novelty without days and an amount novelty without amount', async () => {
    const prisma = buildPrisma();
    const service = new NoveltiesService(prisma);

    await expect(
      withContext(() =>
        service.create({
          employee_id: 700,
          novelty_type: 'vacation',
          date_start: '2026-06-05',
        } as any),
      ),
    ).rejects.toThrow(VendixHttpException);

    await expect(
      withContext(() =>
        service.create({
          employee_id: 700,
          novelty_type: 'other_deduction',
          date_start: '2026-06-05',
        } as any),
      ),
    ).rejects.toThrow(VendixHttpException);
  });

  // ─── update / remove status guards ───

  it('updates a pending novelty', async () => {
    const prisma = buildPrisma();
    prisma.payroll_novelties.findFirst.mockResolvedValue({
      id: 1,
      status: 'pending',
      employee_id: 700,
      novelty_type: 'overtime_nocturna',
      hours: 10,
      days: null,
      amount: null,
    });
    const service = new NoveltiesService(prisma);

    await withContext(() => service.update(1, { hours: 12 } as any));

    expect(prisma.payroll_novelties.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1 } }),
    );
  });

  it('blocks updating a novelty that is not pending', async () => {
    const prisma = buildPrisma();
    prisma.payroll_novelties.findFirst.mockResolvedValue({
      id: 1,
      status: 'applied',
      employee_id: 700,
      novelty_type: 'bonus',
      amount: 100,
    });
    const service = new NoveltiesService(prisma);

    await expect(
      withContext(() => service.update(1, { amount: 200 } as any)),
    ).rejects.toThrow(VendixHttpException);
    expect(prisma.payroll_novelties.update).not.toHaveBeenCalled();
  });

  it('removes a pending novelty and blocks removing an applied one', async () => {
    const prisma = buildPrisma();
    prisma.payroll_novelties.findFirst.mockResolvedValueOnce({
      id: 1,
      status: 'pending',
    });
    const service = new NoveltiesService(prisma);

    await withContext(() => service.remove(1));
    expect(prisma.payroll_novelties.delete).toHaveBeenCalledWith({
      where: { id: 1 },
    });

    prisma.payroll_novelties.findFirst.mockResolvedValueOnce({
      id: 2,
      status: 'applied',
    });
    await expect(withContext(() => service.remove(2))).rejects.toThrow(
      VendixHttpException,
    );
  });

  it('throws not-found when the novelty does not exist', async () => {
    const prisma = buildPrisma();
    prisma.payroll_novelties.findFirst.mockResolvedValue(null);
    const service = new NoveltiesService(prisma);

    await expect(withContext(() => service.findOne(42))).rejects.toThrow(
      VendixHttpException,
    );
  });

  // ─── payroll integration ───

  it('findPendingForPeriod returns [] without employees and filters by period overlap', async () => {
    const prisma = buildPrisma();
    const service = new NoveltiesService(prisma);

    expect(
      await service.findPendingForPeriod(
        [],
        new Date('2026-06-01'),
        new Date('2026-06-30'),
      ),
    ).toEqual([]);
    expect(prisma.payroll_novelties.findMany).not.toHaveBeenCalled();

    await service.findPendingForPeriod(
      [700],
      new Date('2026-06-01'),
      new Date('2026-06-30'),
    );
    expect(prisma.payroll_novelties.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          employee_id: { in: [700] },
          status: 'pending',
        }),
      }),
    );
  });

  it('attachToRun marks novelties applied and releaseFromRun returns them to pending', async () => {
    const prisma = buildPrisma();
    const service = new NoveltiesService(prisma);
    const tx = {
      payroll_novelties: { updateMany: jest.fn().mockResolvedValue({}) },
    };

    await service.attachToRun(tx, [1, 2], 55);
    expect(tx.payroll_novelties.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1, 2] } },
        data: expect.objectContaining({
          status: 'applied',
          payroll_run_id: 55,
        }),
      }),
    );

    await service.attachToRun(tx, [], 55);
    expect(tx.payroll_novelties.updateMany).toHaveBeenCalledTimes(1);

    await service.releaseFromRun(55);
    expect(prisma.payroll_novelties.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { payroll_run_id: 55, status: 'applied' },
        data: expect.objectContaining({
          status: 'pending',
          payroll_run_id: null,
        }),
      }),
    );

    // With an explicit tx it must use the tx client, not the scoped prisma
    await service.releaseFromRun(55, tx);
    expect(tx.payroll_novelties.updateMany).toHaveBeenCalledTimes(2);
  });
});
