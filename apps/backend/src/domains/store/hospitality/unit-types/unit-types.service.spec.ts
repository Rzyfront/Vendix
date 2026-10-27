import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { UnitTypesService } from './unit-types.service';
import { CreateUnitTypeDto, MAX_CAPACITY_MESSAGE } from './dto';

/**
 * H0.2 — room types. Each type creates its "Noche – {name}" service product
 * through ProductsService and is read through the store-scoped client.
 */
describe('UnitTypesService', () => {
  const unitTypes = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const productsService = {
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  let service: UnitTypesService;

  const dto: CreateUnitTypeDto = {
    name: 'Doble estándar',
    base_occupancy: 2,
    max_adults: 3,
    max_children: 1,
    bed_config: '1 doble + 1 sencilla',
    base_price: 250000,
    tax_category_ids: [7],
  };

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.catch((e) => e);
    expect(error).toBeInstanceOf(VendixHttpException);
    expect((error as VendixHttpException).getResponse()).toMatchObject({
      error_code: code,
    });
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new UnitTypesService(
      { lodging_unit_types: unitTypes } as any,
      productsService as any,
    );
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, user_id: 9 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('crea el tipo y su servicio "Noche – {tipo}" no inventariable', async () => {
    unitTypes.findFirst
      .mockResolvedValueOnce(null) // nombre libre
      .mockResolvedValueOnce({ id: 11, name: dto.name }); // lectura final
    productsService.create.mockResolvedValue({ id: 40 });
    unitTypes.create.mockResolvedValue({ id: 11 });

    const result = await service.create(dto);

    expect(productsService.create).toHaveBeenCalledWith({
      name: 'Noche – Doble estándar',
      base_price: 250000,
      product_type: 'service',
      requires_booking: false,
      available_for_ecommerce: false,
      tax_category_ids: [7],
    });
    expect(unitTypes.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: 5,
        product_id: 40,
        name: 'Doble estándar',
        base_occupancy: 2,
        max_adults: 3,
        max_children: 1,
        max_occupancy: 4,
        bed_config: '1 doble + 1 sencilla',
      }),
    });
    expect(result).toEqual({ id: 11, name: dto.name });
  });

  it('rechaza máximo de adultos 0 sin crear producto', async () => {
    await expectCode(
      service.create({ ...dto, max_adults: 0, max_children: 0 }),
      'LODGING_UNIT_TYPE_CAPACITY_001',
    );
    expect(productsService.create).not.toHaveBeenCalled();
    expect(unitTypes.create).not.toHaveBeenCalled();
  });

  it('el DTO muestra "La capacidad máxima debe ser mayor que cero"', async () => {
    const errors = await validate(
      plainToInstance(CreateUnitTypeDto, { ...dto, max_adults: 0 }),
    );
    const messages = errors.flatMap((e) => Object.values(e.constraints ?? {}));
    expect(messages).toContain(MAX_CAPACITY_MESSAGE);
    expect(MAX_CAPACITY_MESSAGE).toBe(
      'La capacidad máxima debe ser mayor que cero',
    );
  });

  it('rechaza un nombre repetido en la tienda', async () => {
    unitTypes.findFirst.mockResolvedValueOnce({ id: 3 });
    await expectCode(service.create(dto), 'LODGING_UNIT_TYPE_DUP_001');
    expect(productsService.create).not.toHaveBeenCalled();
  });

  it('archiva el producto si el tipo no se pudo guardar', async () => {
    unitTypes.findFirst.mockResolvedValueOnce(null);
    productsService.create.mockResolvedValue({ id: 40 });
    productsService.remove.mockResolvedValue(undefined);
    unitTypes.create.mockRejectedValue(new Error('db down'));

    await expect(service.create(dto)).rejects.toThrow('db down');
    expect(productsService.remove).toHaveBeenCalledWith(40);
  });

  it('lista los tipos con el conteo de habitaciones activas', async () => {
    unitTypes.findMany.mockResolvedValue([{ id: 11, _count: { units: 2 } }]);
    const result = await service.findAll();
    expect(unitTypes.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { units: { where: { is_active: true } } } },
        }),
      }),
    );
    expect(result[0]._count.units).toBe(2);
  });

  it('un tipo de otra tienda no existe para el cliente con scope (404)', async () => {
    unitTypes.findFirst.mockResolvedValue(null);
    await expectCode(service.findOne(99), 'LODGING_UNIT_TYPE_FIND_001');
    expect(unitTypes.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 99 } }),
    );
  });

  it('al editar nombre y precio actualiza el producto noche', async () => {
    const current = {
      id: 11,
      product_id: 40,
      name: 'Doble estándar',
      base_occupancy: 2,
      max_adults: 3,
      max_children: 1,
      max_occupancy: 4,
    };
    unitTypes.findFirst
      .mockResolvedValueOnce(current) // findOne inicial
      .mockResolvedValueOnce(null) // nombre libre
      .mockResolvedValueOnce({ ...current, name: 'Doble superior' });
    unitTypes.update.mockResolvedValue({});

    await service.update(11, { name: 'Doble superior', base_price: 280000 });

    expect(productsService.update).toHaveBeenCalledWith(40, {
      name: 'Noche – Doble superior',
      slug: 'noche-doble-superior',
      base_price: 280000,
    });
    expect(unitTypes.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ name: 'Doble superior', max_occupancy: 4 }),
    });
  });

  it('al editar solo la capacidad no toca el producto', async () => {
    unitTypes.findFirst.mockResolvedValue({
      id: 11,
      product_id: 40,
      name: 'Doble estándar',
      base_occupancy: 2,
      max_adults: 3,
      max_children: 1,
      max_occupancy: 4,
    });
    await service.update(11, { max_adults: 2 });
    expect(productsService.update).not.toHaveBeenCalled();
    expect(unitTypes.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ max_adults: 2, max_occupancy: 3 }),
    });
  });
});
