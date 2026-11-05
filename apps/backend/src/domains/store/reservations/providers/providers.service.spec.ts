import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Proveedores de servicio como usuarios de tienda: el proveedor puede ser
 * cualquier usuario de la tienda que no sea cliente; los proveedores de
 * empleado existentes siguen funcionando.
 */
describe('ProvidersService — proveedores como usuarios de tienda', () => {
  const STORE_ID = 7;
  let prisma: any;
  let service: ProvidersService;

  beforeEach(() => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({
      store_id: STORE_ID,
    } as any);
    prisma = {
      users: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      employees: { findFirst: jest.fn() },
      service_providers: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }) => ({ id: 1, ...data })),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 1, ...data })),
      },
      service_stations: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
      service_station_providers: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    service = new ProvidersService(prisma as unknown as StorePrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  const staffWhere = {
    state: 'active',
    store_users: { some: { store_id: STORE_ID } },
    user_roles: {
      some: {
        OR: [{ store_id: null }, { store_id: STORE_ID }],
        roles: { name: { not: 'customer' } },
      },
    },
  };

  it('crea el proveedor por user_id con el nombre del usuario por defecto', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });

    const created = await service.create({ user_id: 31 } as any);

    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31, ...staffWhere } }),
    );
    expect(prisma.service_providers.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          store_id: STORE_ID,
          user_id: 31,
          display_name: 'Ana Ruiz',
        }),
        include: expect.objectContaining({ user: expect.any(Object) }),
      }),
    );
    expect(created).toMatchObject({ user_id: 31 });
    expect(prisma.service_providers.create.mock.calls[0][0].data.employee_id).toBeUndefined();
  });

  it('respeta el display_name enviado', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });

    await service.create({ user_id: 31, display_name: 'Anita' } as any);

    expect(prisma.service_providers.create.mock.calls[0][0].data.display_name).toBe('Anita');
  });

  it('rechaza un usuario que no es de la tienda o es solo cliente', async () => {
    prisma.users.findFirst.mockResolvedValue(null);

    const promise = service.create({ user_id: 99 } as any);
    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    await expect(promise).rejects.toThrow('El usuario no pertenece a esta tienda o es un cliente');
    expect(prisma.service_providers.create).not.toHaveBeenCalled();
  });

  it('rechaza un usuario que ya es proveedor de la tienda', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });
    prisma.service_providers.findFirst.mockResolvedValue({ id: 5 });

    await expect(service.create({ user_id: 31 } as any)).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.service_providers.create).not.toHaveBeenCalled();
  });

  it('user_id y employee_id a la vez responde 400 (no ignora ninguno en silencio)', async () => {
    const promise = service.create({ user_id: 31, employee_id: 4 } as any);
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.toThrow('Envía user_id o employee_id, no ambos');
    expect(prisma.service_providers.create).not.toHaveBeenCalled();
  });

  it('alta concurrente: el P2002 del índice único se traduce a 409', async () => {
    prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });
    prisma.service_providers.create.mockRejectedValueOnce(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    await expect(service.create({ user_id: 31 } as any)).rejects.toBeInstanceOf(ConflictException);
  });

  it('sin user_id ni employee_id responde 400 con mensaje claro', async () => {
    await expect(service.create({} as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('el alta por employee_id (legado) sigue funcionando igual', async () => {
    prisma.employees.findFirst.mockResolvedValue({ id: 4, first_name: 'Luis', last_name: 'Gil', user_id: 40 });

    await service.create({ employee_id: 4 } as any);

    const data = prisma.service_providers.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ store_id: STORE_ID, employee_id: 4, display_name: 'Luis Gil' });
    expect(data.user_id).toBeUndefined();
    expect(prisma.users.findFirst).not.toHaveBeenCalled();
  });

  it('available-users lista usuarios no clientes de la tienda sin proveedor', async () => {
    prisma.service_providers.findMany.mockResolvedValue([{ user_id: 31 }, { user_id: null }]);

    await service.getAvailableUsers();

    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ...staffWhere, id: { notIn: [31] } },
        select: { id: true, first_name: true, last_name: true, email: true, avatar_url: true },
      }),
    );
  });

  it('available-employees ignora proveedores sin empleado (no rompe con null)', async () => {
    prisma.service_providers.findMany.mockResolvedValue([{ employee_id: 4 }, { employee_id: null }]);
    prisma.employees.findMany = jest.fn().mockResolvedValue([]);

    await service.getAvailableEmployees();

    expect(prisma.employees.findMany.mock.calls[0][0].where.id).toEqual({ notIn: [4] });
  });

  describe('estación asignada (S10)', () => {
    const provider = (default_station_id: number | null = null) => ({ id: 1, store_id: STORE_ID, default_station_id });

    it('update acepta una estación vinculada al proveedor y la guarda', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider());
      prisma.service_stations.findFirst.mockResolvedValue({ id: 4 });
      prisma.service_station_providers.findFirst.mockResolvedValue({ id: 9 });

      await service.update(1, { default_station_id: 4 } as any);

      expect(prisma.service_stations.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 4, store_id: STORE_ID } }),
      );
      expect(prisma.service_station_providers.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { store_id: STORE_ID, provider_id: 1, station_id: 4 } }),
      );
      expect(prisma.service_providers.update.mock.calls[0][0].data.default_station_id).toBe(4);
    });

    it('update rechaza una estación de otra tienda con STATION_004', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider());
      prisma.service_stations.findFirst.mockResolvedValue(null);

      await expect(service.update(1, { default_station_id: 99 } as any)).rejects.toMatchObject({ errorCode: 'STATION_004' });
      expect(prisma.service_providers.update).not.toHaveBeenCalled();
    });

    it('update rechaza una estación no vinculada al proveedor con STATION_001', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider());
      prisma.service_stations.findFirst.mockResolvedValue({ id: 4 });
      prisma.service_station_providers.findFirst.mockResolvedValue(null);

      await expect(service.update(1, { default_station_id: 4 } as any)).rejects.toMatchObject({ errorCode: 'STATION_001' });
      expect(prisma.service_providers.update).not.toHaveBeenCalled();
    });

    it('update con null limpia la estación asignada sin validar nada', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider(4));

      await service.update(1, { default_station_id: null } as any);

      expect(prisma.service_providers.update.mock.calls[0][0].data.default_station_id).toBeNull();
      expect(prisma.service_stations.findFirst).not.toHaveBeenCalled();
    });

    it('update sin default_station_id no la toca (comportamiento previo)', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider(4));

      await service.update(1, { bio: 'hola' } as any);

      expect('default_station_id' in prisma.service_providers.update.mock.calls[0][0].data).toBe(false);
    });

    it('create con estación de la tienda la guarda y deja el vínculo proveedor-estación', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });
      prisma.service_stations.findFirst.mockResolvedValue({ id: 4 });

      await service.create({ user_id: 31, default_station_id: 4 } as any);

      expect(prisma.service_providers.create.mock.calls[0][0].data.default_station_id).toBe(4);
      expect(prisma.service_station_providers.create).toHaveBeenCalledWith({
        data: { store_id: STORE_ID, provider_id: 1, station_id: 4 },
      });
    });

    it('create con una estación ajena responde STATION_004 y no crea nada', async () => {
      prisma.users.findFirst.mockResolvedValue({ id: 31, first_name: 'Ana', last_name: 'Ruiz' });
      prisma.service_stations.findFirst.mockResolvedValue(null);

      await expect(service.create({ user_id: 31, default_station_id: 99 } as any)).rejects.toMatchObject({ errorCode: 'STATION_004' });
      expect(prisma.service_providers.create).not.toHaveBeenCalled();
    });

    it('setStations limpia la asignada cuando su vínculo desaparece', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider(4));
      prisma.service_stations.findMany.mockResolvedValue([{ id: 5 }]);

      await service.setStations(1, [5]);

      expect(prisma.service_providers.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ default_station_id: null }) }),
      );
    });

    it('setStations conserva la asignada si sigue vinculada', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider(4));
      prisma.service_stations.findMany.mockResolvedValue([{ id: 4 }, { id: 5 }]);

      await service.setStations(1, [4, 5]);

      expect(prisma.service_providers.update).not.toHaveBeenCalled();
      expect(prisma.service_station_providers.createMany).toHaveBeenCalled();
    });

    it('removeStation limpia la asignada si era esa estación y no otra', async () => {
      prisma.service_providers.findFirst.mockResolvedValue(provider(4));
      await service.removeStation(1, 5);
      expect(prisma.service_providers.update).not.toHaveBeenCalled();

      await service.removeStation(1, 4);
      expect(prisma.service_station_providers.deleteMany).toHaveBeenLastCalledWith({
        where: { store_id: STORE_ID, provider_id: 1, station_id: 4 },
      });
      expect(prisma.service_providers.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 1 }, data: expect.objectContaining({ default_station_id: null }) }),
      );
    });
  });
});
