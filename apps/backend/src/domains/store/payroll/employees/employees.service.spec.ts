import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException } from '../../../../common/errors';
import { EmployeesService } from './employees.service';

describe('EmployeesService createOrAssociate fiscal scope gate', () => {
  const baseDto = {
    first_name: 'Ada',
    last_name: 'Lovelace',
    document_type: 'CC',
    document_number: '1010101',
    hire_date: '2026-01-15',
    contract_type: 'indefinite' as const,
    base_salary: 1500000,
    payment_frequency: 'monthly' as const,
  };

  const buildPrismaMocks = ({
    existing,
    existingRelation,
    fiscalScope,
  }: {
    existing: any;
    existingRelation: any;
    fiscalScope: 'STORE' | 'ORGANIZATION';
  }) => {
    const tx = {
      employees: {
        create: jest.fn().mockResolvedValue({ id: 999 }),
        findFirst: jest.fn().mockResolvedValue({ id: 999 }),
      },
      employee_stores: {
        create: jest.fn().mockResolvedValue({}),
      },
    };

    const unscoped: any = {
      employees: {
        findFirst: jest.fn().mockResolvedValue(existing),
      },
      employee_stores: {
        findFirst: jest
          .fn()
          .mockImplementation(({ where }: any) => {
            if (where?.store_id) return existingRelation;
            if (where?.is_primary)
              return {
                id: 1,
                store_id: 5,
                is_primary: true,
                store: { name: 'Tienda Primaria' },
              };
            return null;
          }),
        count: jest.fn().mockResolvedValue(1),
      },
      organizations: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ fiscal_scope: fiscalScope }),
      },
    };

    const prisma: any = {
      withoutScope: () => unscoped,
      $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
      employees: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    return { prisma, unscoped, tx };
  };

  const withContext = async <T>(fn: () => Promise<T>): Promise<T> => {
    return RequestContextService.run(
      { organization_id: 1, store_id: 2 } as any,
      fn,
    );
  };

  it('blocks cross-store association under fiscal_scope=STORE', async () => {
    const existing = {
      id: 500,
      first_name: 'Ada',
      last_name: 'Lovelace',
      document_number: '1010101',
    };
    const { prisma } = buildPrismaMocks({
      existing,
      existingRelation: null,
      fiscalScope: 'STORE',
    });
    const service = new EmployeesService(prisma);

    await withContext(async () => {
      await expect(service.createOrAssociate(baseDto as any)).rejects.toThrow(
        VendixHttpException,
      );
      await expect(
        service.createOrAssociate(baseDto as any),
      ).rejects.toMatchObject({
        errorCode: 'PAYROLL_CROSS_STORE_FISCAL_001',
      });
    });
  });

  it('requires explicit flag under fiscal_scope=ORGANIZATION', async () => {
    const existing = {
      id: 500,
      first_name: 'Ada',
      last_name: 'Lovelace',
      document_number: '1010101',
    };
    const { prisma } = buildPrismaMocks({
      existing,
      existingRelation: null,
      fiscalScope: 'ORGANIZATION',
    });
    const service = new EmployeesService(prisma);

    await withContext(async () => {
      await expect(
        service.createOrAssociate(baseDto as any),
      ).rejects.toMatchObject({
        errorCode: 'PAYROLL_ASSOCIATE_CONFIRM_001',
      });
    });
  });

  it('associates with explicit flag under fiscal_scope=ORGANIZATION', async () => {
    const existing = {
      id: 500,
      first_name: 'Ada',
      last_name: 'Lovelace',
      document_number: '1010101',
    };
    const { prisma, tx } = buildPrismaMocks({
      existing,
      existingRelation: null,
      fiscalScope: 'ORGANIZATION',
    });
    const service = new EmployeesService(prisma);

    await withContext(async () => {
      const result = await service.createOrAssociate({
        ...baseDto,
        associate_if_exists: true,
      } as any);

      expect(result.action).toBe('associated');
      expect(tx.employee_stores.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            employee_id: existing.id,
            store_id: 2,
          }),
        }),
      );
    });
  });

  it('updates when employee already linked to the current store', async () => {
    const existing = {
      id: 500,
      first_name: 'Ada',
      last_name: 'Lovelace',
      document_number: '1010101',
    };
    const existingRelation = { id: 77, employee_id: 500, store_id: 2 };
    const { prisma } = buildPrismaMocks({
      existing,
      existingRelation,
      fiscalScope: 'STORE',
    });
    prisma.employees.update = jest.fn().mockResolvedValue({ id: 500 });
    const service = new EmployeesService(prisma);

    await withContext(async () => {
      const result = await service.createOrAssociate(baseDto as any);
      expect(result.action).toBe('updated');
    });
  });
});
