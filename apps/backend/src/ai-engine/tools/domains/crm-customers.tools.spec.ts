import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { RegisteredTool } from '../interfaces/tool.interface';
import {
  createCrmCustomerTools,
  CrmCustomerToolDeps,
} from './crm-customers.tools';

describe('crm-customers.tools · ficha, archivo, responsable y notas', () => {
  const CONTEXT = { organization_id: 3, store_id: 7, user_id: 11 };
  const ANA = {
    id: 4,
    first_name: 'Ana',
    last_name: 'Gómez',
    document_type: 'CC',
    document_number: '123',
    phone: '300',
    email: 'ana@x.co',
    state: 'active',
    total_orders: 3,
    total_spend: 90000,
    last_order_date: null,
  };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      customersService: {
        findOne: jest.fn().mockResolvedValue(ANA),
        remove: jest.fn().mockResolvedValue({ ...ANA, state: 'archived' }),
        findCustomerNamesForAgent: jest
          .fn()
          .mockImplementation(async (_store: number, ids: number[]) =>
            ids
              .filter((id) => id < 100)
              .map((id) => ({
                id,
                first_name: `Cliente${id}`,
                last_name: 'Prueba',
              })),
          ),
      },
      customerCrmService: {
        getProfile: jest.fn().mockResolvedValue({
          owner: null,
          stage: { id: 1, name: 'Nuevo' },
          source: 'pos',
          last_contact_at: null,
          consents: { whatsapp: 'opted_in' },
          tags: [{ id: 2, name: 'VIP' }],
          open_tasks: 1,
          overdue_tasks: 0,
          open_opportunities: { count: 1, amount: '1000' },
          rfm: { segment: 'champions' },
        }),
        updateProfile: jest.fn().mockResolvedValue({}),
        listNotes: jest.fn().mockResolvedValue({
          data: [
            {
              id: 9,
              body: 'Llamar mañana',
              is_pinned: true,
              created_by: { id: 11, first_name: 'Luis', last_name: 'P' },
              created_at: '2026-01-01',
            },
          ],
          total: 1,
          page: 1,
          limit: 20,
        }),
        createNote: jest.fn().mockResolvedValue({ id: 33, is_pinned: false }),
      },
      segmentMembersService: {
        ofCustomer: jest.fn().mockResolvedValue({
          customer_id: 4,
          tags: [],
          segments: [{ id: 5, name: 'Frecuentes' }],
        }),
      },
      auditService: { log: jest.fn().mockResolvedValue(undefined) },
      ...overrides,
    } as any;
    const tools = createCrmCustomerTools(deps as CrmCustomerToolDeps);
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    return { deps, tools, byName };
  }

  const run = (
    tool: RegisteredTool,
    args: Record<string, any> = {},
    ctx = CONTEXT,
  ) => tool.handler!(args, ctx).then((raw) => JSON.parse(raw));
  const preview = (tool: RegisteredTool, args: Record<string, any> = {}) =>
    tool.preview!(args, CONTEXT);

  it('declara permisos y banderas de cada tool', () => {
    const { tools } = buildTools();
    const flags = Object.fromEntries(
      tools.map((t) => [
        t.name,
        {
          perms: t.requiredPermissions,
          readOnly: !!t.readOnly,
          confirm: !!t.requiresConfirmation,
          irreversible: !!t.irreversible,
          domain: t.domain,
          version: t.version,
        },
      ]),
    );
    expect(flags).toEqual({
      get_customer_crm_profile: {
        perms: ['store:customers:read'],
        readOnly: true,
        confirm: false,
        irreversible: false,
        domain: 'customers',
        version: '1',
      },
      archive_customer: {
        perms: ['store:customers:delete'],
        readOnly: false,
        confirm: true,
        irreversible: true,
        domain: 'customers',
        version: '1',
      },
      assign_customer_owner: {
        perms: ['store:customers:update'],
        readOnly: false,
        confirm: true,
        irreversible: false,
        domain: 'customers',
        version: '1',
      },
      list_customer_notes: {
        perms: ['store:customers:read'],
        readOnly: true,
        confirm: false,
        irreversible: false,
        domain: 'customers',
        version: '1',
      },
      add_customer_note: {
        perms: ['store:customers:update'],
        readOnly: false,
        confirm: true,
        irreversible: false,
        domain: 'customers',
        version: '1',
      },
    });
  });

  describe('get_customer_crm_profile', () => {
    it('compone cliente, perfil CRM y segmentos', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.get_customer_crm_profile, {
        customer_id: 4,
      });
      expect(deps.customersService.findOne).toHaveBeenCalledWith(7, 4);
      expect(deps.customerCrmService.getProfile).toHaveBeenCalledWith(4);
      expect(deps.segmentMembersService.ofCustomer).toHaveBeenCalledWith(4);
      expect(out.customer.name).toBe('Ana Gómez');
      expect(out.customer.total_orders).toBe(3);
      expect(out.crm.tags).toEqual([{ id: 2, name: 'VIP' }]);
      expect(out.crm.open_tasks).toBe(1);
      expect(out.segments).toEqual([{ id: 5, name: 'Frecuentes' }]);
    });

    it('rechaza un cliente inexistente o de otra tienda', async () => {
      const { deps, byName } = buildTools();
      deps.customersService.findOne.mockRejectedValue(
        new VendixHttpException(ErrorCodes.CUST_FIND_001),
      );
      const out = await run(byName.get_customer_crm_profile, {
        customer_id: 999,
      });
      expect(out.error).toContain('No se pudo leer la ficha del cliente');
      expect(out.error).toContain('CUST_FIND_001');
      expect(out.next_step).toContain('find_customer');
      expect(deps.customerCrmService.getProfile).not.toHaveBeenCalled();
    });
  });

  describe('archive_customer', () => {
    it('preview: error si ya está archivado', async () => {
      const { deps, byName } = buildTools();
      deps.customersService.findOne.mockResolvedValue({
        ...ANA,
        state: 'archived',
      });
      const p = await preview(byName.archive_customer, { customer_id: 4 });
      expect(p.status).toBe('error');
      expect(p.target).toBe('Ana Gómez');
      expect(p.message).toBe('Ana Gómez ya está archivado.');
    });

    it('preview: advierte que no hay restauración', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.archive_customer, {
        customer_id: 4,
        reason: 'duplicado',
      });
      expect(p.status).toBe('warning');
      expect(p.target).toBe('Ana Gómez');
      expect(p.changes[0]).toEqual({
        field: 'state',
        label: 'Estado',
        from: 'active',
        to: 'archived',
      });
      expect(p.changes[1].to).toBe('duplicado');
      expect(p.message).toContain('No existe una opción para restaurarlo');
      expect(p.domain).toBe('customers');
    });

    it('handler: remove(storeId,id) y una sola auditoría ai_agent', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.archive_customer, {
        customer_id: 4,
        reason: 'duplicado',
      });
      expect(deps.customersService.remove).toHaveBeenCalledWith(7, 4);
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
      expect(deps.auditService.log).toHaveBeenCalledWith({
        userId: 11,
        storeId: 7,
        organizationId: 3,
        action: 'DELETE',
        resource: 'customers',
        resourceId: 4,
        oldValues: { state: 'active' },
        newValues: { state: 'archived' },
        metadata: {
          reason: 'duplicado',
          source: 'ai_agent',
          tool: 'archive_customer',
        },
      });
      expect(out.summary).toBe('Cliente Ana Gómez archivado.');
    });

    it('handler: no archiva dos veces ni audita', async () => {
      const { deps, byName } = buildTools();
      deps.customersService.findOne.mockResolvedValue({
        ...ANA,
        state: 'archived',
      });
      const out = await run(byName.archive_customer, { customer_id: 4 });
      expect(out.error).toBe('Ana Gómez ya estaba archivado.');
      expect(deps.customersService.remove).not.toHaveBeenCalled();
      expect(deps.auditService.log).not.toHaveBeenCalled();
    });
  });

  describe('assign_customer_owner', () => {
    it('preview: rechaza ids que no son de la tienda', async () => {
      const { deps, byName } = buildTools();
      const p = await preview(byName.assign_customer_owner, {
        customer_ids: [1, 500],
        owner_user_id: 8,
      });
      expect(p.status).toBe('error');
      expect(p.message).toContain(
        'Estos ids no son clientes de esta tienda: 500.',
      );
      expect(deps.customerCrmService.getProfile).not.toHaveBeenCalled();
    });

    it('preview: filas from → to y conteo de sin cambio', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockImplementation(
        async (id: number) => ({
          owner:
            id === 1
              ? { id: 8, first_name: 'Laura', last_name: 'R' }
              : id === 2
                ? { id: 5, first_name: 'Pedro', last_name: 'S' }
                : null,
        }),
      );
      const p = await preview(byName.assign_customer_owner, {
        customer_ids: [1, 2, 3],
        owner_user_id: 8,
      });
      expect(p.status).toBe('warning');
      expect(p.target).toBe('3 clientes');
      expect(p.changes[0].field).toBe('resumen');
      expect(p.changes[0].to).toContain('2 cliente(s) pasan a usuario #8');
      expect(p.changes.slice(1)).toEqual([
        {
          field: 'cliente_2',
          label: 'Cliente2 Prueba',
          from: 'Pedro S',
          to: 'usuario #8',
        },
        {
          field: 'cliente_3',
          label: 'Cliente3 Prueba',
          from: 'Sin responsable',
          to: 'usuario #8',
        },
      ]);
      expect(p.message).toContain('1 ya tienen ese responsable');
    });

    it('preview: todos sin cambio es error', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      const p = await preview(byName.assign_customer_owner, {
        customer_ids: 1,
        owner_user_id: null,
      });
      expect(p.status).toBe('error');
      expect(p.message).toContain(
        'ya tiene a Sin responsable como responsable',
      );
    });

    it('preview: limita filas y avisa cuántas se muestran', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      const ids = Array.from({ length: 40 }, (_, i) => i + 1);
      const p = await preview(byName.assign_customer_owner, {
        customer_ids: ids,
        owner_user_id: 8,
      });
      expect(p.changes).toHaveLength(26); // summary + 25 rows
      expect(p.message).toContain('se muestran 25 de 40 clientes');
    });

    it('handler: updateProfile por cliente con {owner_user_id} y auditoría resumen', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      const out = await run(byName.assign_customer_owner, {
        customer_ids: [1, 2],
        owner_user_id: 8,
      });
      expect(deps.customerCrmService.updateProfile).toHaveBeenCalledTimes(2);
      expect(deps.customerCrmService.updateProfile).toHaveBeenNthCalledWith(
        1,
        1,
        expect.objectContaining({ owner_user_id: 8 }),
      );
      expect(deps.auditService.log).toHaveBeenCalledTimes(1);
      expect(deps.auditService.log.mock.calls[0][0]).toMatchObject({
        action: 'BULK_UPDATE',
        resource: 'customer_crm_owner',
        newValues: { owner_user_id: 8, customer_ids: [1, 2] },
        metadata: {
          source: 'ai_agent',
          tool: 'assign_customer_owner',
          requested: 2,
          applied: 2,
        },
      });
      expect(out.data.applied).toHaveLength(2);
      expect(out.data.failed).toEqual([]);
    });

    it('handler: un solo cliente no escribe auditoría resumen', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      await run(byName.assign_customer_owner, {
        customer_ids: 1,
        owner_user_id: 7,
      });
      expect(deps.customerCrmService.updateProfile).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ owner_user_id: 7 }),
      );
      expect(deps.auditService.log).not.toHaveBeenCalled();
    });

    it('handler: reporta fallo parcial sin lanzar', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      deps.customerCrmService.updateProfile
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(
          new VendixHttpException(ErrorCodes.CRM_STAFF_001),
        );
      const out = await run(byName.assign_customer_owner, {
        customer_ids: [1, 2],
        owner_user_id: 8,
      });
      expect(out.data.applied).toEqual([
        { customer_id: 1, name: 'Cliente1 Prueba' },
      ]);
      expect(out.data.failed).toEqual([
        { customer_id: 2, name: 'Cliente2 Prueba', reason: 'CRM_STAFF_001' },
      ]);
      expect(out.next_step).toContain('fallaron');
    });

    it('handler: CRM_PROFILE_001 se vuelve una negativa legible', async () => {
      const { deps, byName } = buildTools();
      deps.customerCrmService.getProfile.mockResolvedValue({ owner: null });
      deps.customerCrmService.updateProfile.mockRejectedValue(
        new VendixHttpException(ErrorCodes.CRM_PROFILE_001),
      );
      const out = await run(byName.assign_customer_owner, {
        customer_ids: [1],
        owner_user_id: 8,
      });
      expect(out.error).toContain('CRM_PROFILE_001');
      expect(out.error).toContain('Tu rol no permite cambiar el responsable');
      expect(deps.auditService.log).not.toHaveBeenCalled();
    });

    it('handler: no toca ids de otra tienda', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.assign_customer_owner, {
        customer_ids: [1, 500],
        owner_user_id: 8,
      });
      expect(out.error).toContain(
        'Estos ids no son clientes de esta tienda: 500.',
      );
      expect(deps.customerCrmService.updateProfile).not.toHaveBeenCalled();
    });
  });

  describe('notas', () => {
    it('list_customer_notes llama listNotes con página y límite acotados', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.list_customer_notes, {
        customer_id: 4,
        page: 2,
        limit: 500,
      });
      expect(deps.customerCrmService.listNotes).toHaveBeenCalledWith(4, {
        page: 2,
        limit: 50,
      });
      expect(out.notes).toEqual([
        {
          id: 9,
          body: 'Llamar mañana',
          is_pinned: true,
          author: 'Luis P',
          created_at: '2026-01-01',
        },
      ]);
    });

    it('add_customer_note preview: etiqueta del cliente y extracto de 120 caracteres', async () => {
      const { byName } = buildTools();
      const p = await preview(byName.add_customer_note, {
        customer_id: 4,
        body: 'x'.repeat(300),
        is_pinned: true,
      });
      expect(p.status).toBe('ok');
      expect(p.target).toBe('Ana Gómez');
      expect(p.changes[0].to).toBe(`${'x'.repeat(120)}…`);
      expect(p.changes[1]).toEqual({
        field: 'is_pinned',
        label: 'Fijada',
        from: false,
        to: true,
      });
    });

    it('add_customer_note handler: createNote con el DTO y devuelve el id', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.add_customer_note, {
        customer_id: 4,
        body: '  Pidió factura  ',
      });
      expect(deps.customerCrmService.createNote).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ body: 'Pidió factura' }),
      );
      expect(out.data.note_id).toBe(33);
    });

    it('add_customer_note rechaza notas de más de 5000 caracteres', async () => {
      const { deps, byName } = buildTools();
      const out = await run(byName.add_customer_note, {
        customer_id: 4,
        body: 'y'.repeat(5001),
      });
      expect(out.error).toContain('Los datos no pasaron la validación');
      expect(deps.customerCrmService.createNote).not.toHaveBeenCalled();
    });
  });

  it('sin store_id todo handler responde error y no toca servicios', async () => {
    const { deps, byName } = buildTools();
    const expected =
      'Sin tienda en contexto: los clientes y el CRM se gestionan siempre dentro de una tienda.';
    for (const name of [
      'get_customer_crm_profile',
      'archive_customer',
      'assign_customer_owner',
      'list_customer_notes',
      'add_customer_note',
    ]) {
      const out = await run(
        byName[name],
        { customer_id: 4, customer_ids: [4], owner_user_id: 8, body: 'hola' },
        { organization_id: 3, user_id: 11 } as any,
      );
      expect(out.error).toBe(expected);
    }
    expect(deps.customersService.findOne).not.toHaveBeenCalled();
    expect(deps.customerCrmService.updateProfile).not.toHaveBeenCalled();
    expect(deps.auditService.log).not.toHaveBeenCalled();
  });
});
