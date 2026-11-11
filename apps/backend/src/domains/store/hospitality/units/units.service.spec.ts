import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { UnitsService } from './units.service';
import { CreateUnitsBulkDto } from './dto';

/**
 * H0.3 — physical rooms. Numbers are unique per store and only active rooms
 * count as sellable inventory of their type.
 */
describe('UnitsService', () => {
  const units = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    createMany: jest.fn(),
    update: jest.fn(),
  };
  const unitTypes = { findFirst: jest.fn() };
  const roomNights = { findFirst: jest.fn(), findMany: jest.fn() };
  const blocks = { findMany: jest.fn() };
  const storeSettings = { findFirst: jest.fn() };
  let service: UnitsService;

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    const body = (error as VendixHttpException).getResponse() as Record<string, unknown>;
    expect(body).toMatchObject({ error_code: code });
    return body;
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UnitsService({
      lodging_units: units,
      lodging_unit_types: unitTypes,
      lodging_room_nights: roomNights,
      lodging_inventory_blocks: blocks,
      store_settings: storeSettings,
    } as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
    unitTypes.findFirst.mockResolvedValue({ id: 11 });
    roomNights.findFirst.mockResolvedValue(null);
    storeSettings.findFirst.mockResolvedValue({ settings: {}, stores: { timezone: 'America/Bogota' } });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('H6.1: el listado y el detalle no exponen el secreto del iCal', async () => {
    units.findMany.mockResolvedValue([]);
    units.findFirst.mockResolvedValue({ id: 1, code: '101' });

    await service.findAll();
    await service.findOne(1);

    expect(units.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { ical_export_token: true } }),
    );
    expect(units.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ omit: { ical_export_token: true } }),
    );
  });

  describe('available_from / available_to', () => {
    const rooms = [
      { id: 1, code: '101' },
      { id: 2, code: '102' },
      { id: 3, code: '103' },
    ];

    beforeEach(() => {
      units.findMany.mockResolvedValue(rooms);
      roomNights.findMany.mockResolvedValue([]);
      blocks.findMany.mockResolvedValue([]);
    });

    it('sin fechas devuelve todas y no consulta noches ni bloqueos', async () => {
      const result = await service.findAll(11);
      expect(result).toHaveLength(3);
      expect(roomNights.findMany).not.toHaveBeenCalled();
      expect(blocks.findMany).not.toHaveBeenCalled();
    });

    it('con una sola fecha no filtra', async () => {
      const result = await service.findAll(undefined, { from: '2026-11-10' });
      expect(result).toHaveLength(3);
      expect(roomNights.findMany).not.toHaveBeenCalled();
    });

    it('excluye la habitación ocupada una noche del rango', async () => {
      roomNights.findMany.mockResolvedValue([{ unit_id: 1 }]);
      const result = await service.findAll(undefined, { from: '2026-11-10', to: '2026-11-12' });
      expect(result.map((u) => u.code)).toEqual(['102', '103']);
      expect(roomNights.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            store_id: 5,
            unit_id: { in: [1, 2, 3] },
            is_active: true,
            night_date: { in: [new Date('2026-11-10T00:00:00.000Z'), new Date('2026-11-11T00:00:00.000Z')] },
          },
        }),
      );
    });

    it('excluye la habitación bloqueada por mantenimiento', async () => {
      blocks.findMany.mockResolvedValue([{ unit_id: 2 }]);
      const result = await service.findAll(undefined, { from: '2026-11-10', to: '2026-11-12' });
      expect(result.map((u) => u.code)).toEqual(['101', '103']);
      expect(blocks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            unit_id: { in: [1, 2, 3] },
            released_at: null,
            from_date: { lt: new Date('2026-11-12T00:00:00.000Z') },
            to_date: { gt: new Date('2026-11-10T00:00:00.000Z') },
          }),
        }),
      );
    });

    it('las noches de la propia habitación de la reserva no cuentan como ocupadas', async () => {
      await service.findAll(undefined, {
        from: '2026-11-10',
        to: '2026-11-12',
        exclude_reservation_room_id: 77,
      });
      expect(roomNights.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ reservation_room_id: { not: 77 } }),
        }),
      );
    });

    it('rechaza fechas inválidas o una salida que no es posterior', async () => {
      await expectCode(
        service.findAll(undefined, { from: '2026-13-40', to: '2026-11-12' }),
        'LODGING_RESERVATION_DATES_001',
      );
      await expectCode(
        service.findAll(undefined, { from: '2026-11-12', to: '2026-11-12' }),
        'LODGING_RESERVATION_DATES_001',
      );
    });
  });

  it('crea la 101 del tipo con piso y estado limpia por defecto', async () => {
    units.findMany
      .mockResolvedValueOnce([]) // número libre
      .mockResolvedValueOnce([{ id: 1, code: '101', housekeeping_status: 'clean' }]);
    units.createMany.mockResolvedValue({ count: 1 });

    const result = await service.create({ code: ' 101 ', unit_type_id: 11, floor: '1' });

    expect(units.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          store_id: 5,
          unit_type_id: 11,
          code: '101',
          floor: '1',
          zone: null,
        }),
      ],
    });
    expect(result).toMatchObject({ code: '101', housekeeping_status: 'clean' });
  });

  it('repetir la 101 muestra "Ya existe una habitación con ese número"', async () => {
    units.findMany.mockResolvedValueOnce([{ code: '101' }]);

    const body = await expectCode(
      service.create({ code: '101', unit_type_id: 11 }),
      'LODGING_UNIT_DUP_001',
    );

    expect(body.message).toBe('Ya existe una habitación con ese número');
    expect(units.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ code: { equals: '101', mode: 'insensitive' } }] },
      }),
    );
    expect(units.createMany).not.toHaveBeenCalled();
  });

  it('una carrera que choca con el único (store_id, code) también da el mensaje', async () => {
    units.findMany.mockResolvedValueOnce([]);
    units.createMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expectCode(
      service.create({ code: '101', unit_type_id: 11 }),
      'LODGING_UNIT_DUP_001',
    );
  });

  it('un tipo de otra tienda no existe para el cliente con scope', async () => {
    unitTypes.findFirst.mockResolvedValue(null);
    await expectCode(
      service.create({ code: '101', unit_type_id: 99 }),
      'LODGING_UNIT_TYPE_FIND_001',
    );
    expect(units.createMany).not.toHaveBeenCalled();
  });

  it('el rango 101–110 crea todas y nombra las que ya existen', async () => {
    const codes = Array.from({ length: 10 }, (_, i) => String(101 + i));
    units.findMany.mockResolvedValueOnce([{ code: '101' }, { code: '102' }]);

    const body = await expectCode(
      service.createBulk({ codes, unit_type_id: 11 }),
      'LODGING_UNIT_DUP_001',
    );
    expect(body.message).toBe('Ya existe una habitación con ese número: 101, 102');

    units.findMany.mockReset();
    units.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce(codes.map((code) => ({ code })));
    units.createMany.mockResolvedValue({ count: 10 });
    const created = await service.createBulk({ codes, unit_type_id: 11 });
    expect(created).toHaveLength(10);
    expect(units.createMany.mock.calls[0][0].data).toHaveLength(10);
  });

  it('el mismo número dos veces en el rango se rechaza', async () => {
    await expectCode(
      service.createBulk({ codes: ['101', '101'], unit_type_id: 11 }),
      'LODGING_UNIT_DUP_001',
    );
  });

  it('el DTO masivo admite máximo 100 habitaciones', async () => {
    const codes = Array.from({ length: 101 }, (_, i) => String(i + 1));
    const errors = await validate(
      plainToInstance(CreateUnitsBulkDto, { codes, unit_type_id: 11 }),
    );
    expect(errors.map((e) => e.property)).toContain('codes');
  });

  it('desactivar una habitación la deja inactiva (sale del conteo)', async () => {
    units.findFirst
      .mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11, is_active: true })
      .mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11, is_active: false });
    units.update.mockResolvedValue({});

    const result = await service.update(1, { is_active: false });

    expect(units.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ is_active: false }),
    });
    expect(result.is_active).toBe(false);
  });

  it('renombrar a un número ocupado se rechaza', async () => {
    units.findFirst.mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11 });
    units.findMany.mockResolvedValueOnce([{ code: '102' }]);
    await expectCode(service.update(1, { code: '102' }), 'LODGING_UNIT_DUP_001');
    expect(units.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 1 } }),
      }),
    );
    expect(units.update).not.toHaveBeenCalled();
  });

  describe('con noches asignadas (H1.4)', () => {
    beforeEach(() => {
      // 10-nov 15:00 Bogotá: business day 10-nov.
      jest.useFakeTimers({ now: new Date('2026-11-10T20:00:00Z'), doNotFake: ['setImmediate', 'nextTick'] });
      units.findFirst.mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11, is_active: true });
      roomNights.findFirst.mockResolvedValue({ night_date: new Date('2026-11-10T00:00:00.000Z') });
    });

    it('cambiar el tipo se rechaza nombrando la primera noche', async () => {
      const body = await expectCode(service.update(1, { unit_type_id: 12 }), 'LODGING_UNIT_IN_USE_001');
      expect(body.message).toBe('La 101 tiene reservas asignadas desde el 10-nov; muévelas antes');
      expect(roomNights.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { unit_id: 1, is_active: true, night_date: { gte: new Date('2026-11-10T00:00:00.000Z') } },
        }),
      );
      expect(units.update).not.toHaveBeenCalled();
    });

    it('desactivarla se rechaza', async () => {
      await expectCode(service.update(1, { is_active: false }), 'LODGING_UNIT_IN_USE_001');
      expect(units.update).not.toHaveBeenCalled();
    });

    it('renombrarla o cambiar el piso no mira las noches', async () => {
      units.findFirst.mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11, floor: '2' });
      units.update.mockResolvedValue({});
      await service.update(1, { floor: '2', unit_type_id: 11 });
      expect(roomNights.findFirst).not.toHaveBeenCalled();
      expect(units.update).toHaveBeenCalled();
    });
  });
});
