import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException } from '@common/errors';
import { UnitTypesService } from './unit-types.service';
import { CreateUnitTypeDto, MAX_CAPACITY_MESSAGE } from './dto';
import { normalizeLodgingImageKeys } from './lodging-media';

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
  const storeSettings = { findFirst: jest.fn() };
  const s3Service = {
    signUrl: jest.fn(async (key: string) => `https://signed/${key}`),
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
      { lodging_unit_types: unitTypes, store_settings: storeSettings } as any,
      productsService as any,
      s3Service as any,
    );
    s3Service.signUrl.mockImplementation(async (key) => `https://signed/${key}`);
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 5, organization_id: 3, user_id: 9 } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('crea el tipo y su servicio "Noche – {tipo}" no inventariable', async () => {
    unitTypes.findFirst
      .mockResolvedValueOnce(null) // nombre libre
      .mockResolvedValueOnce({ id: 11, name: dto.name, images: [] }); // lectura final
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
    expect(result).toMatchObject({ id: 11, name: dto.name, image_urls: [] });
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
    unitTypes.findMany.mockResolvedValue([
      { id: 11, images: [], _count: { units: 2 } },
    ]);
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
      images: [],
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
      images: [],
    });
    await service.update(11, { max_adults: 2 });
    expect(productsService.update).not.toHaveBeenCalled();
    expect(unitTypes.update).toHaveBeenCalledWith({
      where: { id: 11 },
      data: expect.objectContaining({ max_adults: 2, max_occupancy: 3 }),
    });
  });

  // H0.4 — photos (S3 keys, signed on read) and amenities.
  describe('sobreventa (H1.6)', () => {
    const asUser = (permissions: string[]) =>
      jest
        .spyOn(RequestContextService, 'getContext')
        .mockReturnValue({ store_id: 5, user_id: 9, permissions } as any);
    const currentType = {
      id: 11,
      name: dto.name,
      product_id: 40,
      base_occupancy: 2,
      max_adults: 3,
      max_children: 1,
      max_occupancy: 4,
      images: [],
      overbooking_allowance: 0,
    };

    it('un tipo nuevo toma la sobreventa por defecto de los ajustes de Hotelería', async () => {
      storeSettings.findFirst.mockResolvedValue({
        settings: { hospitality: { default_overbooking_allowance: 2 } },
      });
      unitTypes.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(currentType);
      productsService.create.mockResolvedValue({ id: 40 });
      unitTypes.create.mockResolvedValue({ id: 11 });

      await service.create(dto);

      expect(storeSettings.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: 5 } }),
      );
      expect(unitTypes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ overbooking_allowance: 2 }),
      });
    });

    it('sin rates:write no se puede cambiar la sobreventa (403) y no se toca nada', async () => {
      asUser(['store:lodging:inventory:write']);
      unitTypes.findFirst.mockResolvedValue(currentType);

      await expectCode(
        service.update(11, { overbooking_allowance: 1 }),
        'LODGING_UNIT_TYPE_OVERBOOKING_001',
      );
      await expectCode(
        service.create({ ...dto, overbooking_allowance: 1 }),
        'LODGING_UNIT_TYPE_OVERBOOKING_001',
      );
      expect(unitTypes.update).not.toHaveBeenCalled();
      expect(productsService.create).not.toHaveBeenCalled();
      expect(productsService.update).not.toHaveBeenCalled();
    });

    it('sin rates:write se puede editar el tipo si la sobreventa no cambia', async () => {
      asUser(['store:lodging:inventory:write']);
      unitTypes.findFirst.mockResolvedValue(currentType);

      await service.update(11, { overbooking_allowance: 0, bed_config: '2 sencillas' });

      expect(unitTypes.update).toHaveBeenCalled();
    });

    it('con rates:write "Sobreventa permitida: 1" se guarda', async () => {
      asUser(['store:lodging:inventory:write', 'store:lodging:rates:write']);
      unitTypes.findFirst.mockResolvedValue(currentType);

      await service.update(11, { overbooking_allowance: 1 });

      expect(unitTypes.update).toHaveBeenCalledWith({
        where: { id: 11 },
        data: expect.objectContaining({ overbooking_allowance: 1 }),
      });
    });

    it('el DTO rechaza sobreventa negativa o mayor que 99', async () => {
      for (const overbooking_allowance of [-1, 100]) {
        const errors = await validate(
          plainToInstance(CreateUnitTypeDto, { ...dto, overbooking_allowance }),
        );
        expect(errors.map((e) => e.property)).toEqual(['overbooking_allowance']);
      }
    });
  });

  describe('fotos y amenidades', () => {
    const storeKey = (name: string) =>
      `organizations/roku-3/stores/roku-5/lodging/${name}`;

    it('acepta claves de la carpeta lodging de la tienda y normaliza URLs firmadas a clave', () => {
      const signed = `https://bucket.s3.us-east-1.amazonaws.com/${storeKey('b.jpg')}?X-Amz-Signature=abc&X-Amz-Expires=3600`;
      expect(
        normalizeLodgingImageKeys([storeKey('a.jpg'), signed], {
          organization_id: 3,
          store_id: 5,
        }),
      ).toEqual([storeKey('a.jpg'), storeKey('b.jpg')]);
    });

    it.each([
      ['otra tienda', 'organizations/roku-3/stores/otra-6/lodging/a.jpg'],
      ['otra organización', 'organizations/x-4/stores/roku-5/lodging/a.jpg'],
      ['otra carpeta', 'organizations/roku-3/stores/roku-5/products/a.jpg'],
      ['path traversal', 'organizations/roku-3/stores/roku-5/lodging/../../x.jpg'],
      ['id que solo termina igual', 'organizations/roku-13/stores/roku-15/lodging/a.jpg'],
      ['vacía', ''],
    ])('rechaza una clave de %s', (_case, key) => {
      expect(() =>
        normalizeLodgingImageKeys([key], { organization_id: 3, store_id: 5 }),
      ).toThrow(VendixHttpException);
    });

    it('el DTO rechaza claves inseguras y amenidades fuera del catálogo', async () => {
      const errors = await validate(
        plainToInstance(CreateUnitTypeDto, {
          ...dto,
          images: ['organizations/a-1/../secret.jpg'],
          amenities: ['wifi', 'jacuzzi_dorado'],
        }),
      );
      const fields = errors.map((e) => e.property);
      expect(fields).toEqual(expect.arrayContaining(['images', 'amenities']));
    });

    it('guarda las fotos en el orden elegido y las amenidades marcadas', async () => {
      unitTypes.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 11,
          images: [storeKey('2.jpg'), storeKey('1.jpg')],
          amenities: ['wifi', 'air_conditioning'],
        });
      productsService.create.mockResolvedValue({ id: 40 });
      unitTypes.create.mockResolvedValue({ id: 11 });

      const result = await service.create({
        ...dto,
        images: [storeKey('2.jpg'), storeKey('1.jpg')],
        amenities: ['wifi', 'air_conditioning'],
      });

      expect(unitTypes.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          images: [storeKey('2.jpg'), storeKey('1.jpg')],
          amenities: ['wifi', 'air_conditioning'],
        }),
      });
      expect(result.image_urls).toEqual([
        `https://signed/${storeKey('2.jpg')}`,
        `https://signed/${storeKey('1.jpg')}`,
      ]);
    });

    it('rechaza una foto de otra tienda sin crear el producto noche', async () => {
      await expectCode(
        service.create({
          ...dto,
          images: ['organizations/x-4/stores/otra-6/lodging/a.jpg'],
        }),
        'LODGING_UNIT_TYPE_IMAGE_001',
      );
      expect(productsService.create).not.toHaveBeenCalled();
    });

    it('editar solo amenidades no toca las fotos ni el producto', async () => {
      unitTypes.findFirst.mockResolvedValue({
        id: 11,
        name: dto.name,
        product_id: 40,
        base_occupancy: 2,
        max_adults: 3,
        max_children: 1,
        max_occupancy: 4,
        images: [storeKey('1.jpg')],
        amenities: [],
      });
      unitTypes.update.mockResolvedValue({ id: 11 });

      await service.update(11, { amenities: ['wifi'] });

      const data = unitTypes.update.mock.calls[0][0].data;
      expect(data.amenities).toEqual(['wifi']);
      expect(data).not.toHaveProperty('images');
      expect(productsService.update).not.toHaveBeenCalled();
    });
  });
});
