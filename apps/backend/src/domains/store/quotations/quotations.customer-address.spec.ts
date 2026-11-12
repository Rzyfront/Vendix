import { BadRequestException } from '@nestjs/common';
import { QuotationsService } from './quotations.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * S4 — la cotización guarda la ubicación (sede) elegida del cliente, la valida
 * con el cliente Prisma scoped y la lleva a la orden al convertirla.
 */
describe('QuotationsService ubicación del cliente (S4)', () => {
  const requestContext = {
    user_id: 9,
    organization_id: 1,
    store_id: 2,
    is_super_admin: false,
    is_owner: true,
  };
  const addressRow = {
    label: 'Sede Norte',
    address_line1: 'Calle 1 # 2-3',
    address_line2: null,
    city: 'Bogotá',
    state_province: 'Cundinamarca',
    country_code: 'CO',
    postal_code: '110111',
    municipality_code: '11001',
    phone_number: '3000000000',
  };

  const quotationsMock = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest
      .fn()
      .mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
    update: jest
      .fn()
      .mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data })),
  };
  const addressesMock = { findFirst: jest.fn() };
  const ordersMock = { update: jest.fn().mockResolvedValue({}) };
  const ordersService = {
    create: jest.fn().mockResolvedValue({ id: 50, order_number: 'ORD-50' }),
  };
  const service = new QuotationsService(
    {
      quotations: quotationsMock,
      addresses: addressesMock,
      orders: ordersMock,
    } as any,
    ordersService as any,
    { emit: jest.fn() } as any,
    {} as any,
    {} as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    quotationsMock.findFirst.mockResolvedValue(null);
  });

  it('create con ubicación válida guarda id y snapshot', async () => {
    addressesMock.findFirst.mockResolvedValue(addressRow);

    const result: any = await RequestContextService.run(requestContext, () =>
      service.create({
        items: [],
        customer_id: 7,
        customer_address_id: 31,
      } as any),
    );

    expect(addressesMock.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 31, user_id: 7 } }),
    );
    expect(result.customer_address_id).toBe(31);
    expect(result.customer_address_snapshot).toEqual(addressRow);
  });

  it('create con ubicación de otro cliente responde 400', async () => {
    addressesMock.findFirst.mockResolvedValue(null);

    const err = await RequestContextService.run(requestContext, () =>
      service.create({
        items: [],
        customer_id: 7,
        customer_address_id: 99,
      } as any),
    ).catch((e) => e);

    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('La ubicación no pertenece a este cliente');
    expect(quotationsMock.create).not.toHaveBeenCalled();
  });

  it('update que cambia el cliente sin ubicación limpia id y snapshot', async () => {
    jest
      .spyOn(service, 'findOne')
      .mockResolvedValue({ id: 1, status: 'draft', customer_id: 7 } as any);

    await RequestContextService.run(requestContext, () =>
      service.update(1, { customer_id: 8, notes: 'x' } as any),
    );

    const data = quotationsMock.update.mock.calls[0][0].data;
    expect(data.customer_address_id).toBeNull();
    expect(data).toHaveProperty('customer_address_snapshot');
  });

  it('convertToOrder lleva la ubicación a la orden', async () => {
    jest.spyOn(service, 'findOne').mockResolvedValue({
      id: 1,
      status: 'accepted',
      destination: 'sale',
      customer_id: 7,
      channel: 'pos',
      quotation_number: 'COT-1',
      quotation_items: [],
      customer_address_id: 31,
      customer_address_snapshot: addressRow,
    } as any);
    quotationsMock.update.mockResolvedValue({ id: 1, store_id: 2 });

    await RequestContextService.run(requestContext, () =>
      service.convertToOrder(1),
    );

    expect(ordersService.create.mock.calls[0][0].shipping_address_id).toBe(31);
    expect(ordersMock.update).toHaveBeenCalledWith({
      where: { id: 50 },
      data: { shipping_address_snapshot: addressRow },
    });
  });
});
