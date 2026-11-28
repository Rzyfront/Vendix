import { UsersService } from './users.service';
import { fullUserRow } from '../../../testing/user-row-fixture';

/**
 * Super Admin user management (`/superadmin/users`): credentials never reach
 * the screen, while the lockout fields stay because the edit modal shows the
 * lock and offers to unlock it.
 */
describe('Superadmin UsersService — no credentials, lockout kept for the unlock screen', () => {
  const withRoles = () => ({
    ...fullUserRow(5),
    organizations: { id: 3, name: 'Org' },
    user_roles: [{ roles: { name: 'owner' } }],
  });
  const prisma = {
    users: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };
  let service: UsersService;

  const expectCredentialsOutLockoutIn = (user: unknown) => {
    expect(user).not.toHaveProperty('password');
    expect(user).not.toHaveProperty('two_factor_secret');
    expect(user).toEqual(
      expect.objectContaining({
        id: 5,
        failed_login_attempts: 3,
        locked_until: new Date('2026-11-23T12:00:00Z'),
        user_roles: [{ roles: { name: 'owner' } }],
      }),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.users.findMany.mockResolvedValue([withRoles()]);
    prisma.users.count.mockResolvedValue(1);
    prisma.users.findFirst.mockResolvedValue(withRoles());
    prisma.users.findUnique.mockResolvedValue(fullUserRow(5));
    prisma.users.update.mockResolvedValue(withRoles());
    service = new UsersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      // UsernameService stub: username always free, P2002 rethrown untouched.
      {
        assertAvailable: jest.fn(),
        generateUnique: jest.fn().mockResolvedValue('generated_user'),
        rethrowAsConflict: jest.fn((error: unknown) => {
          throw error;
        }),
      } as never,
    );
  });

  it('GET /superadmin/users', async () => {
    const { data } = await service.findAll({ page: 1, limit: 10 } as never);

    expectCredentialsOutLockoutIn(data[0]);
  });

  it('GET /superadmin/users/:id', async () => {
    expectCredentialsOutLockoutIn(await service.findOne(5));
  });

  it('verify email, toggle 2FA and unlock', async () => {
    expectCredentialsOutLockoutIn(await service.verifyEmail(5));
    expectCredentialsOutLockoutIn(await service.toggle2FA(5, true));
    expectCredentialsOutLockoutIn(await service.unlock(5));
  });
});
