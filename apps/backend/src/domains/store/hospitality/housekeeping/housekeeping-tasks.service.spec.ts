import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import {
  dailyHousekeepingTasks,
  HousekeepingTasksService,
} from './housekeeping-tasks.service';

jest.mock('@common/utils/store-timezone.util', () => ({
  ...jest.requireActual('@common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
  localDateString: jest.fn().mockReturnValue('2026-11-10'),
}));

const d = (date: string) => new Date(`${date}T00:00:00.000Z`);
const stay = (unit_id: number | null, arrival: string, departure: string, status: string) => ({
  unit_id,
  arrival_date: d(arrival),
  departure_date: d(departure),
  reservation: { status },
});

/**
 * H5.2 — tasks per housekeeper: the day's tasks come from the stays, the
 * head housekeeper assigns them and each housekeeper finishes only hers.
 */
describe('HousekeepingTasksService', () => {
  const tasks = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    createMany: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const rooms = { findMany: jest.fn() };
  const units = { findFirst: jest.fn() };
  const users = { findMany: jest.fn() };
  const txTasks = { updateMany: jest.fn() };
  const txUnits = { updateMany: jest.fn() };
  const prisma = {
    lodging_housekeeping_tasks: tasks,
    lodging_reservation_rooms: rooms,
    lodging_units: units,
    users,
    $transaction: jest.fn((fn: (tx: unknown) => unknown) =>
      fn({ lodging_housekeeping_tasks: txTasks, lodging_units: txUnits }),
    ),
  };
  let service: HousekeepingTasksService;

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).getResponse()).toMatchObject({ error_code: code });
  };

  const view = {
    id: 1,
    task_date: d('2026-11-10'),
    type: 'checkout_clean',
    status: 'pending',
    assigned_user_id: 21,
    notes: null,
    completed_at: null,
    unit: { id: 7, code: '101', floor: '1', housekeeping_status: 'dirty', unit_type: { id: 1, name: 'Doble' } },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HousekeepingTasksService(prisma as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 21 } as any);
    rooms.findMany.mockResolvedValue([]);
    tasks.findMany.mockResolvedValue([]);
    users.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('daily generation', () => {
    it('departures get a check-out clean and guests staying on get a stayover', () => {
      const result = dailyHousekeepingTasks(
        [
          stay(1, '2026-11-08', '2026-11-10', 'checked_in'), // leaves today
          stay(2, '2026-11-07', '2026-11-10', 'checked_out'), // already left today
          stay(3, '2026-11-09', '2026-11-12', 'checked_in'), // in house
          stay(4, '2026-11-10', '2026-11-12', 'checked_in'), // arrived today
          stay(5, '2026-11-09', '2026-11-12', 'checked_out'), // left early
          stay(null, '2026-11-09', '2026-11-12', 'checked_in'), // no room yet
        ],
        '2026-11-10',
      );
      expect(result).toEqual([
        { unit_id: 1, type: 'checkout_clean' },
        { unit_id: 2, type: 'checkout_clean' },
        { unit_id: 3, type: 'stayover' },
      ]);
    });

    it('a room with a departure and a stay on the same day gets both tasks once', () => {
      const result = dailyHousekeepingTasks(
        [
          stay(1, '2026-11-08', '2026-11-10', 'checked_in'),
          stay(1, '2026-11-08', '2026-11-10', 'checked_in'),
          stay(1, '2026-11-09', '2026-11-11', 'checked_in'),
        ],
        '2026-11-10',
      );
      expect(result).toEqual([
        { unit_id: 1, type: 'checkout_clean' },
        { unit_id: 1, type: 'stayover' },
      ]);
    });

    it('reading the day creates the missing tasks without touching existing ones', async () => {
      rooms.findMany.mockResolvedValue([stay(1, '2026-11-08', '2026-11-10', 'checked_in')]);

      const result = await service.today();

      expect(result.business_date).toBe('2026-11-10');
      expect(tasks.createMany).toHaveBeenCalledWith({
        data: [{ unit_id: 1, type: 'checkout_clean', store_id: 5, task_date: d('2026-11-10') }],
        skipDuplicates: true,
      });
    });

    it('nothing to create when no room is occupied', async () => {
      await service.today();
      expect(tasks.createMany).not.toHaveBeenCalled();
    });
  });

  describe("today's assignee names", () => {
    // Finished tasks always stay on the day's list.
    const done = { ...view, status: 'done' };

    it('names the housekeeper from the staff and reads the ones who left it', async () => {
      tasks.findMany.mockResolvedValue([
        done,
        { ...done, id: 2, assigned_user_id: 33, unit: { ...view.unit, id: 8, code: '102' } },
        { ...done, id: 3, assigned_user_id: null, unit: { ...view.unit, id: 9, code: '103' } },
      ]);
      users.findMany
        .mockResolvedValueOnce([{ id: 21, first_name: 'Ana', last_name: 'Ruiz' }])
        .mockResolvedValueOnce([{ id: 33, first_name: 'Luz', last_name: 'Gil' }]);

      const result = await service.today();

      expect(result.tasks.map((t) => t.assigned_user_name)).toEqual(['Ana Ruiz', 'Luz Gil', null]);
      expect(users.findMany).toHaveBeenLastCalledWith({
        where: { id: { in: [33] }, store_users: { some: { store_id: 5 } } },
        select: { id: true, first_name: true, last_name: true },
      });
    });

    it('no extra read when every assignee is in the staff', async () => {
      tasks.findMany.mockResolvedValue([done]);
      users.findMany.mockResolvedValueOnce([{ id: 21, first_name: 'Ana', last_name: 'Ruiz' }]);

      const result = await service.today();

      expect(result.tasks[0].assigned_user_name).toBe('Ana Ruiz');
      expect(users.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('my tasks', () => {
    it('the housekeeper only reads the tasks assigned to her', async () => {
      rooms.findMany.mockResolvedValue([stay(7, '2026-11-08', '2026-11-10', 'checked_in')]);
      tasks.findMany.mockResolvedValue([view]);

      const result = await service.mine();

      expect(tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { task_date: d('2026-11-10'), assigned_user_id: 21 },
        }),
      );
      expect(result.tasks).toEqual([{ ...view, task_date: '2026-11-10' }]);
    });
  });

  describe('stays that changed today', () => {
    it('hides a pending task whose stay moved to another room, keeps finished ones', async () => {
      // The guest of 101 (unit 7) moved to 103 (unit 9) at noon.
      rooms.findMany.mockResolvedValue([stay(9, '2026-11-08', '2026-11-12', 'checked_in')]);
      const moved = { ...view, type: 'stayover' };
      const done = { ...view, id: 2, unit: { ...view.unit, id: 8, code: '102' }, status: 'done' };
      const current = { ...view, id: 3, type: 'stayover', unit: { ...view.unit, id: 9, code: '103' } };
      tasks.findMany.mockResolvedValue([moved, done, current]);

      const result = await service.today();

      expect(tasks.createMany).toHaveBeenCalledWith({
        data: [{ unit_id: 9, type: 'stayover', store_id: 5, task_date: d('2026-11-10') }],
        skipDuplicates: true,
      });
      expect(result.tasks.map((t) => t.unit.code)).toEqual(['102', '103']);
    });
  });

  describe('tasks created by hand', () => {
    it('keeps hand-made pending tasks no stay calls for, still hides a moved stayover', async () => {
      // 905 and 906 have no guest today; their tasks were asked by hand.
      const inspection = { ...view, id: 4, type: 'inspection', notes: '', unit: { ...view.unit, id: 12, code: '905' } };
      const clean = { ...view, id: 5, notes: 'Derrame', unit: { ...view.unit, id: 13, code: '906' } };
      const moved = { ...view, type: 'stayover' };
      tasks.findMany.mockResolvedValue([moved, inspection, clean]);

      const result = await service.today();

      expect(result.tasks.map((t) => `${t.unit.code}:${t.type}:${t.notes}`)).toEqual([
        '905:inspection:null',
        '906:checkout_clean:Derrame',
      ]);
    });
  });

  describe('create', () => {
    const created = {
      ...view,
      id: 9,
      type: 'inspection',
      assigned_user_id: 21,
      notes: 'Revisar aire',
      unit: { ...view.unit, id: 12, code: '905' },
    };
    const duplicate = () =>
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      });

    beforeEach(() => {
      units.findFirst.mockResolvedValue({ id: 12, code: '905' });
    });

    it('creates a task for today in an active room of the store', async () => {
      users.findMany.mockResolvedValue([{ id: 21, first_name: 'Ana', last_name: 'Ruiz' }]);
      tasks.create.mockResolvedValue(created);

      const result = await service.create({
        unit_id: 12,
        type: 'inspection',
        assigned_user_id: 21,
        notes: '  Revisar aire  ',
      });

      expect(units.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 12, is_active: true } }),
      );
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            store_id: 5,
            unit_id: 12,
            task_date: d('2026-11-10'),
            type: 'inspection',
            assigned_user_id: 21,
            notes: 'Revisar aire',
          },
        }),
      );
      expect(result).toEqual({ ...created, task_date: '2026-11-10' });
    });

    it('creates an unassigned task without notes on a later date, marked as hand-made', async () => {
      tasks.create.mockResolvedValue({ ...created, assigned_user_id: null, notes: '' });

      const result = await service.create({
        unit_id: 12,
        type: 'maintenance',
        task_date: '2026-11-12',
        notes: '   ',
      });

      expect(users.findMany).not.toHaveBeenCalled();
      expect(tasks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            task_date: d('2026-11-12'),
            type: 'maintenance',
            assigned_user_id: null,
            notes: '',
          }),
        }),
      );
      expect(result.notes).toBeNull();
    });

    it('refuses a second task of the same type for the room and day, naming both', async () => {
      tasks.create.mockRejectedValue(duplicate());

      const error = await service.create({ unit_id: 12, type: 'inspection' }).catch((e) => e);

      expect(error).toBeInstanceOf(VendixHttpException);
      expect((error as VendixHttpException).getStatus()).toBe(409);
      expect((error as VendixHttpException).getResponse()).toEqual({
        error_code: 'LODGING_HOUSEKEEPING_TASK_DUP_001',
        message: 'Ya existe una tarea de Inspección para la 905 hoy',
        details: { field: 'type' },
      });
    });

    it('names the date of a duplicate that is not today', async () => {
      tasks.create.mockRejectedValue(duplicate());

      const error = await service
        .create({ unit_id: 12, type: 'stayover', task_date: '2026-11-11' })
        .catch((e) => e);

      expect((error as VendixHttpException).getResponse()).toMatchObject({
        message: 'Ya existe una tarea de Repaso para la 905 el 11-nov',
      });
    });

    it('refuses a past date without writing', async () => {
      await expectCode(
        service.create({ unit_id: 12, type: 'inspection', task_date: '2026-11-09' }),
        'LODGING_HOUSEKEEPING_TASK_DATE_001',
      );
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('refuses a room that is not an active room of the store', async () => {
      units.findFirst.mockResolvedValue(null);

      await expectCode(service.create({ unit_id: 99, type: 'inspection' }), 'LODGING_UNIT_FIND_001');
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('refuses an assignee who is not a housekeeper of the store', async () => {
      users.findMany.mockResolvedValue([]);

      await expectCode(
        service.create({ unit_id: 12, type: 'inspection', assigned_user_id: 77 }),
        'LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001',
      );
      expect(tasks.create).not.toHaveBeenCalled();
    });

    it('lets any other database error through', async () => {
      tasks.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.create({ unit_id: 12, type: 'inspection' })).rejects.toThrow('connection lost');
    });
  });

  describe('assign', () => {
    it('assigns a pending task to a housekeeper of the store', async () => {
      tasks.findFirst.mockResolvedValueOnce({ id: 1, status: 'pending' }).mockResolvedValueOnce(view);
      users.findMany.mockResolvedValue([{ id: 21, first_name: 'Ana', last_name: 'Ruiz' }]);
      tasks.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.assign(1, 21);

      expect(users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 21, store_users: { some: { store_id: 5 } } }),
        }),
      );
      expect(tasks.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'pending' },
        data: expect.objectContaining({ assigned_user_id: 21 }),
      });
      expect(result.assigned_user_id).toBe(21);
    });

    it('rejects a user who is not a housekeeper of the store', async () => {
      tasks.findFirst.mockResolvedValue({ id: 1, status: 'pending' });
      users.findMany.mockResolvedValue([]);

      await expectCode(service.assign(1, 99), 'LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001');
      expect(tasks.updateMany).not.toHaveBeenCalled();
    });

    it('a finished task cannot be reassigned', async () => {
      tasks.findFirst.mockResolvedValue({ id: 1, status: 'done' });
      await expectCode(service.assign(1, 21), 'LODGING_HOUSEKEEPING_TASK_STATE_001');
    });
  });

  describe('complete', () => {
    it('"Terminada" closes her task and the dirty room becomes clean, pending inspection', async () => {
      tasks.findFirst
        .mockResolvedValueOnce({ id: 1, unit_id: 7, type: 'checkout_clean' })
        .mockResolvedValueOnce({ ...view, status: 'done' });
      txTasks.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.complete(1);

      expect(txTasks.updateMany).toHaveBeenCalledWith({
        where: { id: 1, store_id: 5, status: 'pending', assigned_user_id: 21 },
        data: expect.objectContaining({ status: 'done', completed_by_user_id: 21 }),
      });
      expect(txUnits.updateMany).toHaveBeenCalledWith({
        where: { id: 7, store_id: 5, housekeeping_status: 'dirty' },
        data: expect.objectContaining({ housekeeping_status: 'clean' }),
      });
      expect(result.status).toBe('done');
    });

    it.each(['inspection', 'maintenance'])(
      'finishing the %s task leaves the room status untouched',
      async (type) => {
        tasks.findFirst
          .mockResolvedValueOnce({ id: 1, unit_id: 7, type })
          .mockResolvedValueOnce({ ...view, type, status: 'done' });
        txTasks.updateMany.mockResolvedValue({ count: 1 });

        const result = await service.complete(1);

        expect(txTasks.updateMany).toHaveBeenCalled();
        expect(txUnits.updateMany).not.toHaveBeenCalled();
        expect(result.status).toBe('done');
      },
    );

    it('someone else\'s task (or an already finished one) is rejected and the room is untouched', async () => {
      tasks.findFirst.mockResolvedValue({ id: 1, unit_id: 7 });
      txTasks.updateMany.mockResolvedValue({ count: 0 });

      await expectCode(service.complete(1), 'LODGING_HOUSEKEEPING_TASK_STATE_001');
      expect(txUnits.updateMany).not.toHaveBeenCalled();
    });

    it('an unknown task is a 404', async () => {
      tasks.findFirst.mockResolvedValue(null);
      await expectCode(service.complete(1), 'LODGING_HOUSEKEEPING_TASK_FIND_001');
    });
  });
});
