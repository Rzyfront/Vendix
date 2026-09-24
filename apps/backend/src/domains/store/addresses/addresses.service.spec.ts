import { RequestContextService } from '@common/context/request-context.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto';

describe('AddressesService primary address isolation', () => {
  const rows = [
    { id: 1, store_id: 10, user_id: 101, is_primary: true },
    { id: 2, store_id: 10, user_id: 202, is_primary: true },
    { id: 3, store_id: 10, user_id: 101, is_primary: false },
  ];
  let addresses: typeof rows;
  let prisma: any;
  let service: AddressesService;
  const dto = (extra: Partial<CreateAddressDto> = {}): CreateAddressDto => ({
    address_line_1: 'Calle 1', city: 'Bogotá', state: 'Bogotá', country: 'CO',
    ...extra,
  });
  const primaryCount = () => addresses.filter((row) => row.is_primary).length;

  beforeEach(() => {
    addresses = rows.map((row) => ({ ...row }));
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 10 } as any);
    prisma = {
      $executeRawUnsafe: jest.fn().mockResolvedValue(0),
      $transaction: jest.fn(async (callback) => {
        const before = addresses.map((row) => ({ ...row }));
        try {
          return await callback(prisma);
        } catch (error) {
          addresses = before;
          throw error;
        }
      }),
      users: { findFirst: jest.fn().mockImplementation(({ where }) =>
        where.id === 101 ? { id: 101 } : null),
      },
      addresses: {
        findFirst: jest.fn().mockImplementation(({ where }) =>
          addresses.find((row) => row.id === where.id) ?? null),
        updateMany: jest.fn().mockImplementation(({ where, data }) => {
          let count = 0;
          for (const row of addresses) {
            if (row.is_primary === where.is_primary &&
                (where.store_id === undefined || row.store_id === where.store_id) &&
                (where.user_id === undefined || row.user_id === where.user_id) &&
                (where.id?.not === undefined || row.id !== where.id.not)) {
              row.is_primary = data.is_primary;
              count++;
            }
          }
          return { count };
        }),
        create: jest.fn().mockImplementation(({ data }) => data),
        update: jest.fn().mockImplementation(({ where, data }) => {
          const row = addresses.find((item) => item.id === where.id)!;
          Object.assign(row, data);
          return row;
        }),
      },
    };
    service = new AddressesService(
      prisma as StorePrismaService,
      {} as AccessValidationService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects primary without a customer without clearing anyone else', async () => {
    await expect(service.create(dto({ is_primary: true }), {})).rejects.toMatchObject({
      errorCode: 'ADDR_PRIMARY_REQUIRES_CUSTOMER_001',
    });
    expect(prisma.addresses.updateMany).not.toHaveBeenCalled();
    expect(prisma.addresses.create).not.toHaveBeenCalled();
    expect(primaryCount()).toBe(2);
  });

  it('clears only the same customer on create', async () => {
    await service.create(dto({ customer_id: 101, is_primary: true }), {});
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'address_primary:10:101',
    );
    expect(prisma.addresses.updateMany).toHaveBeenCalledWith({
      where: { is_primary: true, store_id: 10, user_id: 101 },
      data: { is_primary: false },
    });
    expect(addresses[1].is_primary).toBe(true);
  });

  it('keeps the existing primary if creating its replacement fails', async () => {
    prisma.addresses.create.mockRejectedValue(new Error('create failed'));

    await expect(service.create(dto({ customer_id: 101, is_primary: true }), {}))
      .rejects.toThrow('create failed');

    expect(addresses[0].is_primary).toBe(true);
    expect(addresses[1].is_primary).toBe(true);
    expect(primaryCount()).toBe(2);
  });

  it('clears only the address owner on update', async () => {
    await service.update(3, { is_primary: true }, {});
    expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      'address_primary:10:101',
    );
    expect(prisma.addresses.updateMany).toHaveBeenCalledWith({
      where: { is_primary: true, store_id: 10, user_id: 101, id: { not: 3 } },
      data: { is_primary: false },
    });
    expect(primaryCount()).toBe(2);
    expect(addresses[1].is_primary).toBe(true);
  });

  it('keeps the existing primary if updating its replacement fails', async () => {
    prisma.addresses.update.mockRejectedValue(new Error('update failed'));

    await expect(service.update(3, { is_primary: true }, {}))
      .rejects.toThrow('update failed');

    expect(addresses[0].is_primary).toBe(true);
    expect(addresses[1].is_primary).toBe(true);
    expect(primaryCount()).toBe(2);
  });

  it('rejects primary update of an address without owner', async () => {
    addresses.push({ id: 4, store_id: 10, user_id: null as any, is_primary: false });
    await expect(service.update(4, { is_primary: true }, {})).rejects.toMatchObject({
      errorCode: 'ADDR_PRIMARY_REQUIRES_CUSTOMER_001',
    });
    expect(prisma.addresses.updateMany).not.toHaveBeenCalled();
    expect(primaryCount()).toBe(2);
  });

  it('rejects a customer outside this store with a typed error', async () => {
    await expect(service.create(dto({ customer_id: 999, is_primary: true }), {})).rejects.toMatchObject({
      errorCode: 'ADDR_CUSTOMER_NOT_IN_STORE_001',
    });
    expect(prisma.addresses.updateMany).not.toHaveBeenCalled();
    expect(primaryCount()).toBe(2);
  });
});
