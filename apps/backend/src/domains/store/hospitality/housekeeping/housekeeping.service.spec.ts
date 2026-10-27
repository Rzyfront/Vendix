import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { HousekeepingService } from './housekeeping.service';
import { ChangeHousekeepingStatusDto } from './change-housekeeping-status.dto';
import {
  canChangeHousekeeping,
  isSellableHousekeeping,
} from './housekeeping-status';
import { buildRack } from '../reservations/rack/rack-builder';
import { LodgingAvailabilityService } from '../reservations/lodging-availability.service';

jest.mock('@common/utils/store-timezone.util', () => ({
  ...jest.requireActual('@common/utils/store-timezone.util'),
  resolveStoreTimezone: jest.fn().mockResolvedValue('America/Bogota'),
}));

/**
 * H5.1 — room status: the housekeeper cleans a dirty room, inspects it, and
 * can take it out of service, which removes it from the sale.
 */
describe('HousekeepingService', () => {
  const units = { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() };
  const rooms = { findMany: jest.fn() };
  /** Sale-lock transaction: Doble (type 11) has 101 (unit 1) and 102. */
  const tx = {
    $executeRaw: jest.fn(),
    lodging_units: { findFirst: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
    lodging_room_nights: { findFirst: jest.fn(), groupBy: jest.fn() },
    lodging_inventory_blocks: { findMany: jest.fn() },
  };
  const $transaction = jest.fn((fn: (client: typeof tx) => unknown) => fn(tx));
  let service: HousekeepingService;
  const MANAGER = ['store:lodging:housekeeping:operate', 'store:lodging:housekeeping:assign'];
  const asUser = (permissions: string[]) =>
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9, permissions } as any);

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    const body = (error as VendixHttpException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ error_code: code });
    return body;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HousekeepingService(
      { lodging_units: units, lodging_reservation_rooms: rooms, $transaction } as any,
      new LodgingAvailabilityService({} as any),
    );
    asUser(MANAGER);
    tx.lodging_units.findFirst.mockResolvedValue({
      id: 1,
      code: '101',
      unit_type_id: 11,
      is_active: true,
      housekeeping_status: 'clean',
      unit_type: { name: 'Doble', overbooking_allowance: 0 },
    });
    tx.lodging_units.updateMany.mockResolvedValue({ count: 1 });
    tx.lodging_units.count.mockResolvedValue(2);
    tx.lodging_room_nights.findFirst.mockResolvedValue(null);
    tx.lodging_room_nights.groupBy.mockResolvedValue([]);
    tx.lodging_inventory_blocks.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('transitions', () => {
    it.each([
      ['dirty', 'clean'],
      ['clean', 'inspected'],
      ['inspected', 'dirty'],
      ['clean', 'out_of_order'],
      ['out_of_order', 'dirty'],
      ['out_of_service', 'clean'],
    ] as const)('allows %s → %s', (from, to) => {
      expect(canChangeHousekeeping(from, to)).toBe(true);
    });

    it.each([
      ['dirty', 'inspected'],
      ['dirty', 'dirty'],
      ['out_of_order', 'inspected'],
    ] as const)('rejects %s → %s', (from, to) => {
      expect(canChangeHousekeeping(from, to)).toBe(false);
    });

    it('only out of order/service rooms stop being sellable', () => {
      expect(['clean', 'dirty', 'inspected'].every(isSellableHousekeeping)).toBe(true);
      expect(isSellableHousekeeping('out_of_order')).toBe(false);
      expect(isSellableHousekeeping('out_of_service')).toBe(false);
    });
  });

  describe('changeStatus', () => {
    it('marks the dirty 101 clean with a conditional update', async () => {
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'dirty' });
      units.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.changeStatus(1, 'dirty', 'clean');

      expect(units.updateMany).toHaveBeenCalledWith({
        where: { id: 1, housekeeping_status: 'dirty' },
        data: expect.objectContaining({ housekeeping_status: 'clean' }),
      });
      expect(result).toEqual({ id: 1, code: '101', housekeeping_status: 'clean' });
    });

    it('rejects inspecting a room that was not cleaned', async () => {
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'dirty' });

      const body = await expectCode(
        service.changeStatus(1, 'dirty', 'inspected'),
        'LODGING_HOUSEKEEPING_TRANSITION_001',
      );
      expect(body.message).toBe('La 101 no puede pasar de sucia a inspeccionada');
      expect(units.updateMany).not.toHaveBeenCalled();
    });

    it('rejects a change based on a status the board no longer shows', async () => {
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'clean' });

      const body = await expectCode(
        service.changeStatus(1, 'dirty', 'clean'),
        'LODGING_HOUSEKEEPING_STALE_001',
      );
      expect(body.message).toBe('La 101 ya está limpia. Actualiza el tablero.');
      expect(units.updateMany).not.toHaveBeenCalled();
    });

    it('rejects when another user changed the room in between', async () => {
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'clean' });
      units.updateMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.changeStatus(1, 'clean', 'inspected'),
        'LODGING_HOUSEKEEPING_STALE_001',
      );
    });

    it('returns not found for a room of another store', async () => {
      units.findFirst.mockResolvedValue(null);
      await expectCode(service.changeStatus(99, 'dirty', 'clean'), 'LODGING_UNIT_FIND_001');
    });
  });

  describe('separation of duties', () => {
    it.each([
      ['clean', 'inspected'],
      ['clean', 'out_of_order'],
      ['dirty', 'out_of_service'],
    ] as const)('the housekeeper cannot change %s → %s', async (from, to) => {
      asUser(['store:lodging:housekeeping:operate']);
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: from });

      await expectCode(service.changeStatus(1, from, to), 'AUTH_PERM_001');
      expect(units.updateMany).not.toHaveBeenCalled();
      expect($transaction).not.toHaveBeenCalled();
    });

    it('the housekeeper still cleans; inventory managers take rooms out of sale', async () => {
      asUser(['store:lodging:housekeeping:operate']);
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'dirty' });
      units.updateMany.mockResolvedValue({ count: 1 });
      await expect(service.changeStatus(1, 'dirty', 'clean')).resolves.toMatchObject({
        housekeeping_status: 'clean',
      });

      asUser(['store:lodging:inventory:write']);
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'clean' });
      await expect(service.changeStatus(1, 'clean', 'out_of_order')).resolves.toMatchObject({
        housekeeping_status: 'out_of_order',
      });
    });
  });

  describe('taking a room out of the sale (same rules as a block)', () => {
    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
      jest.setSystemTime(new Date('2026-11-09T15:00:00Z')); // 9-nov in Bogotá
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'clean' });
    });
    afterEach(() => jest.useRealTimers());

    it('refuses a room with a reservation assigned from today on, naming it', async () => {
      tx.lodging_room_nights.findFirst.mockResolvedValue({
        night_date: new Date('2026-11-10T00:00:00Z'),
        reservation_room: { reservation: { reservation_number: 'H-0007' } },
      });

      const body = await expectCode(
        service.changeStatus(1, 'clean', 'out_of_order'),
        'LODGING_BLOCK_RESERVED_001',
      );
      expect(body.message).toBe(
        'La 101 tiene la reserva H-0007 el 10-nov. Muévela antes de sacarla de la venta.',
      );
      expect(tx.lodging_room_nights.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            store_id: 5,
            unit_id: 1,
            is_active: true,
            night_date: { gte: new Date('2026-11-09T00:00:00Z') },
          }),
        }),
      );
      expect(tx.$executeRaw.mock.calls[0][1]).toBe('lodging_reservations:5');
      expect(tx.lodging_units.updateMany).not.toHaveBeenCalled();
    });

    it('refuses when the unassigned reservations of the type would be left without a room', async () => {
      // 102 is sold and another Doble is unassigned on 12-nov: both rooms are needed.
      tx.lodging_room_nights.groupBy.mockResolvedValue([
        { night_date: new Date('2026-11-12T00:00:00Z'), _count: { _all: 2 } },
      ]);

      const body = await expectCode(
        service.changeStatus(1, 'clean', 'out_of_order'),
        'LODGING_BLOCK_OVERSOLD_001',
      );
      expect(body.message).toBe(
        'Sacar de la venta la 101 deja sin habitación a reservas de Doble el 12-nov. Asígnalas o muévelas antes.',
      );
      expect(tx.lodging_units.updateMany).not.toHaveBeenCalled();
    });

    it('takes a free room out of the sale under the lock', async () => {
      tx.lodging_room_nights.groupBy.mockResolvedValue([
        { night_date: new Date('2026-11-12T00:00:00Z'), _count: { _all: 1 } },
      ]);

      await expect(service.changeStatus(1, 'clean', 'out_of_order')).resolves.toEqual({
        id: 1,
        code: '101',
        housekeeping_status: 'out_of_order',
      });
      expect(tx.lodging_units.updateMany).toHaveBeenCalledWith({
        where: { id: 1, store_id: 5, housekeeping_status: 'clean' },
        data: expect.objectContaining({ housekeeping_status: 'out_of_order' }),
      });
      expect(units.updateMany).not.toHaveBeenCalled();
    });

    it('moving between out-of-sale statuses needs no guard', async () => {
      units.findFirst.mockResolvedValue({ id: 1, code: '101', housekeeping_status: 'out_of_order' });
      units.updateMany.mockResolvedValue({ count: 1 });

      await service.changeStatus(1, 'out_of_order', 'out_of_service');

      expect($transaction).not.toHaveBeenCalled();
    });
  });

  describe('board', () => {
    it('flags rooms in house and leaving today, in the store business day', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-11-11T03:00:00Z')); // 10-nov 22:00 Bogotá
      units.findMany.mockResolvedValue([
        { id: 1, code: '101', floor: '1', zone: null, housekeeping_status: 'clean', unit_type: { id: 11, name: 'Doble' } },
        { id: 2, code: '102', floor: '1', zone: null, housekeeping_status: 'clean', unit_type: { id: 11, name: 'Doble' } },
        { id: 3, code: '201', floor: '2', zone: null, housekeeping_status: 'dirty', unit_type: { id: 11, name: 'Doble' } },
      ]);
      rooms.findMany.mockResolvedValue([
        { unit_id: 1, departure_date: new Date('2026-11-10T00:00:00Z') },
        { unit_id: 2, departure_date: new Date('2026-11-12T00:00:00Z') },
      ]);

      const board = await service.board();

      expect(board.business_date).toBe('2026-11-10');
      expect(board.units.map((u) => [u.code, u.occupancy])).toEqual([
        ['101', 'departs_today'],
        ['102', 'in_house'],
        ['201', null],
      ]);
      expect(units.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { is_active: true } }),
      );
      jest.useRealTimers();
    });
  });

  it('the rack does not count a room out of service as free', () => {
    const rack = buildRack({
      from: '2026-11-10',
      to: '2026-11-11',
      types: [{ id: 11, name: 'Doble', overbooking_allowance: 0 }],
      units: [
        { id: 1, unit_type_id: 11, code: '101', floor: '1', housekeeping_status: 'clean', is_active: true },
        { id: 2, unit_type_id: 11, code: '102', floor: '1', housekeeping_status: 'out_of_order', is_active: true },
      ],
      rooms: [],
      sold: [],
    } as any);
    expect(rack.types[0].free).toEqual([1]);
  });

  it('availability counts only rooms that are not out of order/service', async () => {
    const client = {
      lodging_unit_types: { findFirst: jest.fn().mockResolvedValue({ overbooking_allowance: 0 }) },
      lodging_units: { count: jest.fn().mockResolvedValue(1) },
      lodging_room_nights: { groupBy: jest.fn().mockResolvedValue([]) },
      lodging_allotments: { findMany: jest.fn().mockResolvedValue([]) },
      lodging_inventory_blocks: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const availability = new LodgingAvailabilityService(client as any);

    const available = await availability.countAvailable(11, '2026-11-10', '2026-11-12', client as any);

    expect(available).toBe(1);
    expect(client.lodging_units.count).toHaveBeenCalledWith({
      where: {
        unit_type_id: 11,
        is_active: true,
        housekeeping_status: { notIn: ['out_of_order', 'out_of_service'] },
      },
    });
  });

  it('nights on a room out of service are not subtracted twice from its type', async () => {
    // Doble: 101 out of order still holds H-0007 on 10-nov; 102 is free.
    const nights = [{ unit_id: 1, unit_status: 'out_of_order', night_date: '2026-11-10' }];
    const client = {
      lodging_unit_types: { findFirst: jest.fn().mockResolvedValue({ overbooking_allowance: 0 }) },
      lodging_units: { count: jest.fn().mockResolvedValue(1) },
      lodging_room_nights: {
        groupBy: jest.fn(async ({ where }: any) => {
          const sellableOnly = where.OR?.[1]?.unit?.housekeeping_status?.notIn ?? [];
          const counted = nights.filter((n) => !sellableOnly.includes(n.unit_status));
          return counted.length
            ? [{ night_date: new Date(`${counted[0].night_date}T00:00:00Z`), _count: { _all: counted.length } }]
            : [];
        }),
      },
      lodging_allotments: { findMany: jest.fn().mockResolvedValue([]) },
      lodging_inventory_blocks: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const availability = new LodgingAvailabilityService(client as any);

    await expect(
      availability.countAvailable(11, '2026-11-10', '2026-11-11', client as any),
    ).resolves.toBe(1);
  });

  it('the status DTO only accepts known statuses', async () => {
    const dto = plainToInstance(ChangeHousekeepingStatusDto, { from: 'dirty', status: 'sparkling' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });
});
