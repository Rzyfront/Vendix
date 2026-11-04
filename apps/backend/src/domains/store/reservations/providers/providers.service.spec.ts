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
      },
    };
    service = new ProvidersService(prisma as unknown as StorePrismaService);
  });

  afterEach(() => jest.restoreAllMocks());

  const staffWhere = {
    state: 'active',
    store_users: { some: { store_id: STORE_ID } },
    user_roles: { some: { roles: { name: { not: 'customer' } } } },
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
});
