import { CustomersService } from './customers.service';

/**
 * Filtros del listado de clientes por segmento y etiqueta.
 *
 * Lo que se protege aquí es que el filtro llegue a la CONSULTA (no se filtre en
 * memoria) y que el scope de tienda sea explícito en la etiqueta: una etiqueta
 * de otra tienda nunca puede matchear aunque su id venga en la URL.
 */
describe('CustomersService — filtros por etiqueta y segmento', () => {
  const STORE = 7;

  function build() {
    const users = { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) };
    const tags = { findMany: jest.fn().mockResolvedValue([]) };
    const segments = { findMany: jest.fn().mockResolvedValue([]) };
    const prisma = { users, crm_tags: tags, crm_segments: segments };
    const service = new CustomersService(prisma as never, {} as never);
    return { service, users, tags, segments };
  }

  it('la etiqueta filtra en la consulta con store_id explícito', async () => {
    const { service, users } = build();

    await service.findAll(STORE, { tag_ids: [11, 12] } as never);

    const where = users.findMany.mock.calls[0][0].where;
    expect(where.crm_customer_tags).toEqual({
      some: { store_id: STORE, tag_id: { in: [11, 12] } },
    });
    expect(where.id).toBeUndefined();
  });

  it('segmento vacío devuelve una página vacía sin consultar clientes', async () => {
    const { service, users } = build();

    const result = await service.findAll(STORE, { customer_ids: [] } as never);

    expect(users.findMany).toHaveBeenCalled();
    expect(users.findMany.mock.calls[0][0].where.id).toEqual({ in: [] });
    expect(result.data).toEqual([]);
  });

  it('segmento resuelto se aplica como id IN (...) y se combina con la etiqueta', async () => {
    const { service, users } = build();

    await service.findAll(STORE, { customer_ids: [3, 9], tag_ids: [11] } as never);

    const where = users.findMany.mock.calls[0][0].where;
    expect(where.id).toEqual({ in: [3, 9] });
    expect(where.crm_customer_tags).toEqual({
      some: { store_id: STORE, tag_id: { in: [11] } },
    });
  });

  it('sin filtros nuevos la consulta queda como antes', async () => {
    const { service, users } = build();

    await service.findAll(STORE, {} as never);

    const where = users.findMany.mock.calls[0][0].where;
    expect(where.crm_customer_tags).toBeUndefined();
    expect(where.id).toBeUndefined();
  });

  it('las opciones ocultan etiquetas sin clientes y segmentos contados en cero', async () => {
    const { service, tags, segments } = build();
    tags.findMany.mockResolvedValue([
      { id: 1, name: 'VIP', color: '#f00', group_name: null, _count: { customer_tags: 4 } },
      { id: 2, name: 'Sin uso', color: null, group_name: null, _count: { customer_tags: 0 } },
    ]);
    segments.findMany.mockResolvedValue([
      { id: 5, name: 'Compradores', last_count: 12 },
      { id: 6, name: 'Nunca contado', last_count: null },
    ]);

    const options = await service.filterOptions(STORE);

    expect(options.tags).toEqual([{ id: 1, name: 'VIP', color: '#f00', group_name: null }]);
    expect(options.segments).toEqual([
      { id: 5, name: 'Compradores', count: 12 },
      { id: 6, name: 'Nunca contado', count: null },
    ]);
  });

  it('las opciones solo miran la tienda del contexto', async () => {
    const { service, tags, segments } = build();

    await service.filterOptions(STORE);

    expect(tags.findMany.mock.calls[0][0].where).toEqual({ store_id: STORE });
    expect(segments.findMany.mock.calls[0][0].where).toMatchObject({ store_id: STORE });
  });
});
