import { StaffProvisioningService } from './staff-provisioning.service';
import { ErrorCodes } from '../errors';

describe('StaffProvisioningService email uniqueness', () => {
  const findMany = jest.fn();
  const withoutScope = jest.fn(() => ({ users: { findMany } }));
  const service = new StaffProvisioningService(
    { withoutScope } as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => jest.clearAllMocks());

  it('detects legacy uppercase staff and excludes the account being edited', async () => {
    findMany.mockResolvedValue([{ id: 42 }]);

    await expect(
      service.assertEmailAvailableForStaff(' Staff@Example.COM ', {
        excludeUserId: 7,
      }),
    ).rejects.toMatchObject({
      errorCode: ErrorCodes.ORG_USER_002.code,
    });
    expect(findMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'staff@example.com', mode: 'insensitive' },
        id: { not: 7 },
        user_roles: { some: { roles: { name: { not: 'customer' } } } },
      },
      select: { id: true },
    });
  });

  it('uses the supplied transaction and does not forbid customer-only accounts', async () => {
    const tx = { users: { findMany: jest.fn().mockResolvedValue([]) } };
    await expect(
      service.assertEmailAvailableForStaff(' Client@Example.COM ', {
        client: tx as any,
      }),
    ).resolves.toBeUndefined();
    expect(withoutScope).not.toHaveBeenCalled();
    expect(tx.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: { equals: 'client@example.com', mode: 'insensitive' },
          user_roles: { some: { roles: { name: { not: 'customer' } } } },
        }),
      }),
    );
  });
});
