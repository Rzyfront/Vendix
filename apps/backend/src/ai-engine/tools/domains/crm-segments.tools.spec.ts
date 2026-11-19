import { createCrmSegmentTools } from './crm-segments.tools';
import { CRM_BULK_CUSTOMER_CAP } from './crm-tools.shared';
import { RegisteredTool } from '../interfaces/tool.interface';

describe('crm-segments.tools · segmentos CRM', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };
  const FILTER = {
    op: 'and',
    rules: [{ field: 'orders_count', cmp: 'gte', value: 4 }],
  };
  const SEGMENT = {
    id: 5,
    name: 'VIP',
    description: null,
    filter: FILTER,
    is_dynamic: true,
    last_count: 12,
    last_counted_at: null,
  };
  const MANUAL = {
    ...SEGMENT,
    id: 6,
    name: 'Especiales',
    is_dynamic: false,
    filter: { op: 'and', rules: [] },
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      crmSegmentsService: {
        list: jest.fn().mockResolvedValue([SEGMENT, MANUAL]),
        get: jest.fn().mockResolvedValue(SEGMENT),
        preview: jest
          .fn()
          .mockResolvedValue({ count: 9, sample: [], filter: FILTER }),
        create: jest
          .fn()
          .mockResolvedValue({ ...SEGMENT, id: 8, name: 'Frecuentes' }),
        update: jest.fn().mockResolvedValue(SEGMENT),
        remove: jest.fn().mockResolvedValue({ id: 5 }),
        customers: jest.fn().mockResolvedValue({
          data: [],
          meta: { total: 0, page: 1, limit: 25, totalPages: 0 },
        }),
      },
      segmentQueryService: {
        resolve: jest.fn().mockResolvedValue({ store_id: 7 }),
        count: jest.fn().mockResolvedValue(2),
        memberIds: jest.fn().mockResolvedValue([1, 2]),
        page: jest.fn().mockResolvedValue([
          {
            id: 1,
            first_name: 'Ana',
            last_name: 'Gómez',
            orders_count: 5,
            total_spent: '100',
            last_order_at: null,
          },
        ]),
      },
      segmentMembersService: {
        membershipsOf: jest.fn().mockResolvedValue([]),
        add: jest.fn().mockResolvedValue({}),
        remove: jest.fn().mockResolvedValue({}),
      },
      customersService: {
        findCustomerNamesForAgent: jest.fn().mockResolvedValue([
          { id: 1, first_name: 'Ana', last_name: 'Gómez' },
          { id: 2, first_name: 'Luis', last_name: 'Pérez' },
        ]),
      },
      auditService: { log: jest.fn().mockResolvedValue(undefined) },
      ...overrides,
    } as any;
    const tools = createCrmSegmentTools(deps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t])) as Record<
      string,
      RegisteredTool
    >;
    return { deps, byName };
  }

  const run = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));

  it('declara permisos y flags por tool', () => {
    const { byName } = buildTools();
    expect(Object.keys(byName)).toEqual([
      'list_crm_segments',
      'get_crm_segment_members',
      'find_customers_by_criteria',
      'save_crm_segment',
      'delete_crm_segment',
      'update_segment_members',
    ]);
    for (const name of [
      'list_crm_segments',
      'get_crm_segment_members',
      'find_customers_by_criteria',
    ]) {
      expect(byName[name].readOnly).toBe(true);
      expect(byName[name].requiredPermissions).toEqual([
        'store:customers:read',
      ]);
      expect(byName[name].requiresConfirmation).toBeUndefined();
    }
    expect(byName.save_crm_segment.requiredPermissions).toEqual([
      'store:crm_segments:manage',
    ]);
    expect(byName.delete_crm_segment.requiredPermissions).toEqual([
      'store:crm_segments:manage',
    ]);
    expect(byName.update_segment_members.requiredPermissions).toEqual([
      'store:customers:update',
    ]);
    const irreversible = Object.values(byName)
      .filter((t) => t.irreversible)
      .map((t) => t.name);
    expect(irreversible).toEqual(['delete_crm_segment']);
    for (const name of [
      'save_crm_segment',
      'delete_crm_segment',
      'update_segment_members',
    ]) {
      expect(byName[name].requiresConfirmation).toBe(true);
    }
  });

  describe('find_customers_by_criteria', () => {
    it('devuelve ids con tope y bandera truncated', async () => {
      const ids = Array.from(
        { length: CRM_BULK_CUSTOMER_CAP + 5 },
        (_, i) => i + 1,
      );
      const { deps, byName } = buildTools();
      deps.segmentQueryService.count.mockResolvedValue(ids.length);
      deps.segmentQueryService.memberIds.mockResolvedValue(ids);
      const out = await run(byName.find_customers_by_criteria, {
        filter: FILTER,
      });
      expect(deps.segmentQueryService.resolve).toHaveBeenCalledWith(FILTER);
      expect(out.data.count).toBe(ids.length);
      expect(out.data.customer_ids).toHaveLength(CRM_BULK_CUSTOMER_CAP);
      expect(out.data.truncated).toBe(true);
      expect(out.data.sample[0]).toEqual({
        id: 1,
        name: 'Ana Gómez',
        orders_count: 5,
        total_spent: '100',
        last_order_at: null,
      });
    });

    it('no marca truncated bajo el tope', async () => {
      const { byName } = buildTools();
      const out = await run(byName.find_customers_by_criteria, {
        filter: FILTER,
      });
      expect(out.data.customer_ids).toEqual([1, 2]);
      expect(out.data.truncated).toBe(false);
    });

    it('mapea el error del compilador a {error}', async () => {
      const { deps, byName } = buildTools();
      deps.segmentQueryService.resolve.mockRejectedValue(
        new Error('Campo no permitido: foo'),
      );
      const out = await run(byName.find_customers_by_criteria, {
        filter: { op: 'and', rules: [] },
      });
      expect(out.error).toContain('Campo no permitido: foo');
    });

    it('pide filter si falta', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.find_customers_by_criteria, {});
      expect(out.error).toContain('Falta filter');
      expect(deps.segmentQueryService.resolve).not.toHaveBeenCalled();
    });
  });

  describe('save_crm_segment', () => {
    it('preview de alta dinámica muestra cuántos cumplen hoy', async () => {
      const { deps, byName } = buildTools();
      const preview = await byName.save_crm_segment.preview!(
        { name: 'Frecuentes', filter: FILTER },
        CONTEXT,
      );
      expect(deps.crmSegmentsService.preview).toHaveBeenCalledWith(FILTER);
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Segmento "Frecuentes"');
      expect(preview.changes).toEqual([
        { field: 'name', label: 'Nombre', from: null, to: 'Frecuentes' },
        { field: 'type', label: 'Tipo', from: null, to: 'por reglas' },
        { field: 'count', label: 'Hoy cumplen', from: null, to: '9 clientes' },
      ]);
    });

    it('preview con filtro inválido es error', async () => {
      const { deps, byName } = buildTools();
      deps.crmSegmentsService.preview.mockRejectedValue(
        new Error('Operador no permitido'),
      );
      const preview = await byName.save_crm_segment.preview!(
        { name: 'X', filter: FILTER },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('Operador no permitido');
    });

    it('editar con los mismos datos es error', async () => {
      const { byName } = buildTools();
      const preview = await byName.save_crm_segment.preview!(
        {
          segment_id: 5,
          name: 'VIP',
          filter: { rules: FILTER.rules, op: 'and' },
        },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('nada que cambiar');
    });

    it('editar nombre muestra de/a y el handler llama update', async () => {
      const { deps, byName } = buildTools();
      const preview = await byName.save_crm_segment.preview!(
        { segment_id: 5, name: 'Top' },
        CONTEXT,
      );
      expect(preview.changes).toEqual([
        { field: 'name', label: 'Nombre', from: 'VIP', to: 'Top' },
      ]);
      const out = await run(byName.save_crm_segment, {
        segment_id: 5,
        name: 'Top',
      });
      expect(deps.crmSegmentsService.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ name: 'Top' }),
      );
      expect(out.data.segment_id).toBe(5);
    });

    it('avisa cuando un filtro convierte un manual en reglas', async () => {
      const { deps, byName } = buildTools();
      deps.crmSegmentsService.get.mockResolvedValue(MANUAL);
      const preview = await byName.save_crm_segment.preview!(
        { segment_id: 6, filter: FILTER },
        CONTEXT,
      );
      expect(preview.message).toContain('era manual');
    });

    it('handler de alta llama create y no lanza si falla', async () => {
      const { deps, byName } = buildTools();
      const ok = await run(byName.save_crm_segment, {
        name: 'Frecuentes',
        filter: FILTER,
      });
      expect(deps.crmSegmentsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Frecuentes', filter: FILTER }),
      );
      expect(ok.data.segment_id).toBe(8);
      deps.crmSegmentsService.create.mockRejectedValue(new Error('duplicado'));
      const failed = await run(byName.save_crm_segment, {
        name: 'Frecuentes',
        filter: FILTER,
      });
      expect(failed.error).toContain('duplicado');
    });
  });

  describe('delete_crm_segment', () => {
    it('preview muestra nombre y miembros', async () => {
      const { byName } = buildTools();
      const preview = await byName.delete_crm_segment.preview!(
        { segment_id: 5 },
        CONTEXT,
      );
      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Segmento "VIP"');
      expect(preview.changes[1]).toEqual({
        field: 'members_count',
        label: 'Clientes en el segmento',
        from: '12',
        to: null,
      });
    });

    it('handler elimina sin auditoría extra', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.delete_crm_segment, { segment_id: 5 });
      expect(deps.crmSegmentsService.remove).toHaveBeenCalledWith(5);
      expect(deps.auditService.log).not.toHaveBeenCalled();
      expect(out.data).toEqual({ segment_id: 5 });
    });

    it('devuelve {error} si el servicio falla', async () => {
      const { deps, byName } = buildTools();
      deps.crmSegmentsService.remove.mockRejectedValue(new Error('no existe'));
      const out = await run(byName.delete_crm_segment, { segment_id: 5 });
      expect(out.error).toContain('no existe');
    });
  });

  describe('update_segment_members', () => {
    it('rechaza ids que no son de la tienda', async () => {
      const { deps, byName } = buildTools();
      const preview = await byName.update_segment_members.preview!(
        { segment_id: 5, add_customer_ids: [1, 99] },
        CONTEXT,
      );
      expect(
        deps.customersService.findCustomerNamesForAgent,
      ).toHaveBeenCalledWith(7, [1, 99]);
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('99');
    });

    it('omite no-ops y lista de→a con resumen primero', async () => {
      const { deps, byName } = buildTools();
      deps.segmentMembersService.membershipsOf.mockResolvedValue([
        {
          customer_id: 1,
          tags: [],
          segments: [{ id: 5, name: 'VIP', is_dynamic: true, via: 'manual' }],
        },
        { customer_id: 2, tags: [], segments: [] },
      ]);
      const preview = await byName.update_segment_members.preview!(
        { segment_id: 5, add_customer_ids: [1, 2] },
        CONTEXT,
      );
      expect(preview.changes).toEqual([
        {
          field: 'resumen',
          label: 'Resumen',
          from: null,
          to: '1 se agregan, 0 se quitan, 1 sin cambio',
        },
        {
          field: 'cliente_2',
          label: 'Luis Pérez',
          from: 'fuera',
          to: 'dentro',
        },
      ]);
      expect(preview.message).toContain('Ana Gómez (ya está agregado a mano)');
    });

    it('error si no cambia nada', async () => {
      const { byName } = buildTools();
      const preview = await byName.update_segment_members.preview!(
        { segment_id: 5, remove_customer_ids: [1] },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain('No hay nada que cambiar');
    });

    it('aplica add/remove con args exactos y audita una vez', async () => {
      const { deps, byName } = buildTools();
      deps.segmentMembersService.membershipsOf.mockResolvedValue([
        {
          customer_id: 2,
          tags: [],
          segments: [{ id: 5, name: 'VIP', is_dynamic: true, via: 'manual' }],
        },
      ]);
      const out = await run(byName.update_segment_members, {
        segment_id: 5,
        add_customer_ids: [1],
        remove_customer_ids: [2],
      });
      expect(deps.segmentMembersService.add).toHaveBeenCalledTimes(1);
      expect(deps.segmentMembersService.add).toHaveBeenCalledWith(1, 5);
      expect(deps.segmentMembersService.remove).toHaveBeenCalledWith(2, 5);
      expect(out.data.added).toEqual([1]);
      expect(out.data.removed).toEqual([2]);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
      expect(deps.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BULK_UPDATE',
          resource: 'crm_segment_members',
          resourceId: 5,
          storeId: 7,
          userId: 11,
          metadata: expect.objectContaining({
            source: 'ai_agent',
            tool: 'update_segment_members',
          }),
        }),
      );
    });

    it('falla parcial no lanza y reporta el cliente fallido', async () => {
      const { deps, byName } = buildTools();
      deps.segmentMembersService.add.mockImplementation(async (id: number) => {
        if (id === 2) throw new Error('boom');
        return {};
      });
      const out = await run(byName.update_segment_members, {
        segment_id: 5,
        add_customer_ids: [1, 2],
      });
      expect(out.data.added).toEqual([1]);
      expect(out.data.failed).toEqual([
        { customer_id: 2, action: 'agregar', error: 'boom' },
      ]);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
    });

    it('rechaza superar el tope', async () => {
      const { deps, byName } = buildTools();
      const ids = Array.from(
        { length: CRM_BULK_CUSTOMER_CAP + 1 },
        (_, i) => i + 1,
      );
      const preview = await byName.update_segment_members.preview!(
        { segment_id: 5, add_customer_ids: ids },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toContain(
        `máximo por operación es ${CRM_BULK_CUSTOMER_CAP}`,
      );
      const out = await run(byName.update_segment_members, {
        segment_id: 5,
        add_customer_ids: ids,
      });
      expect(out.error).toContain(
        `máximo por operación es ${CRM_BULK_CUSTOMER_CAP}`,
      );
      expect(deps.segmentMembersService.add).not.toHaveBeenCalled();
    });
  });

  it('sin tienda en contexto no toca servicios', async () => {
    const { deps, byName } = buildTools();
    const out = await byName.list_crm_segments.handler!(
      {},
      { user_id: 1 },
    ).then((r) => JSON.parse(r));
    expect(out.error).toContain('Sin tienda en contexto');
    expect(deps.crmSegmentsService.list).not.toHaveBeenCalled();
  });
});
