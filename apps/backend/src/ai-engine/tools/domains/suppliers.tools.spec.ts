import {
  createSupplierTools,
  SupplierToolDeps,
} from './suppliers.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 5 — contrato O-38 / O-41 (proveedores read-first).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) `readOnly: true` en reads.
 */
describe('suppliers.tools · O-38 find_supplier / O-41 get_supplier_summary', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      suppliersService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        getSupplierSummary: jest.fn(),
        getSupplierPurchaseOrders: jest.fn(),
        getSupplierPayables: jest.fn(),
        ...overrides,
      } as any,
    } satisfies SupplierToolDeps;
    return createSupplierTools(deps);
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  describe('contrato de familia', () => {
    it('declara version 1, readOnly y permiso de lectura en ambos reads', () => {
      const tools = buildTools();
      for (const name of ['find_supplier', 'get_supplier_summary']) {
        const tool = getTool(tools, name);
        expect(tool.version).toBe('1');
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.requiredPermissions).toEqual([
          'store:inventory:suppliers:read',
        ]);
      }
    });
  });

  describe('find_supplier (O-38)', () => {
    const CANDIDATES = [
      {
        id: 21,
        name: 'Distribuidora Andina',
        code: 'AND-01',
        state: 'active',
        contact_person: 'Marcela Ríos',
        email: 'compras@andina.co',
        phone: '6015550101',
        tax_id: '900123456',
        supplier_products: [{}, {}, {}],
      },
      {
        id: 22,
        name: 'Andina Foods SAS',
        code: 'AND-02',
        state: 'active',
        contact_person: null,
        email: null,
        phone: null,
        tax_id: null,
        supplier_products: [],
      },
    ];

    it('happy: devuelve candidatas compactas con resolución multi-match', async () => {
      const tools = buildTools({
        findAll: jest.fn().mockResolvedValue({
          data: CANDIDATES,
          meta: { total: 2, page: 1, limit: 5, totalPages: 1 },
        }),
      });
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(
        await tool.handler!({ query: 'andina' }, CONTEXT),
      );

      expect(answer).toEqual({
        busqueda: 'andina',
        encontrados: 2,
        total_coincidencias: 2,
        hay_mas: false,
        resolucion:
          'Varias coincidencias: confirma con el usuario cuál antes de actuar.',
        candidatos: [
          {
            supplier_id: 21,
            name: 'Distribuidora Andina',
            code: 'AND-01',
            state: 'active',
            contact_person: 'Marcela Ríos',
            email: 'compras@andina.co',
            phone: '6015550101',
            tax_id: '900123456',
            products_count: 3,
          },
          {
            supplier_id: 22,
            name: 'Andina Foods SAS',
            code: 'AND-02',
            state: 'active',
            contact_person: null,
            email: null,
            phone: null,
            tax_id: null,
            products_count: 0,
          },
        ],
      });
      expect(answer.encontrados).toBe(2);
      expect(answer.candidatos[0]).toEqual({
        supplier_id: 21,
        name: 'Distribuidora Andina',
        code: 'AND-01',
        state: 'active',
        contact_person: 'Marcela Ríos',
        email: 'compras@andina.co',
        phone: '6015550101',
        tax_id: '900123456',
        products_count: 3,
      });
      expect(answer.resolucion).toMatch(/confirma/i);
    });

    it('happy: coincidencia única invita a usar el supplier_id directamente', async () => {
      const tools = buildTools({
        findAll: jest.fn().mockResolvedValue({
          data: [CANDIDATES[0]],
          meta: { total: 1, page: 1, limit: 5, totalPages: 1 },
        }),
      });
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(
        await tool.handler!({ query: '900123456' }, CONTEXT),
      );

      expect(answer.encontrados).toBe(1);
      expect(answer.resolucion).toMatch(/directamente/);
    });

    it('sad: sin coincidencias devuelve nota con el escape a archivados', async () => {
      const tools = buildTools({
        findAll: jest.fn().mockResolvedValue({
          data: [],
          meta: { total: 0, page: 1, limit: 5, totalPages: 0 },
        }),
      });
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(
        await tool.handler!({ query: 'inexistente' }, CONTEXT),
      );

      expect(answer.encontrados).toBe(0);
      expect(answer.candidatos).toEqual([]);
      expect(answer.nota).toMatch(/archived/);
    });

    it('sad: query vacío no llama al servicio', async () => {
      const findAll = jest.fn();
      const tools = buildTools({ findAll });
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(
        await tool.handler!({ query: '   ' }, CONTEXT),
      );

      expect(answer.error).toMatch(/vacío/);
      expect(findAll).not.toHaveBeenCalled();
    });

    it('sad: state inválido no llama al servicio', async () => {
      const findAll = jest.fn();
      const tools = buildTools({ findAll });
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(
        await tool.handler!({ query: 'andina', state: 'borrado' }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
      expect(findAll).not.toHaveBeenCalled();
    });

    it('sad: sin tenant en contexto responde error acotado', async () => {
      const tools = buildTools();
      const tool = getTool(tools, 'find_supplier');
      const answer = JSON.parse(await tool.handler!({ query: 'x' }, {}));

      expect(answer.error).toMatch(/tienda/);
    });
  });

  describe('get_supplier_summary (O-41)', () => {
    const SUMMARY = {
      supplier_id: 21,
      supplier_name: 'Distribuidora Andina',
      supplier: {
        id: 21,
        name: 'Distribuidora Andina',
        code: 'AND-01',
        state: 'active',
        contact_person: 'Marcela Ríos',
        email: 'compras@andina.co',
        phone: '6015550101',
        tax_id: '900123456',
      },
      total_orders: 14,
      total_purchased: 12500000,
      average_order_value: 892857.14,
      outstanding_debt: 3200000,
      overdue_debt: 450000,
      max_days_overdue: 12,
      committed_amount: 1800000,
      committed_orders: 2,
      ytd_purchases: 9800000,
      open_pos_count: 2,
      last_order_date: '2026-09-10T00:00:00.000Z',
      scope: 'STORE',
    };

    it('happy: resume + OCs + cartera en una sola respuesta tipada', async () => {
      const tools = buildTools({
        getSupplierSummary: jest.fn().mockResolvedValue(SUMMARY),
        getSupplierPurchaseOrders: jest
          .fn()
          .mockResolvedValue({ data: [{ id: 501 }], meta: { total: 14 } }),
        getSupplierPayables: jest
          .fn()
          .mockResolvedValue({ data: [{ id: 77, balance: 450000 }] }),
      });
      const tool = getTool(tools, 'get_supplier_summary');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: 21 }, CONTEXT),
      );

      expect(answer).toEqual({
        resumen: {
          supplier_id: 21,
          proveedor: 'Distribuidora Andina',
          identidad: {
            supplier_id: 21,
            name: 'Distribuidora Andina',
            code: 'AND-01',
            state: 'active',
            contact_person: 'Marcela Ríos',
            email: 'compras@andina.co',
            phone: '6015550101',
            tax_id: '900123456',
            products_count: undefined,
          },
          total_ordenes: 14,
          total_comprado_sin_iva: 12500000,
          ticket_promedio: 892857.14,
          deuda_formalizada: 3200000,
          deuda_vencida: 450000,
          max_dias_vencido: 12,
          compromiso_sin_cxp: 1800000,
          ordenes_abiertas: 2,
          comprado_ytd_sin_iva: 9800000,
          ultima_orden: '2026-09-10T00:00:00.000Z',
          alcance: 'STORE',
        },
        ordenes_compra: { data: [{ id: 501 }], meta: { total: 14 } },
        cartera_abierta: { data: [{ id: 77, balance: 450000 }] },
      });
      expect(answer.resumen.proveedor).toBe('Distribuidora Andina');
      // Sin IVA, igual que el Resumen de Compras: viaja el subtotal crudo.
      expect(answer.resumen.total_comprado_sin_iva).toBe(12500000);
      expect(answer.resumen.deuda_formalizada).toBe(3200000);
      expect(answer.resumen.deuda_vencida).toBe(450000);
      expect(answer.ordenes_compra.meta.total).toBe(14);
      expect(answer.cartera_abierta.data).toHaveLength(1);
    });

    it('happy: include_orders/include_payables en false omiten las secciones', async () => {
      const getSupplierPurchaseOrders = jest.fn();
      const getSupplierPayables = jest.fn();
      const tools = buildTools({
        getSupplierSummary: jest.fn().mockResolvedValue(SUMMARY),
        getSupplierPurchaseOrders,
        getSupplierPayables,
      });
      const tool = getTool(tools, 'get_supplier_summary');
      const answer = JSON.parse(
        await tool.handler!(
          { supplier_id: 21, include_orders: false, include_payables: false },
          CONTEXT,
        ),
      );

      expect(answer.resumen.proveedor).toBe('Distribuidora Andina');
      expect(answer.ordenes_compra).toBeUndefined();
      expect(answer.cartera_abierta).toBeUndefined();
      expect(getSupplierPurchaseOrders).not.toHaveBeenCalled();
      expect(getSupplierPayables).not.toHaveBeenCalled();
    });

    it('sad: supplier_id inválido responde {error} sin next_step inventado', async () => {
      const tools = buildTools();
      const tool = getTool(tools, 'get_supplier_summary');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: -3 }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
    });

    it('sad: proveedor inexistente responde {error, next_step}', async () => {
      const tools = buildTools({
        getSupplierSummary: jest
          .fn()
          .mockRejectedValue(new Error('Supplier not found')),
        getSupplierPurchaseOrders: jest.fn().mockResolvedValue(null),
        getSupplierPayables: jest.fn().mockResolvedValue(null),
      });
      const tool = getTool(tools, 'get_supplier_summary');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: 999 }, CONTEXT),
      );

      expect(answer.error).toMatch(/999/);
      expect(answer.next_step).toMatch(/find_supplier/);
    });
  });

  describe('get_supplier (O-39)', () => {
    const SUPPLIER = {
      id: 21,
      name: 'Distribuidora Andina',
      code: 'AND-01',
      state: 'active',
      contact_person: 'Marcela Ríos',
      email: 'compras@andina.co',
      phone: '6015550101',
      tax_id: '900123456',
      payment_terms: 'NET30',
      supplier_products: [
        {
          product_id: 9,
          products: { name: 'Café 500g', sku: 'CAFE-500' },
        },
      ],
    };

    it('contrato: readOnly sin confirmación y permiso de lectura', () => {
      const tools = buildTools();
      const tool = getTool(tools, 'get_supplier');
      expect(tool.version).toBe('1');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(tool.requiredPermissions).toEqual([
        'store:inventory:suppliers:read',
      ]);
    });

    it('happy: detalle con catálogo de productos', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
      });
      const tool = getTool(tools, 'get_supplier');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: 21 }, CONTEXT),
      );

      expect(answer.proveedor).toEqual(
        expect.objectContaining({
          supplier_id: 21,
          name: 'Distribuidora Andina',
          code: 'AND-01',
          state: 'active',
          payment_terms: 'NET30',
          products_count: 1,
          productos: [
            { product_id: 9, name: 'Café 500g', sku: 'CAFE-500' },
          ],
        }),
      );
    });

    it('happy: include_products=false omite el catálogo', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
      });
      const tool = getTool(tools, 'get_supplier');
      const answer = JSON.parse(
        await tool.handler!(
          { supplier_id: 21, include_products: false },
          CONTEXT,
        ),
      );

      expect(answer.proveedor.productos).toBeUndefined();
      expect(answer.proveedor.name).toBe('Distribuidora Andina');
    });

    it('sad: supplier_id inválido no llama al servicio', async () => {
      const findOne = jest.fn();
      const tools = buildTools({ findOne });
      const tool = getTool(tools, 'get_supplier');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: 0 }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('sad: proveedor inexistente responde {error, next_step}', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockRejectedValue(new Error('no existe')),
      });
      const tool = getTool(tools, 'get_supplier');
      const answer = JSON.parse(
        await tool.handler!({ supplier_id: 999 }, CONTEXT),
      );

      expect(answer.error).toMatch(/999/);
      expect(answer.next_step).toMatch(/find_supplier/);
    });
  });

  describe('manage_suppliers (O-40)', () => {
    const SUPPLIER = {
      id: 21,
      name: 'Distribuidora Andina',
      code: 'AND-01',
      state: 'active',
      contact_person: 'Marcela Ríos',
      email: 'compras@andina.co',
      phone: '6015550101',
      tax_id: '900123456',
    };

    it('contrato: version 1, confirmación, preview y permisos de escritura', () => {
      const tools = buildTools();
      const tool = getTool(tools, 'manage_suppliers');
      expect(tool.version).toBe('1');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:inventory:suppliers:create',
        'store:inventory:suppliers:update',
        'store:inventory:suppliers:delete',
      ]);
    });

    it('preview create muestra sujeto humano con nombre y código', async () => {
      const tools = buildTools();
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        {
          action: 'create',
          name: 'Cafés del Sur',
          code: 'SUR-01',
          email: 'hola@sur.co',
        },
        CONTEXT,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Nuevo proveedor — Cafés del Sur (SUR-01)');
      expect(preview.changes).toContainEqual(
        expect.objectContaining({ field: 'email', to: 'hola@sur.co' }),
      );
    });

    it('preview create sin código aborta sin token', async () => {
      const create = jest.fn();
      const tools = buildTools({ create });
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        { action: 'create', name: 'Sin código' },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/validación/);
      expect(create).not.toHaveBeenCalled();
    });

    it('preview set_state muestra el cambio de estado', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
      });
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        { action: 'set_state', supplier_id: 21, state: 'inactive' },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Distribuidora Andina (AND-01)',
        changes: [
          {
            field: 'state',
            label: 'Estado',
            from: 'active',
            to: 'inactive',
          },
        ],
        domain: 'suppliers',
      });
    });

    it('preview set_state con archived aborta (va por delete)', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
      });
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        { action: 'set_state', supplier_id: 21, state: 'archived' },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/va por delete/);
    });

    it('preview delete con documentos abiertos aborta sin token', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
        getSupplierSummary: jest.fn().mockResolvedValue({
          open_pos_count: 2,
          outstanding_debt: 3200000,
        }),
      });
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        { action: 'delete', supplier_id: 21 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/2 orden\(es\) abierta\(s\)/);
    });

    it('preview delete limpio advierte que conserva historia', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
        getSupplierSummary: jest.fn().mockResolvedValue({
          open_pos_count: 0,
          outstanding_debt: 0,
        }),
      });
      const tool = getTool(tools, 'manage_suppliers');
      const preview = await tool.preview!(
        { action: 'delete', supplier_id: 21 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.message).toMatch(/conserva/);
    });

    it('handler create happy delega con DTO validado', async () => {
      const create = jest.fn().mockResolvedValue({
        id: 30,
        name: 'Cafés del Sur',
        code: 'SUR-01',
      });
      const tools = buildTools({ create });
      const tool = getTool(tools, 'manage_suppliers');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'create', name: 'Cafés del Sur', code: 'SUR-01' },
          CONTEXT,
        ),
      );

      expect(answer.supplier_id).toBe(30);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Cafés del Sur', code: 'SUR-01' }),
      );
    });

    it('handler set_state re-verifica: si otro lo cambió, no duplica', async () => {
      const setState = jest.fn();
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...SUPPLIER,
          state: 'inactive',
        }),
        setState,
      });
      const tool = getTool(tools, 'manage_suppliers');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'set_state', supplier_id: 21, state: 'inactive' },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/ya está en/);
      expect(setState).not.toHaveBeenCalled();
    });

    it('handler delete happy archiva vía el servicio', async () => {
      const remove = jest.fn().mockResolvedValue({
        ...SUPPLIER,
        state: 'archived',
      });
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
        remove,
      });
      const tool = getTool(tools, 'manage_suppliers');
      const answer = JSON.parse(
        await tool.handler!({ action: 'delete', supplier_id: 21 }, CONTEXT),
      );

      expect(answer.state).toBe('archived');
      expect(remove).toHaveBeenCalledWith(21);
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const tools = buildTools({
        findOne: jest.fn().mockResolvedValue(SUPPLIER),
        update: jest.fn().mockRejectedValue(new Error('NIT duplicado')),
      });
      const tool = getTool(tools, 'manage_suppliers');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', supplier_id: 21, tax_id: '900999' },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/NIT duplicado/);
      expect(answer.next_step).toMatch(/get_supplier/);
    });
  });
});
