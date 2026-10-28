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
    updateMany: jest.fn(),
  };
  const rooms = { findMany: jest.fn() };
  const users = { findMany: jest.fn() };
  const txTasks = { updateMany: jest.fn() };
  const txUnits = { updateMany: jest.fn() };
  const prisma = {
    lodging_housekeeping_tasks: tasks,
    lodging_reservation_rooms: rooms,
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
        .mockResolvedValueOnce({ id: 1, unit_id: 7 })
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
