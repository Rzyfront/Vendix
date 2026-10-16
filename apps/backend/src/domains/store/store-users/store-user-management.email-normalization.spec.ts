import { ConflictException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreUserManagementService } from './store-user-management.service';

jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

describe('StoreUserManagementService email normalization', () => {
  const prisma = {
    users: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    store_users: { findFirst: jest.fn() },
    withoutScope: jest.fn(),
    $transaction: jest.fn(),
  };
  const staff = {
    assertEmailAvailableForStaff: jest.fn(),
    provisionStaffMembership: jest.fn(),
  };
  let service: StoreUserManagementService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.requireMock('bcryptjs').hash.mockResolvedValue('hashed');
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      organization_id: 3,
      store_id: 4,
      is_owner: true,
      is_super_admin: false,
    });
    prisma.withoutScope.mockReturnValue(prisma);
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.users.findFirst.mockResolvedValue(null);
    prisma.users.create.mockResolvedValue({ id: 7, email: 'new@example.com' });
    prisma.users.update.mockResolvedValue({
      id: 7,
      email: 'existing@example.com',
    });
    prisma.store_users.findFirst.mockResolvedValue({
      id: 10,
      user: {
        id: 7,
        email: 'Existing@Example.COM',
        user_roles: [{ roles: { name: 'employee', is_system_role: true } }],
        user_settings: { config: {} },
      },
    });
    service = new StoreUserManagementService(
      prisma as never,
      {
        generatePanelUI: jest.fn().mockResolvedValue({ panel_ui: {} }),
      } as never,
      staff as never,
      {} as never,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('normalizes creation and uses an insensitive email duplicate lookup', async () => {
    await service.create({
      first_name: 'John',
      last_name: 'Doe',
      email: ' New@Example.COM ',
      password: 'SecurePassword123!',
    });

    expect(staff.assertEmailAvailableForStaff).toHaveBeenCalledWith(
      'new@example.com',
    );
    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'new@example.com', mode: 'insensitive' } },
    });
    expect(prisma.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@example.com',
          organization_id: 3,
        }),
      }),
    );
  });

  it('normalizes casing-only edits and excludes the same staff user from collisions', async () => {
    await service.update(7, { email: ' EXISTING@example.com ' });

    expect(staff.assertEmailAvailableForStaff).toHaveBeenCalledWith(
      'existing@example.com',
      { excludeUserId: 7 },
    );
    expect(prisma.store_users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 7 } }),
    );
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ email: 'existing@example.com' }),
      }),
    );
  });

  it('does not save an email owned by another staff account', async () => {
    staff.assertEmailAvailableForStaff.mockRejectedValueOnce(
      new ConflictException('Email already exists'),
    );

    await expect(
      service.update(7, { email: ' Taken@Example.COM ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('does not run the global staff guard for a customer-only account', async () => {
    prisma.store_users.findFirst.mockResolvedValue({
      id: 10,
      user: {
        id: 7,
        user_roles: [{ roles: { name: 'customer', is_system_role: true } }],
        user_settings: { config: {} },
      },
    });

    await service.update(7, { email: ' Customer@Example.COM ' });

    expect(staff.assertEmailAvailableForStaff).not.toHaveBeenCalled();
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'customer@example.com' }),
      }),
    );
  });
});
