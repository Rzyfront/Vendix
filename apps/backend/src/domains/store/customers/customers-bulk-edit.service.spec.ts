import { CustomersBulkEditService } from './customers-bulk-edit.service';
import {
  BulkCustomerTagActionMode,
  BulkEditCustomersDto,
} from './dto/bulk-edit-customers.dto';

/**
 * Edición masiva de clientes: preview read-only, apply tolerante a fallos,
 * multi-tenant y tarifa.
 *
 * Los mocks reproducen el contrato de `StorePrismaService`: `price_tiers`,
 * `crm_tags` y `crm_customer_tags` llegan YA filtrados por tienda, y `users`
 * no, así que el filtro de tienda de `users` vive en el `where` de este
 * servicio y es lo que se vigila aquí.
 */
describe('CustomersBulkEditService', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 10,
    first_name: 'Ana',
    last_name: 'Díaz',
    legal_name: null,
    phone: '3001112233',
    person_type: null,
    tax_regime: null,
    is_withholding_agent: false,
    ciiu_code: null,
    fiscal_responsibilities: [],
    state: 'active',
    email: 'ana@example.com',
    document_type: 'CC',
    document_number: '10203040',
    store_users: [{ price_tier_id: null }],
    user_roles: [{ id: 1 }],
    ...over,
  });

  const createService = () => {
    const prisma = {
      users: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      price_tiers: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      crm_tags: { count: jest.fn().mockResolvedValue(0) },
      crm_customer_tags: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      // Transacción por cliente: el mock recibe el callback y le pasa el mismo
      // objeto como `Prisma.TransactionClient`.
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation(async (callback: never) =>
      (callback as unknown as (tx: unknown) => Promise<unknown>)(prisma),
    );
    const customersService = {
      update: jest.fn().mockImplementation(async (_storeId, id) => ({ id })),
    };
    const service = new CustomersBulkEditService(
      prisma as never,
      customersService as never,
    );
    return { service, prisma, customersService };
  };

  const dto = (over: Partial<BulkEditCustomersDto> = {}): BulkEditCustomersDto =>
    ({
      ids: [10],
      changes: { phone: '3009998877' },
      ...over,
    }) as BulkEditCustomersDto;

  // ── Preview ───────────────────────────────────────────────────────────

  it('el preview calcula el diff y NO escribe nada', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);

    const result = await service.preview(2, dto());

    expect(result).toMatchObject({ total: 1, ok: 1, warnings: 0, errors: 0 });
    expect(result.items[0]).toMatchObject({
      id: 10,
      name: 'Ana Díaz',
      status: 'ok',
      changes: [{ field: 'phone', current: '3001112233', next: '3009998877' }],
    });
    expect(customersService.update).not.toHaveBeenCalled();
  });

  it('un cliente de otra tienda no entra al lote (filtro de tienda en la consulta)', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([]);

    const result = await service.preview(2, dto());

    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [10] },
          store_users: { some: { store_id: 2 } },
        }),
      }),
    );
    expect(result.items[0]).toMatchObject({
      status: 'error',
      code: 'CUST_FIND_001',
    });
  });

  it('staff o manager de la tienda se rechaza por fila y sin abortar el lote', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([
      row({ id: 10 }),
      row({ id: 11, user_roles: [] }),
    ]);

    const result = await service.preview(2, dto({ ids: [10, 11] }));

    expect(result.total).toBe(2);
    expect(result.ok).toBe(1);
    expect(result.errors).toBe(1);
    expect(result.items[1]).toMatchObject({
      status: 'error',
      code: 'CUST_VALIDATE_001',
    });
    expect(result.items[1].message).toContain('staff o manager');
  });

  it('un cliente archivado no se edita en lote', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([row({ state: 'archived' })]);

    const result = await service.preview(2, dto());

    expect(result.items[0]).toMatchObject({
      status: 'error',
      code: 'CUST_FIND_001',
    });
    expect(result.items[0].message).toContain('archivado');
  });

  it('una tarifa que no es de cliente, está inactiva o es de otra tienda se rechaza sin escribir', async () => {
    const { service, prisma, customersService } = createService();
    prisma.price_tiers.findFirst.mockResolvedValue(null);

    await expect(
      service.apply(2, dto({ changes: { price_tier_id: 99 } })),
    ).rejects.toMatchObject({ errorCode: 'CUST_PRICE_TIER_001' });
    expect(prisma.price_tiers.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99, kind: 'customer_tier', is_active: true },
      }),
    );
    expect(customersService.update).not.toHaveBeenCalled();
  });

  it('asignar tarifa sobre una distinta cuenta la sobrescritura y la avisa', async () => {
    const { service, prisma } = createService();
    prisma.price_tiers.findFirst.mockResolvedValue({ id: 5, name: 'Mayorista' });
    prisma.price_tiers.findMany.mockResolvedValue([{ id: 3, name: 'Minorista' }]);
    prisma.users.findMany.mockResolvedValue([
      row({ store_users: [{ price_tier_id: 3 }] }),
    ]);

    const result = await service.preview(
      2,
      dto({ changes: { price_tier_id: 5 } }),
    );

    expect(result.tier_overwrite_count).toBe(1);
    expect(result.items[0].status).toBe('warning');
    expect(result.items[0].message).toContain('Minorista');
    expect(result.items[0].changes).toEqual([
      { field: 'price_tier_id', current: 3, next: 5 },
    ]);
  });

  it('«Sin tarifa» (null) limpia y no consulta el catálogo de tarifas', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([
      row({ store_users: [{ price_tier_id: 3 }] }),
    ]);
    prisma.price_tiers.findMany.mockResolvedValue([{ id: 3, name: 'Minorista' }]);

    const result = await service.preview(
      2,
      dto({ changes: { price_tier_id: null } }),
    );

    expect(prisma.price_tiers.findFirst).not.toHaveBeenCalled();
    expect(result.items[0].changes).toEqual([
      { field: 'price_tier_id', current: 3, next: null },
    ]);
    expect(result.items[0].status).toBe('warning');
  });

  it('persona jurídica sin razón social es un error de fila, no de lote', async () => {
    const { service, prisma } = createService();
    // Documento NIT para que la compuerta que falla sea la de razón social y no
    // la de coherencia persona/documento (que tiene su propio mensaje).
    prisma.users.findMany.mockResolvedValue([
      row({ document_type: 'NIT', document_number: '900123456' }),
    ]);

    const result = await service.preview(
      2,
      dto({ changes: { person_type: 'JURIDICA' } }),
    );

    expect(result.items[0]).toMatchObject({
      status: 'error',
      code: 'CUST_VALIDATE_001',
    });
    expect(result.items[0].message).toContain('razón social');
  });

  it('un lote sin cambios se rechaza en vez de reportar éxito vacío', async () => {
    const { service, prisma } = createService();

    await expect(service.preview(2, dto({ changes: {} }))).rejects.toMatchObject(
      { errorCode: 'CUST_VALIDATE_001' },
    );
    expect(prisma.users.findMany).not.toHaveBeenCalled();
  });

  it('deduplica los ids del lote', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);

    await service.preview(2, dto({ ids: [10, 10, 10] }));

    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: [10] } }),
      }),
    );
  });

  // ── Apply ─────────────────────────────────────────────────────────────

  it('apply envía SIEMPRE nombre y apellido para no vaciarlos al editar un solo campo', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);

    const result = await service.apply(2, dto({ changes: { phone: '3009998877' } }));

    expect(result).toMatchObject({ total: 1, successful: 1, failed: 0 });
    expect(customersService.update).toHaveBeenCalledWith(
      2,
      10,
      {
        first_name: 'Ana',
        last_name: 'Díaz',
        phone: '3009998877',
      },
      expect.anything(),
    );
  });

  it('un cliente que ya tenía los valores se reporta como omitido y no se escribe', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([
      row({ phone: '3009998877' }),
    ]);

    const result = await service.apply(2, dto({ changes: { phone: '3009998877' } }));

    expect(result).toMatchObject({ total: 1, successful: 0, skipped: 1, failed: 0 });
    expect(result.results[0]).toMatchObject({ id: 10, status: 'skipped' });
    // Reenviar el mismo valor no debe tocar `updated_at` ni disparar queries
    // de escritura: el resumen tiene que decir «omitido», no «editado».
    expect(customersService.update).not.toHaveBeenCalled();
  });

  it('la fila que falla no aborta el resto y se reporta con su motivo', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([row({ id: 10 }), row({ id: 11 })]);
    customersService.update.mockImplementation(async (_storeId, id) => {
      if (id === 10) {
        throw Object.assign(new Error('documento duplicado'), {
          errorCode: 'SYS_CONFLICT_001',
        });
      }
      return { id };
    });

    const result = await service.apply(2, dto({ ids: [10, 11] }));

    expect(result.total).toBe(2);
    expect(result.successful).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({
      id: 10,
      name: 'Ana Díaz',
      status: 'error',
      message: 'documento duplicado',
    });
    expect(result.results[1]).toMatchObject({ id: 11, status: 'ok' });
  });

  it('las etiquetas se aplican como unión y respetan las que ya tenía el cliente', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);
    prisma.crm_tags.count.mockResolvedValue(1);
    prisma.crm_customer_tags.findMany.mockResolvedValue([
      { customer_id: 10, tag_id: 7 },
    ]);

    const result = await service.apply(
      2,
      dto({
        changes: {
          tag_action: { mode: BulkCustomerTagActionMode.ADD, ids: [8] },
        },
      }),
    );

    expect(result.successful).toBe(1);
    expect(prisma.crm_customer_tags.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: 10, tag_id: { notIn: [7, 8] } },
    });
    expect(prisma.crm_customer_tags.createMany).toHaveBeenCalledWith({
      data: [
        { store_id: 2, customer_id: 10, tag_id: 7 },
        { store_id: 2, customer_id: 10, tag_id: 8 },
      ],
      skipDuplicates: true,
    });
  });

  it('quitar una etiqueta la elimina y no reescribe las demás', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);
    prisma.crm_tags.count.mockResolvedValue(1);
    prisma.crm_customer_tags.findMany.mockResolvedValue([
      { customer_id: 10, tag_id: 7 },
      { customer_id: 10, tag_id: 8 },
    ]);

    await service.apply(
      2,
      dto({
        changes: {
          tag_action: { mode: BulkCustomerTagActionMode.REMOVE, ids: [7] },
        },
      }),
    );

    expect(prisma.crm_customer_tags.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: 10, tag_id: { notIn: [8] } },
    });
  });

  // ── Transacción por cliente ──────────────────────────────────────────

  it('update y etiquetas van en la misma transacción por cliente', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);
    prisma.crm_tags.count.mockResolvedValue(1);
    prisma.crm_customer_tags.findMany.mockResolvedValue([]);

    await service.apply(
      2,
      dto({
        changes: {
          phone: '3009998877',
          tag_action: { mode: BulkCustomerTagActionMode.ADD, ids: [8] },
        },
      }),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // El cliente Prisma de la transacción es el que hace las dos escrituras.
    expect(customersService.update.mock.calls[0][3]).toBeDefined();
  });

  it('si las etiquetas fallan, la fila se reporta como error total (rollback)', async () => {
    const { service, prisma } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);
    prisma.crm_tags.count.mockResolvedValue(1);
    prisma.crm_customer_tags.findMany.mockResolvedValue([]);
    prisma.crm_customer_tags.deleteMany.mockRejectedValue(
      Object.assign(new Error('tag rota'), { errorCode: 'SYS_UNEXPECTED_001' }),
    );

    const result = await service.apply(
      2,
      dto({
        changes: {
          phone: '3009998877',
          tag_action: { mode: BulkCustomerTagActionMode.ADD, ids: [8] },
        },
      }),
    );

    expect(result.failed).toBe(1);
    expect(result.successful).toBe(0);
    expect(result.results[0].message).toBe('tag rota');
    // Ya no se afirma que los datos quedaron guardados: la transacción revierte.
    expect(result.results[0].message).not.toContain('se guardaron');
  });

  it('vaciar el nombre lo borra de verdad y no revierte al valor anterior', async () => {
    const { service, prisma, customersService } = createService();
    prisma.users.findMany.mockResolvedValue([row()]);

    await service.apply(2, dto({ changes: { first_name: null } }));

    expect(customersService.update).toHaveBeenCalledWith(
      2,
      10,
      expect.objectContaining({ first_name: '', last_name: 'Díaz' }),
      expect.anything(),
    );
  });

  it('una etiqueta que no existe en la tienda rechaza el lote entero', async () => {
    const { service, prisma, customersService } = createService();
    prisma.crm_tags.count.mockResolvedValue(0);

    await expect(
      service.preview(2, dto({ changes: { tag_action: { mode: BulkCustomerTagActionMode.ADD, ids: [99] } } })),
    ).rejects.toMatchObject({ errorCode: 'CRM_TAG_001' });
    expect(customersService.update).not.toHaveBeenCalled();
  });

  // ── Selección por filtro ──────────────────────────────────────────────

  it('los ids del filtro aplican scope de tienda, rol customer y excluyen archivados', async () => {
    const { service, prisma } = createService();
    prisma.users.count.mockResolvedValue(2);
    prisma.users.findMany.mockResolvedValue([{ id: 12 }, { id: 11 }]);

    const result = await service.listIds(2, {
      search: 'ana',
      tag_ids: [4],
      customer_ids: [11, 12],
    });

    expect(result).toEqual({ ids: [12, 11], total: 2, capped: false });
    const where = prisma.users.count.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { store_users: { some: { store_id: 2 } } },
        { user_roles: { some: { roles: { name: 'customer' } } } },
        { state: { not: 'archived' } },
        {
          crm_customer_tags: {
            some: { store_id: 2, tag_id: { in: [4] } },
          },
        },
        { id: { in: [11, 12] } },
      ]),
    );
  });

  it('marca capped cuando el filtro supera el tope del endpoint de ids', async () => {
    const { service, prisma } = createService();
    prisma.users.count.mockResolvedValue(5000);
    prisma.users.findMany.mockResolvedValue([{ id: 1 }]);

    const result = await service.listIds(2, {});

    expect(result.capped).toBe(true);
    expect(prisma.users.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 1000 }),
    );
  });
});
