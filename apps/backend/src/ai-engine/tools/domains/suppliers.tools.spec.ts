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
});
