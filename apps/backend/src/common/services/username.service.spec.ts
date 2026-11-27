import { HttpStatus } from '@nestjs/common';
import { VendixHttpException } from '../errors';
import { UsernameService } from './username.service';
import {
  STORE_USERNAME_PATTERN,
  USERNAME_MAX_LENGTH,
  isUsernameUniqueViolation,
} from '../utils/username.util';

describe('UsernameService', () => {
  const users = { findFirst: jest.fn() };
  const prisma = { withoutScope: () => ({ users }) };
  let service: UsernameService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UsernameService(prisma as never);
  });

  describe('checkAvailability', () => {
    it('answers available when nobody owns the username', async () => {
      users.findFirst.mockResolvedValue(null);

      await expect(service.checkAvailability('  juan_perez ')).resolves.toEqual(
        { available: true },
      );
      expect(users.findFirst).toHaveBeenCalledWith({
        where: { username: { equals: 'juan_perez', mode: 'insensitive' } },
        select: { id: true },
      });
    });

    it('answers taken (only a boolean, no user data) when another user owns it', async () => {
      users.findFirst.mockResolvedValue({ id: 99 });

      await expect(service.checkAvailability('Juan_Perez')).resolves.toEqual({
        available: false,
        reason: 'taken',
      });
    });

    it('treats the edited user own username as available', async () => {
      users.findFirst.mockResolvedValue(null);

      await expect(
        service.checkAvailability('juan_perez', { excludeUserId: 7 }),
      ).resolves.toEqual({ available: true });
      expect(users.findFirst).toHaveBeenCalledWith({
        where: {
          username: { equals: 'juan_perez', mode: 'insensitive' },
          id: { not: 7 },
        },
        select: { id: true },
      });
    });

    it.each(['ab', 'x'.repeat(51), 'juan perez', 'juan.perez'])(
      'answers invalid for %p with the store DTO rules, without querying',
      async (raw) => {
        await expect(
          service.checkAvailability(raw, { pattern: STORE_USERNAME_PATTERN }),
        ).resolves.toEqual({ available: false, reason: 'invalid' });
        expect(users.findFirst).not.toHaveBeenCalled();
      },
    );
  });

  it('assertAvailable throws 409 USER_USERNAME_TAKEN when taken', async () => {
    users.findFirst.mockResolvedValue({ id: 3 });

    const error = await service.assertAvailable('juan').catch((e) => e);

    expect(error).toBeInstanceOf(VendixHttpException);
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      error_code: 'USER_USERNAME_TAKEN',
      message: 'Ese nombre de usuario ya está en uso',
    });
  });

  describe('generateUnique', () => {
    it('skips taken candidates and never exceeds 50 characters', async () => {
      const longBase =
        'maria_fernanda_de_los_angeles_rodriguez_villalobos_extra';
      users.findFirst
        .mockResolvedValueOnce({ id: 1 })
        .mockResolvedValueOnce({ id: 2 })
        .mockResolvedValueOnce(null);

      const username = await service.generateUnique(longBase);

      expect(username.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
      expect(username.endsWith('2')).toBe(true);
      expect(username).toBe(`${longBase.slice(0, 49)}2`);
    });

    it('falls back to a random suffix after 100 collisions, still ≤ 50', async () => {
      users.findFirst.mockResolvedValue({ id: 1 });

      const username = await service.generateUnique('x'.repeat(60));

      expect(username.length).toBeLessThanOrEqual(USERNAME_MAX_LENGTH);
      expect(username).toMatch(/^x+_[a-z0-9]+$/);
    });

    it('uses the fallback base when the seed is empty', async () => {
      users.findFirst.mockResolvedValue(null);

      await expect(service.generateUnique('  ')).resolves.toBe('usuario');
    });
  });

  describe('rethrowAsConflict (P2002 safety net)', () => {
    it('maps a driver-adapter P2002 on users_username_key to 409', () => {
      const p2002 = Object.assign(
        new Error(
          'Unique constraint failed on the constraint: `users_username_key`',
        ),
        {
          code: 'P2002',
          meta: {
            modelName: 'users',
            driverAdapterError: {
              cause: { constraint: { index: 'users_username_key' } },
            },
          },
        },
      );

      expect(() => service.rethrowAsConflict(p2002)).toThrow(
        VendixHttpException,
      );
    });

    it('maps a classic meta.target P2002 on username to 409', () => {
      expect(
        isUsernameUniqueViolation({
          code: 'P2002',
          meta: { target: ['username'] },
        }),
      ).toBe(true);
    });

    it('rethrows any other error untouched', () => {
      const emailConflict = {
        code: 'P2002',
        meta: { target: ['email'] },
        message: 'Unique constraint failed on the fields: (`email`)',
      };
      expect(() => service.rethrowAsConflict(emailConflict)).toThrow(
        expect.objectContaining({ code: 'P2002' }) as never,
      );
      expect(isUsernameUniqueViolation(emailConflict)).toBe(false);
    });
  });
});
