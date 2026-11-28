import { HttpStatus } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { UsernameService } from '@common/services/username.service';
import { VendixHttpException } from '@common/errors/vendix-http.exception';
import { StoreUserManagementService } from './store-user-management.service';

jest.mock('bcryptjs', () => ({ hash: jest.fn().mockResolvedValue('hashed') }));

/**
 * Production alert: POST /store/users/management answered 500 with a P2002 on
 * `users_username_key`. A taken username must be a readable 409.
 */
describe('StoreUserManagementService username uniqueness', () => {
  // Unscoped lookups used by UsernameService (global namespace).
  const globalUsers = { findFirst: jest.fn() };
  const globalPrisma = { withoutScope: () => ({ users: globalUsers }) };
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

  const baseDto = {
    first_name: 'María Fernanda de los Ángeles',
    last_name: 'Rodríguez Villalobos Santamaría',
    email: 'maria@example.com',
    password: 'SecurePassword123!',
  };

  const usernameP2002 = () =>
    Object.assign(
      new Error(
        'Unique constraint failed on the constraint: `users_username_key`',
      ),
      {
        code: 'P2002',
        meta: {
          driverAdapterError: {
            cause: { constraint: { index: 'users_username_key' } },
          },
        },
      },
    );

  const expectUsernameTaken = (error: unknown) => {
    expect(error).toBeInstanceOf(VendixHttpException);
    const http = error as VendixHttpException;
    expect(http.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(http.getResponse()).toMatchObject({
      error_code: 'USER_USERNAME_TAKEN',
    });
  };

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
    prisma.users.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: 7, username: data.username }),
    );
    globalUsers.findFirst.mockResolvedValue(null);
    service = new StoreUserManagementService(
      prisma as never,
      {} as never,
      staff as never,
      {} as never,
      new UsernameService(globalPrisma as never),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  describe('create', () => {
    it('rejects a typed username owned by another user with 409, before writing', async () => {
      globalUsers.findFirst.mockResolvedValue({ id: 55 });

      const error = await service
        .create({ ...baseDto, username: 'Vendix_Demo' })
        .catch((e) => e);

      expectUsernameTaken(error);
      expect(globalUsers.findFirst).toHaveBeenCalledWith({
        where: { username: { equals: 'Vendix\\_Demo', mode: 'insensitive' } },
        select: { id: true },
      });
      expect(prisma.users.create).not.toHaveBeenCalled();
    });

    it('persists a free typed username trimmed', async () => {
      const user = await service.create({
        ...baseDto,
        username: ' vendedor_1 ',
      });

      expect(user).toMatchObject({ username: 'vendedor_1' });
    });

    it('autogenerates a unique username that fits in 50 characters', async () => {
      globalUsers.findFirst
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce(null);

      const user = await service.create({ ...baseDto });
      const username = (user as { username: string }).username;

      expect(username.length).toBeLessThanOrEqual(50);
      expect(username).toMatch(/^[a-z0-9_]+$/);
      expect(username.startsWith('mariafernandadelosangeles_rodriguez')).toBe(
        true,
      );
      expect(username.endsWith('1')).toBe(true);
    });

    it('turns a racing P2002 on users_username_key into the same 409 (never 500)', async () => {
      prisma.users.create.mockRejectedValue(usernameP2002());

      const error = await service
        .create({ ...baseDto, username: 'vendedor_1' })
        .catch((e) => e);

      expectUsernameTaken(error);
    });

    it('does not mask other unique violations', async () => {
      const other = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
        meta: { target: ['email'] },
      });
      prisma.users.create.mockRejectedValue(other);

      await expect(service.create({ ...baseDto })).rejects.toBe(other);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      jest
        .spyOn(service, 'findOne')
        .mockResolvedValue({
          username: 'actual_user',
          roles: [{ name: 'employee' }],
        } as never);
      prisma.users.update.mockImplementation(({ data }) =>
        Promise.resolve({ id: 7, username: data.username }),
      );
    });

    it('rejects a username owned by another user with 409, excluding the edited user', async () => {
      globalUsers.findFirst.mockResolvedValue({ id: 55 });

      const error = await service
        .update(7, { username: 'vendix_demo' })
        .catch((e) => e);

      expectUsernameTaken(error);
      expect(globalUsers.findFirst).toHaveBeenCalledWith({
        where: {
          username: { equals: 'vendix\\_demo', mode: 'insensitive' },
          id: { not: 7 },
        },
        select: { id: true },
      });
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('keeps the edited user own username', async () => {
      await expect(
        service.update(7, { username: 'mi_usuario' }),
      ).resolves.toMatchObject({ username: 'mi_usuario' });
    });

    it('does not check availability when the username did not change', async () => {
      // A wildcard/case "twin" exists, but editing other fields must still save.
      globalUsers.findFirst.mockResolvedValue({ id: 55 });

      await expect(
        service.update(7, { username: ' actual_user ', phone: '3001234567' }),
      ).resolves.toMatchObject({ username: 'actual_user' });
      expect(globalUsers.findFirst).not.toHaveBeenCalled();
    });

    it('turns a racing P2002 into 409', async () => {
      prisma.users.update.mockRejectedValue(usernameP2002());

      const error = await service
        .update(7, { username: 'mi_usuario' })
        .catch((e) => e);

      expectUsernameTaken(error);
    });
  });

  describe('checkUsernameAvailability (GET management/username-availability)', () => {
    it('answers available, taken and own-in-edit', async () => {
      await expect(
        service.checkUsernameAvailability('libre_1'),
      ).resolves.toEqual({ available: true });

      globalUsers.findFirst.mockResolvedValueOnce({ id: 55 });
      await expect(
        service.checkUsernameAvailability('vendix_demo'),
      ).resolves.toEqual({ available: false, reason: 'taken' });

      prisma.store_users.findFirst.mockResolvedValueOnce({ id: 70 });
      await expect(
        service.checkUsernameAvailability('mi_usuario', 7),
      ).resolves.toEqual({ available: true });
      expect(globalUsers.findFirst).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: { not: 7 } }),
        }),
      );
    });

    it('ignores exclude_user_id of a user outside this store', async () => {
      prisma.store_users.findFirst.mockResolvedValue(null);
      globalUsers.findFirst.mockResolvedValue({ id: 900 });

      await expect(
        service.checkUsernameAvailability('ajeno_user', 900),
      ).resolves.toEqual({ available: false, reason: 'taken' });
      expect(prisma.store_users.findFirst).toHaveBeenCalledWith({
        where: { user_id: 900 },
        select: { id: true },
      });
      expect(globalUsers.findFirst).toHaveBeenCalledWith({
        where: {
          username: { equals: 'ajeno\\_user', mode: 'insensitive' },
        },
        select: { id: true },
      });
    });

    it('excludes a user of this store (store-scoped lookup)', async () => {
      prisma.store_users.findFirst.mockResolvedValue({ id: 70 });

      await service.checkUsernameAvailability('mi_usuario', 7);

      expect(globalUsers.findFirst).toHaveBeenCalledWith({
        where: {
          username: { equals: 'mi\\_usuario', mode: 'insensitive' },
          id: { not: 7 },
        },
        select: { id: true },
      });
    });

    it('applies the store DTO format (letters, digits, underscore)', async () => {
      await expect(
        service.checkUsernameAvailability('juan.perez'),
      ).resolves.toEqual({ available: false, reason: 'invalid' });
    });
  });
});
