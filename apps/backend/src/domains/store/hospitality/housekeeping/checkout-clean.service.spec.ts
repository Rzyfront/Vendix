import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import {
  CheckoutCleanService,
  rankCheckoutCleanStaff,
  suggestAssignees,
} from './checkout-clean.service';
import { cleaningRoleNames } from './cleaning-role';

jest.mock('@common/utils/store-timezone.util', () => ({
  ...jest.requireActual('@common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
  localDateString: jest.fn().mockReturnValue('2026-11-23'),
}));

const user = (id: number, first_name: string, roles: string[]) => ({
  id,
  first_name,
  last_name: '',
  user_roles: roles.map((name) => ({ roles: { name } })),
});

/** Agenda unificada (F3) — the check-out suggests the room's clean. */
describe('CheckoutCleanService', () => {
  const tasks = { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() };
  const reservations = { findFirst: jest.fn() };
  const rooms = { findMany: jest.fn() };
  const users = { findMany: jest.fn() };
  const prisma = {
    lodging_housekeeping_tasks: tasks,
    lodging_reservations: reservations,
    lodging_reservation_rooms: rooms,
    users,
  };
  let service: CheckoutCleanService;

  const unit = (id: number, code: string) => ({
    unit: { id, code, floor: '1', unit_type: { name: 'Doble' } },
  });
  const checkedOut = (...units: ReturnType<typeof unit>[]) =>
    reservations.findFirst.mockResolvedValue({ id: 9, status: 'checked_out', rooms: units });

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).getResponse()).toMatchObject({ error_code: code });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.LODGING_CLEANING_ROLE_NAMES;
    service = new CheckoutCleanService(prisma as any);
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 5, user_id: 1 } as any);
    tasks.findMany.mockResolvedValue([]);
    rooms.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('cleaning role', () => {
    it('defaults to the housekeeper system role', () => {
      expect(cleaningRoleNames({})).toEqual(['housekeeper']);
      expect(cleaningRoleNames({ LODGING_CLEANING_ROLE_NAMES: ' ' })).toEqual(['housekeeper']);
    });

    it('reads the role keys from config', () => {
      expect(cleaningRoleNames({ LODGING_CLEANING_ROLE_NAMES: 'Limpieza, housekeeper' })).toEqual([
        'limpieza',
        'housekeeper',
      ]);
    });
  });

  describe('recommended list', () => {
    it('puts the cleaning role first, then the lighter load, then the name', () => {
      const ranked = rankCheckoutCleanStaff([
        { id: 1, name: 'Ana Admin', is_cleaning_role: false, pending_tasks: 0 },
        { id: 2, name: 'Zoe', is_cleaning_role: true, pending_tasks: 3 },
        { id: 3, name: 'Bea', is_cleaning_role: true, pending_tasks: 1 },
        { id: 4, name: 'Ciro', is_cleaning_role: true, pending_tasks: 1 },
      ]);
      expect(ranked.map((s) => s.id)).toEqual([3, 4, 2, 1]);
    });

    it('spreads several rooms over the cleaning role by load', () => {
      const staff = [
        { id: 3, name: 'Bea', is_cleaning_role: true, pending_tasks: 0 },
        { id: 4, name: 'Ciro', is_cleaning_role: true, pending_tasks: 1 },
        { id: 1, name: 'Ana', is_cleaning_role: false, pending_tasks: 0 },
      ];
      expect([...suggestAssignees([10, 11, 12], staff).values()]).toEqual([3, 3, 4]);
      expect(suggestAssignees([10], [])).toEqual(new Map([[10, null]]));
    });
  });

  describe('suggestion', () => {
    it('offers the clean of each room with the cleaning role first', async () => {
      checkedOut(unit(7, '101'));
      users.findMany.mockResolvedValue([
        user(1, 'Ana', ['owner']),
        user(2, 'Luz', ['housekeeper']),
      ]);
      rooms.findMany.mockResolvedValue([{ unit_id: 7 }]);

      const result = await service.suggestion(9);

      expect(result.business_date).toBe('2026-11-23');
      expect(result.staff.map((s) => [s.id, s.is_cleaning_role])).toEqual([
        [2, true],
        [1, false],
      ]);
      expect(result.rooms).toEqual([
        expect.objectContaining({
          unit_id: 7,
          code: '101',
          priority: 'high',
          suggested_user_id: 2,
          existing_task: null,
        }),
      ]);
      expect(result.rooms[0].suggested_note).toContain('llega un huésped hoy');
      // Only people who hold the role or may finish cleaning tasks.
      const where = users.findMany.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('store:lodging:housekeeping:operate');
      expect(JSON.stringify(where)).toContain('housekeeper');
    });

    it('is refused before the check-out', async () => {
      reservations.findFirst.mockResolvedValue({ id: 9, status: 'checked_in', rooms: [] });
      await expectCode(service.suggestion(9), 'LODGING_RESERVATION_TRANSITION_001');
    });
  });

  describe('assign', () => {
    beforeEach(() => {
      checkedOut(unit(7, '101'));
      users.findMany.mockResolvedValue([user(2, 'Luz', ['housekeeper'])]);
    });

    it('creates the clean with the chosen person', async () => {
      tasks.findFirst.mockResolvedValue(null);
      tasks.create.mockResolvedValue({ id: 50 });

      const result = await service.assign(9, [{ unit_id: 7, assigned_user_id: 2, notes: ' Urgente ' }]);

      expect(tasks.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          store_id: 5,
          unit_id: 7,
          type: 'checkout_clean',
          assigned_user_id: 2,
          notes: 'Urgente',
        }),
        select: { id: true },
      });
      expect(result).toEqual([
        { unit_id: 7, code: '101', task_id: 50, assigned_user_id: 2, outcome: 'created' },
      ]);
    });

    it('gives the person to the clean the day list already made', async () => {
      tasks.findFirst.mockResolvedValue({ id: 40, status: 'pending', assigned_user_id: null });
      tasks.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.assign(9, [{ unit_id: 7, assigned_user_id: 2 }]);

      expect(tasks.create).not.toHaveBeenCalled();
      expect(tasks.updateMany).toHaveBeenCalledWith({
        where: { id: 40, status: 'pending' },
        data: expect.objectContaining({ assigned_user_id: 2 }),
      });
      expect(result[0].outcome).toBe('assigned');
    });

    it('falls back to the update when the day list made it meanwhile', async () => {
      tasks.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 41 });
      tasks.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }),
      );
      tasks.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.assign(9, [{ unit_id: 7, assigned_user_id: 2 }]);

      expect(result[0]).toMatchObject({ task_id: 41, outcome: 'assigned' });
    });

    it('leaves an already cleaned room untouched', async () => {
      tasks.findFirst.mockResolvedValue({ id: 40, status: 'done', assigned_user_id: 3 });

      const result = await service.assign(9, [{ unit_id: 7, assigned_user_id: 2 }]);

      expect(tasks.updateMany).not.toHaveBeenCalled();
      expect(result[0].outcome).toBe('done');
    });

    it('refuses a person who cannot receive cleaning tasks', async () => {
      users.findMany.mockResolvedValue([]);
      await expectCode(
        service.assign(9, [{ unit_id: 7, assigned_user_id: 99 }]),
        'LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001',
      );
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('refuses a room of another reservation', async () => {
      await expectCode(
        service.assign(9, [{ unit_id: 8, assigned_user_id: 2 }]),
        'LODGING_RESERVATION_ROOM_FIND_001',
      );
      expect(tasks.create).not.toHaveBeenCalled();
    });
  });
});
