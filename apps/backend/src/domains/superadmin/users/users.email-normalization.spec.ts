import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

describe('Superadmin UsersService email normalization', () => {
  const prisma = {
    users: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const staff = {
    assertEmailAvailableForStaff: jest.fn(),
    provisionStaffMembership: jest.fn(),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.requireMock('bcrypt').hash.mockResolvedValue('hashed');
    const user = {
      id: 7,
      email: 'Existing@Example.COM',
      password: 'hashed',
      organization_id: 3,
      user_roles: [{ roles: { name: 'employee' } }],
    };
    prisma.users.findUnique.mockResolvedValue(user);
    prisma.users.findFirst.mockResolvedValue(null);
    prisma.users.create.mockResolvedValue(user);
    prisma.users.update.mockResolvedValue(user);
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    service = new UsersService(
      prisma as never,
      {} as never,
      staff as never,
      {} as never,
    );
  });

  it('normalizes staff creation before the availability guard and database write', async () => {
    await service.create({
      first_name: 'John',
      last_name: 'Doe',
      username: 'john',
      email: ' New@Example.COM ',
      password: 'SecurePassword123!',
      organization_id: 3,
      main_store_id: 4,
    });

    expect(staff.assertEmailAvailableForStaff).toHaveBeenCalledWith(
      'new@example.com',
    );
    expect(prisma.users.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ email: 'new@example.com' }),
      }),
    );
  });

  it('allows casing-only edits without matching the account against itself', async () => {
    await service.update(7, { email: ' EXISTING@example.com ' });

    expect(staff.assertEmailAvailableForStaff).toHaveBeenCalledWith(
      'existing@example.com',
      { excludeUserId: 7 },
    );
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ email: 'existing@example.com' }),
      }),
    );
  });

  it('checks a changed email case-insensitively with tenant and self-exclusion intact', async () => {
    await service.update(7, { email: ' New@Example.COM ' });

    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'new@example.com', mode: 'insensitive' },
        organization_id: 3,
        id: { not: 7 },
      },
    });
  });

  it('rejects another staff identity before writing', async () => {
    staff.assertEmailAvailableForStaff.mockRejectedValueOnce(
      new ConflictException('Email already exists'),
    );

    await expect(
      service.update(7, { email: ' Taken@Example.COM ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.users.update).not.toHaveBeenCalled();
  });

  it('allows customer emails in other organizations but rejects duplicates in their own', async () => {
    prisma.users.findUnique.mockResolvedValue({
      id: 7,
      email: 'old@example.com',
      organization_id: 3,
      user_roles: [{ roles: { name: 'customer' } }],
    });
    await service.update(7, { email: ' Customer@Example.COM ' });

    expect(staff.assertEmailAvailableForStaff).not.toHaveBeenCalled();
    expect(prisma.users.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: 'customer@example.com', mode: 'insensitive' },
        organization_id: 3,
        id: { not: 7 },
      },
    });

    prisma.users.findFirst.mockResolvedValueOnce({ id: 9 });
    await expect(
      service.update(7, { email: ' Customer@Example.COM ' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.users.update).toHaveBeenCalledTimes(1);
  });
});
