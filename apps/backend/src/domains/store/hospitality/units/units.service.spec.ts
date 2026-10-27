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
    } as any);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
    unitTypes.findFirst.mockResolvedValue({ id: 11 });
  });

  afterEach(() => jest.restoreAllMocks());

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
      .mockResolvedValueOnce({ id: 1, code: '101', unit_type_id: 11 })
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
});
