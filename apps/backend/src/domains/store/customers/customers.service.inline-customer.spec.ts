import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { VendixHttpException } from '../../../common/errors';
import * as bcrypt from 'bcrypt';

/**
 * `resolveInlineCustomer` — alta del cliente capturado en línea en
 * Facturas → Nueva factura (incidente Tecnicell: cliente NIT nuevo → 500).
 *
 * Fija el contrato que el camino inline comparte con el modal de clientes:
 * jurídica ⇔ NIT con nombres en '' y razón social obligatoria, natural con
 * nombres, y documento repetido en la organización ⇒ se reutiliza la ficha.
 */
describe('CustomersService.resolveInlineCustomer', () => {
  const prisma = {
    stores: { findUnique: jest.fn() },
    users: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    roles: { findFirst: jest.fn() },
    store_users: { upsert: jest.fn() },
    addresses: { create: jest.fn() },
  };
  const eventEmitter = { emit: jest.fn() };
  let service: CustomersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CustomersService(prisma as any, eventEmitter as any);
    prisma.stores.findUnique.mockResolvedValue({ id: 7, organization_id: 3 });
    prisma.users.findFirst.mockResolvedValue(null);
    prisma.users.findUnique.mockResolvedValue(null);
    prisma.roles.findFirst.mockResolvedValue({ id: 5, name: 'customer' });
    prisma.users.create.mockImplementation(async ({ data }) => ({
      id: 99,
      ...data,
    }));
    jest.spyOn(bcrypt, 'hash').mockResolvedValue('hashed' as never);
    prisma.addresses.create.mockResolvedValue({ id: 500 });
  });

  afterEach(() => jest.restoreAllMocks());

  const createdData = () => prisma.users.create.mock.calls[0][0].data;

  it('crea una persona jurídica con NIT: nombres en "", razón social y DV separados', async () => {
    const result = await service.resolveInlineCustomer(7, {
      document_type: 'NIT',
      document_number: '900123456',
      verification_digit: '8',
      person_type: 'JURIDICA',
      legal_name: 'Tecnicell S.A.S.',
    } as CreateCustomerDto);

    expect(result).toEqual({ customer_id: 99, was_created: true });
    const data = createdData();
    expect(data.first_name).toBe('');
    expect(data.last_name).toBe('');
    expect(data.legal_name).toBe('Tecnicell S.A.S.');
    expect(data.person_type).toBe('JURIDICA');
    expect(data.document_number).toBe('900123456');
    expect(data.verification_digit).toBe('8');
    // Vinculado a la tienda y con rol customer, igual que el modal de clientes.
    expect(data.store_users).toEqual({ create: { store_id: 7 } });
    expect(data.user_roles).toEqual({ create: { role_id: 5 } });
  });

  it('infiere jurídica por NIT sin nombres y exige razón social (400, no 500)', async () => {
    const promise = service.resolveInlineCustomer(7, {
      document_type: 'NIT',
      document_number: '900123456',
    } as CreateCustomerDto);

    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    await promise.catch((err: VendixHttpException) => {
      expect(err.errorCode).toBe('CUST_VALIDATE_001');
      expect(err.getStatus()).toBe(400);
    });
    expect(prisma.users.create).not.toHaveBeenCalled();
  });

  it('crea una persona natural con nombres y sin razón social', async () => {
    const result = await service.resolveInlineCustomer(7, {
      document_type: 'CC',
      document_number: '1020304050',
      person_type: 'NATURAL',
      first_name: 'ana',
      last_name: 'pérez',
    } as CreateCustomerDto);

    expect(result.was_created).toBe(true);
    const data = createdData();
    expect(data.first_name).toBe('Ana');
    expect(data.last_name).toBe('Pérez');
    expect(data.legal_name).toBeNull();
    expect(data.person_type).toBe('NATURAL');
  });

  it('documento ya existente en la organización: reutiliza la ficha y la vincula a la tienda', async () => {
    prisma.users.findFirst.mockResolvedValueOnce({ id: 41 });

    const result = await service.resolveInlineCustomer(7, {
      document_type: 'NIT',
      document_number: '900.123.456-8',
      person_type: 'JURIDICA',
      legal_name: 'Otra razón social',
    } as CreateCustomerDto);

    expect(result).toEqual({ customer_id: 41, was_created: false });
    expect(prisma.users.create).not.toHaveBeenCalled();
    // Búsqueda por tipo + número SIN el DV pegado, dentro de la organización.
    const where = prisma.users.findFirst.mock.calls[0][0].where;
    expect(where.organization_id).toBe(3);
    expect(where.document_type).toBe('NIT');
    expect(where.document_number).toEqual({
      equals: '900123456',
      mode: 'insensitive',
    });
    expect(prisma.store_users.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: { user_id: 41, store_id: 7 },
      }),
    );
  });

  it('correo ya tomado por otro cliente: 409 SYS_CONFLICT_001, nunca 500', async () => {
    // 1ª búsqueda: por documento (sin coincidencia). 2ª: por correo en create().
    prisma.users.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 12,
        document_number: '900123456',
        document_type: 'NIT',
      });

    const promise = service.resolveInlineCustomer(7, {
      email: 'compras@tecnicell.co',
      document_type: 'CC',
      document_number: '1020304050',
      first_name: 'Ana',
      last_name: 'Pérez',
    } as CreateCustomerDto);

    await promise.catch((err: VendixHttpException) => {
      expect(err.errorCode).toBe('SYS_CONFLICT_001');
      expect(err.getStatus()).toBe(409);
      expect(err.getResponse()).toEqual({
        error_code: 'SYS_CONFLICT_001',
        message: 'Ya existe un cliente con ese correo; selecciónalo.',
        details: {
          kind: 'email',
          value: 'compras@tecnicell.co',
          existing_customer_id: 12,
          existing_customer_document_number: '900123456',
          existing_customer_document_type: 'NIT',
          existing_customer: expect.objectContaining({
            id: 12,
            document_number: '900123456',
            document_type: 'NIT',
            addresses: [],
            billing_address: null,
          }),
        },
      });
    });
    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    expect(prisma.users.create).not.toHaveBeenCalled();
    expect(prisma.users.findFirst.mock.calls[1][0].where).toMatchObject({
      organization_id: 3,
      email: { equals: 'compras@tecnicell.co', mode: 'insensitive' },
      state: { not: 'archived' },
    });
  });

  it('correo de cliente sin documento de otra tienda: snapshot público seleccionable sin vincular ni filtrar secretos', async () => {
    prisma.users.findFirst.mockResolvedValueOnce({
      id: 12,
      first_name: 'Ana',
      last_name: 'Pérez',
      email: 'ana@cliente.co',
      document_type: null,
      document_number: null,
      person_type: 'NATURAL',
      phone: '3001234567',
      store_users: [{ store_id: 99 }],
      password: 'NEVER_RETURN_HASH',
      two_factor_secret: 'NEVER_RETURN_TOTP',
      addresses: [
        { id: 90, type: 'shipping', address_line1: 'NO EXPONER ENVIO', is_primary: true },
        {
          id: 91,
          type: 'billing',
          address_line1: 'Calle fiscal 12',
          city: 'Bogotá',
          country_code: 'CO',
          municipality_code: '11001',
          is_primary: true,
        },
      ],
    });

    let failure: VendixHttpException | undefined;
    await service.resolveInlineCustomer(7, {
      email: 'ana@cliente.co',
      first_name: 'Otra persona',
    } as CreateCustomerDto).catch((error: VendixHttpException) => { failure = error; });

    expect(failure).toBeInstanceOf(VendixHttpException);
    expect(failure?.getStatus()).toBe(409);
    const details = (failure?.getResponse() as { details: Record<string, any> }).details;
    expect(details.existing_customer_document_number).toBeNull();
    expect(details.existing_customer).toMatchObject({
      id: 12,
      first_name: 'Ana',
      last_name: 'Pérez',
      email: 'ana@cliente.co',
      document_number: null,
      person_type: 'NATURAL',
      phone: '3001234567',
      addresses: [],
      billing_address: {
        type: 'billing',
        address_line1: 'Calle fiscal 12',
        municipality_code: '11001',
      },
    });
    for (const field of ['password', 'two_factor_secret', 'store_users']) {
      expect(details.existing_customer).not.toHaveProperty(field);
    }
    expect(JSON.stringify(details)).not.toContain('NO EXPONER ENVIO');
    expect(prisma.store_users.upsert).not.toHaveBeenCalled();
    expect(prisma.users.create).not.toHaveBeenCalled();
    const query = prisma.users.findFirst.mock.calls[0][0];
    expect(query.where.organization_id).toBe(3);
    expect(query.select).not.toHaveProperty('password');
    expect(query.select).not.toHaveProperty('two_factor_secret');
    expect(query.select.addresses.where).toEqual({ type: 'billing' });
  });

  describe('dirección fiscal de la factura (6b)', () => {
    const natural = {
      document_type: 'CC',
      document_number: '1020304050',
      first_name: 'Ana',
      last_name: 'Pérez',
    } as CreateCustomerDto;
    const billing_address = {
      address_line1: ' Cra 43A # 1-50 ',
      city: 'Medellín',
      state_province: 'Antioquia',
      municipality_code: '05001',
      country_code: 'CO',
    };

    it('cliente nuevo: nace vinculado a la tienda, con rol customer y su dirección billing primaria', async () => {
      const result = await service.resolveInlineCustomer(7, natural, {
        billing_address,
      });

      expect(result).toEqual({ customer_id: 99, was_created: true });
      const data = createdData();
      expect(data.store_users).toEqual({ create: { store_id: 7 } });
      expect(data.user_roles).toEqual({ create: { role_id: 5 } });
      expect(prisma.addresses.create).toHaveBeenCalledTimes(1);
      expect(prisma.addresses.create.mock.calls[0][0].data).toEqual({
        address_line1: 'Cra 43A # 1-50',
        city: 'Medellín',
        state_province: 'Antioquia',
        country_code: 'CO',
        postal_code: null,
        municipality_code: '05001',
        type: 'billing',
        is_primary: true,
        store_id: 7,
        organization_id: null,
        user_id: 99,
      });
    });

    it('sin address_line no graba dirección', async () => {
      await service.resolveInlineCustomer(7, natural, {
        billing_address: { address_line1: '   ', city: 'Medellín' },
      });
      await service.resolveInlineCustomer(7, natural);

      expect(prisma.users.create).toHaveBeenCalledTimes(2);
      expect(prisma.addresses.create).not.toHaveBeenCalled();
    });

    it('si grabar la dirección falla, el cliente igual queda creado (no bloquea)', async () => {
      prisma.addresses.create.mockRejectedValueOnce(new Error('db down'));
      const warn = jest
        .spyOn((service as any).logger, 'warn')
        .mockImplementation(() => undefined);

      const result = await service.resolveInlineCustomer(7, natural, {
        billing_address,
      });

      expect(result).toEqual({ customer_id: 99, was_created: true });
      expect(warn).toHaveBeenCalled();
    });

    it('cliente existente por documento: no crea ni toca su ficha/direcciones, sólo upsert de store_users', async () => {
      prisma.users.findFirst.mockResolvedValueOnce({ id: 41, addresses: [] });

      const result = await service.resolveInlineCustomer(7, natural, {
        billing_address,
      });

      expect(result).toEqual({ customer_id: 41, was_created: false });
      expect(prisma.users.create).not.toHaveBeenCalled();
      expect(prisma.addresses.create).not.toHaveBeenCalled();
      expect(prisma.store_users.upsert).toHaveBeenCalledWith({
        where: { user_id_store_id: { user_id: 41, store_id: 7 } },
        create: { user_id: 41, store_id: 7 },
        update: {},
      });
    });
  });
});
