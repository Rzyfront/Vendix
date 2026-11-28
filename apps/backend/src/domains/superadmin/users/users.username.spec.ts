import { UsersService } from './users.service';

jest.mock('bcrypt', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

/**
 * Edit forms always send the full payload, username included. An unchanged
 * username must not be re-checked: a case/wildcard "twin" would answer a false
 * 409 on a field the admin never touched.
 */
describe('Superadmin UsersService username on update', () => {
  const prisma = {
    users: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const usernames = {
    assertAvailable: jest.fn(),
    rethrowAsConflict: jest.fn((error: unknown) => {
      throw error;
    }),
  };
  let service: UsersService;

  beforeEach(() => {
    jest.resetAllMocks();
    usernames.rethrowAsConflict.mockImplementation((error: unknown) => {
      throw error;
    });
    const user = {
      id: 7,
      username: 'juan_perez',
      email: 'juan@example.com',
      organization_id: 3,
      user_roles: [{ roles: { name: 'employee' } }],
    };
    prisma.users.findUnique.mockResolvedValue(user);
    prisma.users.update.mockResolvedValue(user);
    service = new UsersService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      usernames as never,
    );
  });

  it('does not check availability when editing without changing the username', async () => {
    await service.update(7, { username: ' juan_perez ', first_name: 'Juan' });

    expect(usernames.assertAvailable).not.toHaveBeenCalled();
    expect(prisma.users.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 7 },
        data: expect.objectContaining({ username: 'juan_perez' }),
      }),
    );
  });

  it('checks availability (excluding the edited user) when the username changes', async () => {
    await service.update(7, { username: 'juan_nuevo' });

    expect(usernames.assertAvailable).toHaveBeenCalledWith('juan_nuevo', {
      excludeUserId: 7,
    });
  });
});
