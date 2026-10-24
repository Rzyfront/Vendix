import { RequestContextService } from '../../../../common/context/request-context.service';
import { EmployeesService } from './employees.service';

describe('EmployeesService linked-user email persistence', () => {
  it('stores linked-user email in lowercase on employee creation', async () => {
    const tx = {
      employees: {
        create: jest.fn().mockResolvedValue({ id: 9 }),
        findFirst: jest.fn().mockResolvedValue({ id: 9 }),
      },
      employee_stores: { create: jest.fn().mockResolvedValue({}) },
      users: { update: jest.fn().mockResolvedValue({ id: 10 }) },
    };
    const unscoped = {
      employees: { findFirst: jest.fn().mockResolvedValue(null) },
      users: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      withoutScope: () => unscoped,
      employees: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest
        .fn()
        .mockImplementation(async (callback) => callback(tx)),
    };
    const service = new EmployeesService(prisma as never);

    await RequestContextService.run(
      { organization_id: 3, store_id: 2 } as never,
      () =>
        service.createOrAssociate({
          user_id: 10,
          employee_code: 'EMP-9',
          first_name: 'Ana',
          last_name: 'Diaz',
          document_type: 'CC',
          document_number: '123',
          hire_date: '2026-01-01',
          contract_type: 'indefinite',
          base_salary: 1500000,
          email: '  ANA@Example.COM ',
        } as never),
    );

    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { email: 'ana@example.com' },
    });
  });
});
