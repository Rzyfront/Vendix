import { createCrmTagTools, CrmTagToolDeps } from './crm-tags.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

describe('crm-tags.tools · etiquetas del CRM', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };

  const CATALOG = [
    { id: 1, name: 'VIP', color: '#16a34a', customers_count: 4 },
    { id: 2, name: 'Mayorista', color: null, customers_count: 2 },
    { id: 3, name: 'Nuevo', color: '#0ea5e9', customers_count: 0 },
  ];

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      crmTagsService: {
        list: jest.fn().mockResolvedValue(CATALOG),
        create: jest
          .fn()
          .mockResolvedValue({ id: 9, name: 'Moroso', color: null }),
        update: jest
          .fn()
          .mockResolvedValue({ id: 1, name: 'VIP Oro', color: '#16a34a' }),
        remove: jest.fn().mockResolvedValue({ id: 1 }),
      },
      customerCrmService: {
        setTags: jest.fn().mockResolvedValue([]),
      },
      segmentMembersService: {
        membershipsOf: jest.fn().mockResolvedValue([]),
      },
      customersService: {
        findCustomerNamesForAgent: jest
          .fn()
          .mockImplementation(async (_store: number, ids: number[]) =>
            ids
              .filter((id) => id < 1000)
              .map((id) => ({
                id,
                first_name: `Cliente`,
                last_name: `${id}`,
              })),
          ),
      },
      auditService: { log: jest.fn().mockResolvedValue(undefined) },
      ...overrides,
    } as any;
    const tools = createCrmTagTools(deps as CrmTagToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps, tools, byName };
  }

  const run = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.handler!(args, CONTEXT).then((raw) => JSON.parse(raw));
  const preview = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.preview!(args, CONTEXT);

  it('expone 4 tools con permisos y banderas del endpoint equivalente', () => {
    const { tools } = buildTools();
    const info = Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          perms: t.requiredPermissions,
          confirm: !!t.requiresConfirmation,
          irreversible: !!t.irreversible,
          readOnly: !!t.readOnly,
          domain: t.domain,
          version: t.version,
        },
      ]),
    );
    expect(info).toEqual({
      list_crm_tags: {
        perms: ['store:customers:read'],
        confirm: false,
        irreversible: false,
        readOnly: true,
        domain: 'customers',
        version: '1',
      },
      save_crm_tag: {
        perms: ['store:crm_segments:manage'],
        confirm: true,
        irreversible: false,
        readOnly: false,
        domain: 'customers',
        version: '1',
      },
      delete_crm_tag: {
        perms: ['store:crm_segments:manage'],
        confirm: true,
        irreversible: true,
        readOnly: false,
        domain: 'customers',
        version: '1',
      },
      tag_customers: {
        perms: ['store:customers:update'],
        confirm: true,
        irreversible: false,
        readOnly: false,
        domain: 'customers',
        version: '1',
      },
    });
  });

  it('list_crm_tags devuelve id, nombre, color y conteo', async () => {
    const { byName } = buildTools();
    const out = await run(byName.list_crm_tags);
    expect(out.data.total).toBe(3);
    expect(out.data.tags[0]).toEqual({
      id: 1,
      name: 'VIP',
      color: '#16a34a',
      customers_count: 4,
    });
  });

  describe('save_crm_tag', () => {
    it('crea: preview con el nombre nuevo y handler llama create', async () => {
      const { deps, byName } = buildTools();
      const p = await preview(byName.save_crm_tag, { name: ' Moroso ' });
      expect(p.status).toBe('ok');
      expect(p.target).toBe('Etiqueta nueva "Moroso"');
      expect(p.changes).toEqual([
        { field: 'name', label: 'Nombre', from: null, to: 'Moroso' },
      ]);
      const out = await run(byName.save_crm_tag, { name: 'Moroso' });
      expect(deps.crmTagsService.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Moroso' }),
      );
      expect(out.summary).toBe('Etiqueta "Moroso" creada.');
    });

    it('nombre duplicado: preview error con CRM_TAG_002', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.save_crm_tag, { name: 'VIP' });
      expect(p.status).toBe('error');
      expect(p.message).toContain('CRM_TAG_002');
    });

    it('edita: from/to por campo cambiado y handler llama update', async () => {
      const { deps, byName } = buildTools();
      const p = await preview(byName.save_crm_tag, {
        tag_id: 1,
        name: 'VIP Oro',
      });
      expect(p.target).toBe('Etiqueta "VIP"');
      expect(p.changes).toEqual([
        { field: 'name', label: 'Nombre', from: 'VIP', to: 'VIP Oro' },
      ]);
      const out = await run(byName.save_crm_tag, {
        tag_id: 1,
        name: 'VIP Oro',
      });
      expect(deps.crmTagsService.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ name: 'VIP Oro' }),
      );
      expect(out.summary).toBe('Etiqueta "VIP Oro" actualizada.');
    });

    it('idéntica: preview error sin cambios', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.save_crm_tag, {
        tag_id: 1,
        name: 'VIP',
        color: '#16a34a',
      });
      expect(p.status).toBe('error');
      expect(p.message).toBe(
        'No hay cambios: la etiqueta ya tiene esos valores.',
      );
    });

    it('etiqueta inexistente: CRM_TAG_001 y nunca llama update', async () => {
      const { deps, byName } = buildTools();
      const p = await preview(byName.save_crm_tag, { tag_id: 99, name: 'X' });
      expect(p.status).toBe('error');
      expect(p.message).toContain('CRM_TAG_001');
      const out = await run(byName.save_crm_tag, { tag_id: 99, name: 'X' });
      expect(out.error).toContain('CRM_TAG_001');
      expect(deps.crmTagsService.update).not.toHaveBeenCalled();
    });
  });

  describe('delete_crm_tag', () => {
    it('preview nombra la etiqueta y cuántos clientes la pierden', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.delete_crm_tag, { tag_id: 1 });
      expect(p.target).toBe('Etiqueta "VIP"');
      expect(p.message).toBe(
        'Se elimina y se quita de 4 clientes. No se puede deshacer.',
      );
    });

    it('handler elimina y audita una sola vez con source ai_agent', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.delete_crm_tag, { tag_id: 1 });
      expect(deps.crmTagsService.remove).toHaveBeenCalledWith(1);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
      expect(deps.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DELETE',
          resource: 'crm_tags',
          resourceId: 1,
          oldValues: { name: 'VIP', color: '#16a34a' },
          storeId: 7,
          metadata: expect.objectContaining({
            source: 'ai_agent',
            tool: 'delete_crm_tag',
          }),
        }),
      );
      expect(out.summary).toBe('Etiqueta "VIP" eliminada.');
    });

    it('etiqueta ya borrada: error sin remove ni auditoría', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.delete_crm_tag, { tag_id: 77 });
      expect(out.error).toContain('CRM_TAG_001');
      expect(deps.crmTagsService.remove).not.toHaveBeenCalled();
      expect(deps.auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('tag_customers', () => {
    const memberships = (map: Record<number, number[]>) =>
      jest.fn().mockImplementation(async (ids: number[]) =>
        ids.map((id) => ({
          customer_id: id,
          segments: [],
          tags: (map[id] ?? []).map((tid) => ({
            id: tid,
            name: CATALOG.find((t) => t.id === tid)!.name,
            color: null,
          })),
        })),
      );

    it('mezcla (actual ∪ add) − remove y omite a los que no cambian', async () => {
      const { deps, byName } = buildTools({
        segmentMembersService: {
          membershipsOf: memberships({ 1: [1, 2], 2: [3], 3: [1] }),
        },
      });
      const args = {
        customer_ids: [1, 2, 3],
        add_tag_ids: [3],
        remove_tag_ids: [2],
      };
      const p = await preview(byName.tag_customers, args);
      expect(p.status).toBe('ok');
      expect(p.target).toBe('Etiquetas de 3 clientes');
      expect(p.changes[0]).toEqual({
        field: 'resumen',
        label: 'Resumen',
        from: '3 clientes seleccionados',
        to: 'Se agregan Nuevo / se quitan Mayorista en 2 clientes; 1 ya estaban así',
      });
      expect(p.changes[1]).toEqual({
        field: 'cliente_1',
        label: 'Cliente 1',
        from: 'VIP, Mayorista',
        to: 'VIP, Nuevo',
      });
      expect(p.changes).toHaveLength(3);

      const out = await run(byName.tag_customers, args);
      expect(deps.customerCrmService.setTags).toHaveBeenCalledTimes(2);
      expect(deps.customerCrmService.setTags).toHaveBeenCalledWith(1, [1, 3]);
      expect(deps.customerCrmService.setTags).toHaveBeenCalledWith(3, [1, 3]);
      expect(out.data.applied).toHaveLength(2);
      expect(out.data.failed).toEqual([]);
      expect(out.data.unchanged).toBe(1);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
      expect(deps.auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'BULK_UPDATE',
          resource: 'crm_customer_tags',
          // Only the applied customers, with their tags before and after.
          oldValues: { tag_ids_by_customer: { 1: [1, 2], 3: [1] } },
          newValues: {
            customer_ids: [1, 3],
            add_tag_ids: [3],
            remove_tag_ids: [2],
            tag_ids_by_customer: { 1: [1, 3], 3: [1, 3] },
          },
          metadata: expect.objectContaining({
            requested: 3,
            applied: 2,
            unchanged: 1,
            failed: 0,
            source: 'ai_agent',
          }),
        }),
      );
    });

    it('el handler tolera un solo número en customer_ids (el registro exige lista)', async () => {
      const { deps, byName } = buildTools();
      await run(byName.tag_customers, { customer_ids: 5, add_tag_ids: [1] });
      expect(deps.customerCrmService.setTags).toHaveBeenCalledWith(5, [1]);
    });

    it('nada que cambiar: preview error y no toca nada', async () => {
      const { deps, byName } = buildTools({
        segmentMembersService: { membershipsOf: memberships({ 1: [1] }) },
      });
      const p = await preview(byName.tag_customers, {
        customer_ids: [1],
        add_tag_ids: [1],
      });
      expect(p.status).toBe('error');
      expect(p.message).toBe(
        'No hay nada que cambiar: todos los clientes ya tienen ese estado de etiquetas.',
      );
      const out = await run(byName.tag_customers, {
        customer_ids: [1],
        add_tag_ids: [1],
      });
      expect(out.error).toBeDefined();
      expect(deps.customerCrmService.setTags).not.toHaveBeenCalled();
      expect(deps.auditService.log).not.toHaveBeenCalled();
    });

    it('rechaza clientes fuera de la tienda', async () => {
      const { deps, byName } = buildTools();
      const p = await preview(byName.tag_customers, {
        customer_ids: [1, 5000],
        add_tag_ids: [1],
      });
      expect(p.status).toBe('error');
      expect(p.message).toBe(
        'Clientes que no existen en esta tienda: 5000. No se toca ningún cliente de otra tienda.',
      );
      expect(deps.customerCrmService.setTags).not.toHaveBeenCalled();
    });

    it('rechaza etiquetas desconocidas', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.tag_customers, {
        customer_ids: [1],
        add_tag_ids: [42],
      });
      expect(p.status).toBe('error');
      expect(p.message).toContain(
        'Etiquetas que no existen en esta tienda: 42.',
      );
    });

    it('rechaza una etiqueta en add y remove a la vez', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.tag_customers, {
        customer_ids: [1],
        add_tag_ids: [1],
        remove_tag_ids: [1],
      });
      expect(p.status).toBe('error');
      expect(p.message).toContain(
        'en add_tag_ids y en remove_tag_ids a la vez',
      );
    });

    it('exige al menos una etiqueta a agregar o quitar', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.tag_customers, { customer_ids: [1] });
      expect(p.status).toBe('error');
      expect(p.message).toContain('add_tag_ids');
    });

    it('rechaza más de 200 clientes', async () => {
      const { deps, byName } = buildTools();
      const ids = Array.from({ length: 201 }, (_, i) => i + 1);
      const p = await preview(byName.tag_customers, {
        customer_ids: ids,
        add_tag_ids: [1],
      });
      expect(p.status).toBe('error');
      expect(p.message).toBe(
        'Son 201 clientes y el máximo por operación es 200. Divide la acción en tandas de 200.',
      );
      expect(
        deps.customersService.findCustomerNamesForAgent,
      ).not.toHaveBeenCalled();
    });

    it('consulta membershipsOf en tandas de 100', async () => {
      const { deps, byName } = buildTools();
      const ids = Array.from({ length: 150 }, (_, i) => i + 1);
      await preview(byName.tag_customers, {
        customer_ids: ids,
        add_tag_ids: [1],
      });
      const calls = deps.segmentMembersService.membershipsOf.mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[0][0]).toHaveLength(100);
      expect(calls[1][0]).toHaveLength(50);
    });

    it('capa el preview con "se muestran N de M"', async () => {
      const { byName } = buildTools();
      const ids = Array.from({ length: 40 }, (_, i) => i + 1);
      const p = await preview(byName.tag_customers, {
        customer_ids: ids,
        add_tag_ids: [1],
      });
      expect(p.changes).toHaveLength(26); // resumen + 25
      expect(p.message).toBe(
        'se muestran 25 de 40 clientes que cambian (y 15 más)',
      );
    });

    it('rechaza superar 50 etiquetas por cliente', async () => {
      const big = Array.from({ length: 50 }, (_, i) => 100 + i);
      const { byName } = buildTools({
        segmentMembersService: {
          membershipsOf: jest.fn().mockResolvedValue([
            {
              customer_id: 1,
              segments: [],
              tags: big.map((id) => ({ id, name: `T${id}`, color: null })),
            },
          ]),
        },
      });
      const p = await preview(byName.tag_customers, {
        customer_ids: [1],
        add_tag_ids: [1],
      });
      expect(p.status).toBe('error');
      expect(p.message).toContain('máximo de 50 etiquetas por cliente');
    });

    it('falla parcial: reporta sin lanzar y audita una vez', async () => {
      const setTags = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('boom'));
      const { deps, byName } = buildTools({
        customerCrmService: { setTags },
      });
      const out = await run(byName.tag_customers, {
        customer_ids: [1, 2],
        add_tag_ids: [1],
      });
      expect(out.data.applied).toEqual([{ customer_id: 1, name: 'Cliente 1' }]);
      expect(out.data.failed).toEqual([
        { customer_id: 2, name: 'Cliente 2', reason: 'boom' },
      ]);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
    });

    it('sin tienda en contexto no toca deps', async () => {
      const { deps, byName } = buildTools();
      const out = await byName.tag_customers.handler!(
        { customer_ids: [1], add_tag_ids: [1] },
        { user_id: 1 },
      );
      expect(JSON.parse(out).error).toContain('Sin tienda en contexto');
      expect(deps.crmTagsService.list).not.toHaveBeenCalled();
    });
  });
  describe('tag_customers · compensate (T36)', () => {
    const membership = (id: number, tags: number[]) => ({
      customer_id: id,
      tags: tags.map((t) => ({ id: t })),
    });

    it('capture keeps the previous and applied tag sets of the customers that change', async () => {
      const { byName } = buildTools({
        segmentMembersService: {
          membershipsOf: jest
            .fn()
            .mockResolvedValue([membership(5, [2]), membership(6, [1])]),
        },
      });
      const snap = await byName.tag_customers.compensate!.capture(
        { customer_ids: [5, 6], add_tag_ids: [1] },
        CONTEXT,
      );
      expect(snap).toEqual({
        customers: [{ id: 5, before: [2], after: [2, 1] }],
      });
    });

    it('undo restores the previous tags when they are still the applied ones', async () => {
      const { deps, byName } = buildTools({
        segmentMembersService: {
          membershipsOf: jest.fn().mockResolvedValue([membership(5, [1, 2])]),
        },
      });
      const out = await byName.tag_customers.compensate!.undo({
        args: {},
        snapshot: { customers: [{ id: 5, before: [2], after: [2, 1] }] },
        handlerOutput: '',
        context: CONTEXT,
      });
      expect(deps.customerCrmService.setTags).toHaveBeenCalledWith(5, [2]);
      expect(out).toBe('Etiquetas restauradas en 1 cliente.');
    });

    it('undo throws and writes nothing when a customer tags moved after the batch', async () => {
      const { deps, byName } = buildTools({
        segmentMembersService: {
          membershipsOf: jest
            .fn()
            .mockResolvedValue([membership(5, [2, 1]), membership(6, [3])]),
        },
      });
      await expect(
        byName.tag_customers.compensate!.undo({
          args: {},
          snapshot: {
            customers: [
              { id: 5, before: [2], after: [2, 1] },
              { id: 6, before: [1], after: [1, 2] },
            ],
          },
          handlerOutput: '',
          context: CONTEXT,
        }),
      ).rejects.toThrow();
      expect(deps.customerCrmService.setTags).not.toHaveBeenCalled();
    });
  });
});
