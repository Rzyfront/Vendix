import { Test, TestingModule } from '@nestjs/testing';
import {
  StoreBootstrapHelper,
  DEFAULT_CASH_REGISTER,
  DEFAULT_KDS,
} from './store-bootstrap.helper';
import { OrganizationPrismaService } from '../../prisma/services/organization-prisma.service';

/**
 * QUI-654 — every store must be born operable.
 *
 * Creating a store never created a cash register: `cash_registers.create`
 * lived only in the module CRUD and no creation path called it, so the first
 * cashier in a new store found an empty register list.
 *
 * These tests pin the two properties the three creation paths depend on:
 *  - the bootstrap transaction produces a register, and
 *  - `ensureDefaultCashRegister` is idempotent, so the superadmin path and the
 *    backfill migration can call it without ever producing a second register.
 */
describe('StoreBootstrapHelper — default cash register (QUI-654)', () => {
  const ORG_ID = 7;
  const STORE_ID = 123;

  let txMock: any;
  let prismaMock: any;

  const buildHelper = async (): Promise<StoreBootstrapHelper> => {
    txMock = {
      addresses: { create: jest.fn() },
      stores: {
        // Echoes `industries` back the way the real row does, applying the same
        // `['retail']` default when the caller passes none. The KDS gate reads
        // the PERSISTED value, so the mock has to model that default.
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: STORE_ID,
          slug: 'mi-tienda',
          name: 'Mi Tienda',
          industries: data?.industries ?? ['retail'],
        })),
        update: jest
          .fn()
          .mockResolvedValue({ id: STORE_ID, slug: 'mi-tienda', name: 'Mi Tienda' }),
      },
      inventory_locations: {
        create: jest.fn().mockResolvedValue({ id: 55, store_id: STORE_ID }),
      },
      cash_registers: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 900,
          ...data,
        })),
      },
      kds: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation(({ data }: any) => ({
          id: 700,
          ...data,
        })),
      },
    };

    prismaMock = {
      // BasePrismaService delegates $transaction to the raw baseClient, so the
      // callback client is unscoped and carries every model. The helper relies
      // on that to reach `cash_registers`, which GlobalPrismaService does not
      // expose as a scoped getter.
      $transaction: jest.fn().mockImplementation((cb: any) => cb(txMock)),
    };

    const mod: TestingModule = await Test.createTestingModule({
      providers: [
        StoreBootstrapHelper,
        { provide: OrganizationPrismaService, useValue: prismaMock },
      ],
    }).compile();

    return mod.get(StoreBootstrapHelper);
  };

  it('creates the default register when the store owns none', async () => {
    const helper = await buildHelper();

    const register = await helper.ensureDefaultCashRegister({
      store_id: STORE_ID,
    });

    expect(txMock.cash_registers.create).toHaveBeenCalledTimes(1);
    expect(txMock.cash_registers.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: STORE_ID,
        name: DEFAULT_CASH_REGISTER.name,
        code: DEFAULT_CASH_REGISTER.code,
        is_active: true,
        // NULL on purpose: the POS resolves its sale location from
        // stores.default_location_id, and pinning the register here would
        // override that cascade.
        location_id: null,
      }),
    });
    expect(register.store_id).toBe(STORE_ID);
  });

  it('is idempotent — never adds a second register', async () => {
    const helper = await buildHelper();
    txMock.cash_registers.findFirst.mockResolvedValue({
      id: 1,
      store_id: STORE_ID,
      code: 'PRINCIPAL',
    });

    const register = await helper.ensureDefaultCashRegister({
      store_id: STORE_ID,
    });

    expect(txMock.cash_registers.create).not.toHaveBeenCalled();
    expect(register.id).toBe(1);
  });

  it('respects a register the operator already created under another code', async () => {
    const helper = await buildHelper();
    // The guard is "does this store have ANY register", not "one coded
    // PRINCIPAL" — otherwise a store with CAJA-1 would also get a PRINCIPAL it
    // never asked for.
    txMock.cash_registers.findFirst.mockResolvedValue({
      id: 4,
      store_id: STORE_ID,
      code: 'CAJA-1',
    });

    const register = await helper.ensureDefaultCashRegister({
      store_id: STORE_ID,
    });

    expect(txMock.cash_registers.create).not.toHaveBeenCalled();
    expect(register.code).toBe('CAJA-1');
  });

  it('resolves a concurrent P2002 by reading the winner instead of failing', async () => {
    const helper = await buildHelper();
    txMock.cash_registers.findFirst
      .mockResolvedValueOnce(null) // pre-check: nothing yet
      .mockResolvedValueOnce({ id: 77, store_id: STORE_ID, code: 'PRINCIPAL' });
    txMock.cash_registers.create.mockRejectedValueOnce({ code: 'P2002' });

    const register = await helper.ensureDefaultCashRegister({
      store_id: STORE_ID,
    });

    expect(register.id).toBe(77);
  });

  it('bootstrapping a store returns it already carrying its cash register', async () => {
    const helper = await buildHelper();

    const result = await helper.createStoreWithDefaultLocation({
      organization_id: ORG_ID,
      store_data: { name: 'Mi Tienda', slug: 'mi-tienda' },
    });

    expect(result.default_cash_register).toBeDefined();
    expect(result.default_cash_register.code).toBe(DEFAULT_CASH_REGISTER.code);
    // Same transaction client as the store and the location: a store must
    // never be committed without its caja.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(txMock.cash_registers.create).toHaveBeenCalledTimes(1);
  });

  it('honours caller-supplied register identifiers', async () => {
    const helper = await buildHelper();

    await helper.createStoreWithDefaultLocation({
      organization_id: ORG_ID,
      store_data: { name: 'Mi Tienda', slug: 'mi-tienda' },
      cash_register_overrides: { name: 'Caja Barra', code: 'BARRA' },
    });

    expect(txMock.cash_registers.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Caja Barra', code: 'BARRA' }),
    });
  });

  // ------------------------------------------------------- KDS por defecto
  // `fireOrderItemsInTx` resuelve la estacion destino con
  // `products.kds_id ?? <default>` y falla con KITCHEN_FIRE_NO_DEFAULT_KDS si no
  // hay default. Sin esta fila una tienda restaurante toma pedidos y no puede
  // mandarlos a cocina, asi que el gate y la idempotencia van cubiertos.

  it('creates the default station for a restaurant store', async () => {
    const helper = await buildHelper();

    const result = await helper.createStoreWithDefaultLocation({
      organization_id: ORG_ID,
      store_data: {
        name: 'Mi Tienda',
        slug: 'mi-tienda',
        industries: ['retail', 'restaurant'] as any,
      },
    });

    expect(txMock.kds.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        store_id: STORE_ID,
        name: DEFAULT_KDS.name,
        code: DEFAULT_KDS.code,
        is_active: true,
        // El indice unico parcial `kds_one_default_per_store` depende de esto.
        is_default: true,
      }),
    });
    expect(result.default_kds).not.toBeNull();
  });

  it('creates NO station for a store that does not cook', async () => {
    const helper = await buildHelper();

    const result = await helper.createStoreWithDefaultLocation({
      organization_id: ORG_ID,
      store_data: { name: 'Mi Tienda', slug: 'mi-tienda', industries: ['retail'] as any },
    });

    expect(txMock.kds.create).not.toHaveBeenCalled();
    // null es un resultado VALIDO, no un fallo: una tienda retail no cocina y
    // un tablero vacio le dejaria un modulo muerto en el panel.
    expect(result.default_kds).toBeNull();
  });

  it('creates no station when industries defaults to retail', async () => {
    const helper = await buildHelper();

    // Sin `industries` la fila persiste ['retail']. El gate lee el valor
    // PERSISTIDO, no el input, justamente para no perderse este default.
    const result = await helper.createStoreWithDefaultLocation({
      organization_id: ORG_ID,
      store_data: { name: 'Mi Tienda', slug: 'mi-tienda' },
    });

    expect(txMock.kds.create).not.toHaveBeenCalled();
    expect(result.default_kds).toBeNull();
  });

  it('is idempotent — respects a station the operator already created', async () => {
    const helper = await buildHelper();
    txMock.kds.findFirst.mockResolvedValue({
      id: 3,
      store_id: STORE_ID,
      code: 'BARRA',
      is_default: true,
    });

    const station = await helper.ensureDefaultKds({
      store_id: STORE_ID,
      industries: ['restaurant'],
    });

    expect(txMock.kds.create).not.toHaveBeenCalled();
    expect(station?.code).toBe('BARRA');
  });

  it('resolves a concurrent P2002 on the one-default index by reading the winner', async () => {
    const helper = await buildHelper();
    txMock.kds.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 88, store_id: STORE_ID, code: 'COCINA' });
    txMock.kds.create.mockRejectedValueOnce({ code: 'P2002' });

    const station = await helper.ensureDefaultKds({
      store_id: STORE_ID,
      industries: ['restaurant'],
    });

    expect(station?.id).toBe(88);
  });
});
