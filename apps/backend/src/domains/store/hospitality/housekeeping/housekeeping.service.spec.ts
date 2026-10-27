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
  let service: HousekeepingService;

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    const body = (error as VendixHttpException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ error_code: code });
    return body;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new HousekeepingService({
      lodging_units: units,
      lodging_reservation_rooms: rooms,
    } as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
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

  it('the status DTO only accepts known statuses', async () => {
    const dto = plainToInstance(ChangeHousekeepingStatusDto, { from: 'dirty', status: 'sparkling' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toEqual(['status']);
  });
});
