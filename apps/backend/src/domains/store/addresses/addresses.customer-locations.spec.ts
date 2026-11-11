import { BadRequestException } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AddressesService } from './addresses.service';
import { CreateCustomerLocationDto } from './dto';

type Row = {
  id: number;
  store_id: number;
  user_id: number | null;
  is_primary: boolean;
  type: string;
  address_line1: string;
  city: string;
  label?: string | null;
};

describe('AddressesService customer locations', () => {
  let rows: Row[];
  let prisma: any;
  let service: AddressesService;
  let nextId: number;

  const dto = (
    extra: Partial<CreateCustomerLocationDto> = {},
  ): CreateCustomerLocationDto => ({
    address_line_1: 'Calle 10 # 5-20',
    city: 'Medellín',
    state: 'Antioquia',
    country: 'CO',
    label: 'Sede Norte',
    ...extra,
  });

  beforeEach(() => {
    nextId = 100;
    rows = [
      {
        id: 1,
        store_id: 10,
        user_id: 101,
        is_primary: true,
        type: 'shipping',
        address_line1: 'Carrera 1 # 2-3',
        city: 'Bogotá',
      },
    ];
    jest
      .spyOn(RequestContextService, 'getContext')
      .mockReturnValue({ store_id: 10, organization_id: 7 } as any);
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (cb) => cb(prisma)),
      users: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          (where.id === 101 || where.id === 202) && where.organization_id === 7
            ? { id: where.id }
            : null,
        ),
      },
      store_users: { upsert: jest.fn().mockResolvedValue({}) },
      orders: { count: jest.fn().mockResolvedValue(0) },
      sales_orders: { count: jest.fn().mockResolvedValue(0) },
      bookings: { count: jest.fn().mockResolvedValue(0) },
      addresses: {
        findMany: jest.fn().mockImplementation(({ where }) =>
          rows.filter(
            (r) =>
              (where.store_id === undefined || r.store_id === where.store_id) &&
              (where.user_id === undefined || r.user_id === where.user_id) &&
              (where.type === undefined || r.type === where.type),
          ),
        ),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockImplementation(({ where }) => {
          if (where.id !== undefined) {
            return rows.find((r) => r.id === where.id) ?? null;
          }
          return (
            rows
              .filter(
                (r) =>
                  r.store_id === where.store_id &&
                  r.user_id === where.user_id &&
                  r.type === where.type,
              )
              .sort((a, b) => b.id - a.id)[0] ?? null
          );
        }),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          for (const r of rows) {
            if (
              r.store_id === where.store_id &&
              r.user_id === where.user_id &&
              (where.type === undefined || r.type === where.type) &&
              r.is_primary === where.is_primary
            ) {
              Object.assign(r, data);
            }
          }
          return { count: 1 };
        }),
        create: jest.fn().mockImplementation(({ data }) => {
          const row = { id: nextId++, ...data };
          rows.push(row);
          return row;
        }),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = rows.find((r) => r.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
        delete: jest.fn().mockImplementation(({ where }) => {
          rows = rows.filter((r) => r.id !== where.id);
        }),
      },
    };
    service = new AddressesService(
      prisma as StorePrismaService,
      {} as AccessValidationService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('adds a second location as shipping with its label, keeping the first as primary', async () => {
    const result = await service.addCustomerLocation(101, dto());

    expect(result.created).toBe(true);
    expect(result.address).toMatchObject({
      type: 'shipping',
      label: 'Sede Norte',
      user_id: 101,
      store_id: 10,
      is_primary: false,
    });
    expect(rows.find((r) => r.id === 1)!.is_primary).toBe(true);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'address_primary:10:101',
    );
  });

  it('makes the first location of a customer primary and links the customer to the store', async () => {
    const result = await service.addCustomerLocation(202, dto());

    expect(result.address.is_primary).toBe(true);
    expect(prisma.store_users.upsert).toHaveBeenCalledWith({
      where: { store_id_user_id: { store_id: 10, user_id: 202 } },
      create: { store_id: 10, user_id: 202 },
      update: {},
    });
  });

  it('does not duplicate an identical address (case and accents ignored)', async () => {
    const result = await service.addCustomerLocation(
      101,
      dto({ address_line_1: 'CARRERA 1 # 2-3', city: 'bogota' }),
    );

    expect(result).toEqual({ address: rows[0], created: false });
    expect(prisma.addresses.create).not.toHaveBeenCalled();
  });

  it('moves the primary mark when the new location is requested as primary', async () => {
    const result = await service.addCustomerLocation(
      101,
      dto({ is_primary: true }),
    );

    expect(result.address.is_primary).toBe(true);
    expect(rows.find((r) => r.id === 1)!.is_primary).toBe(false);
  });

  it('keeps the fiscal (billing) primary when a new location becomes primary', async () => {
    rows.push({
      id: 2,
      store_id: 10,
      user_id: 101,
      is_primary: true,
      type: 'billing',
      address_line1: 'Calle fiscal 1',
      city: 'Bogotá',
    });
    await service.addCustomerLocation(101, dto({ is_primary: true }));

    expect(rows.find((r) => r.id === 2)!.is_primary).toBe(true);
    expect(rows.find((r) => r.id === 1)!.is_primary).toBe(false);
  });

  it('excludes archived customers from the lookup', async () => {
    await service.addCustomerLocation(101, dto());
    expect(prisma.users.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: { not: 'archived' } }),
      }),
    );
  });

  it('rejects a customer from another organization', async () => {
    await expect(service.addCustomerLocation(999, dto())).rejects.toMatchObject({
      errorCode: 'ADDR_CUSTOMER_NOT_IN_STORE_001',
    });
    expect(prisma.addresses.create).not.toHaveBeenCalled();
  });

  it('filters the address list by customer', async () => {
    prisma.addresses.findMany = jest.fn().mockResolvedValue([]);
    await service.findAll({ customer_id: 101 } as any, {});
    expect(prisma.addresses.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 101 } }),
    );
  });

  it('refuses to delete a location used in a sales order with a clear message', async () => {
    prisma.sales_orders.count.mockResolvedValue(1);
    await expect(service.remove(1, {})).rejects.toThrow(
      new BadRequestException(
        'Esta ubicación está usada en órdenes o reservas; no se puede eliminar. Puedes editarla o marcar otra como principal.',
      ),
    );
    expect(prisma.addresses.delete).not.toHaveBeenCalled();
  });

  it('promotes the newest remaining location when the primary is deleted', async () => {
    await service.addCustomerLocation(101, dto());
    await service.remove(1, {});

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 100, is_primary: true });
  });

  it('saves label and phone on update, and clears them with an empty value', async () => {
    await service.update(1, { label: 'Bodega', phone_number: '300 1' }, {});
    expect(rows[0]).toMatchObject({ label: 'Bodega', phone_number: '300 1' });

    await service.update(1, { label: '' }, {});
    expect(rows[0].label).toBeNull();
  });
});
