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
      .mockResolvedValueOnce({ id: 12 });

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
    });
    await expect(promise).rejects.toBeInstanceOf(VendixHttpException);
    expect(prisma.users.create).not.toHaveBeenCalled();
  });
});
