import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  createPurchasingTools,
  PurchasingToolDeps,
} from './purchasing.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 5 — contrato O-33..O-36 (compras).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) requiresConfirmation +
 * preview con sujeto humano en writes, con re-verificación en el handler.
 * La recepción preserva la guarda PO_VARIANT_001 del servicio dueño.
 */
describe('purchasing.tools · O-33..O-36 compras', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: {
    purchaseOrdersService?: Record<string, any>;
    suppliersService?: Record<string, any>;
  } = {}) {
    const deps = {
      purchaseOrdersService: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        getReceptions: jest.fn(),
        getCostSummary: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        approve: jest.fn(),
        cancel: jest.fn(),
        receive: jest.fn(),
        ...overrides.purchaseOrdersService,
      } as any,
      suppliersService: {
        findOne: jest.fn(),
        ...overrides.suppliersService,
      } as any,
    } satisfies PurchasingToolDeps;
    return { deps, tools: createPurchasingTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const PO_ROW = {
    id: 501,
    order_number: 'OC-2026-0501',
    supplier_id: 21,
    suppliers: { name: 'Distribuidora Andina' },
    location: { name: 'Bodega central' },
    status: 'approved',
    payment_status: 'partial',
    subtotal_amount: '1000000',
    tax_amount: '190000',
    total_amount: '1190000',
    order_date: '2026-09-18T00:00:00.000Z',
    expected_date: '2026-09-25T00:00:00.000Z',
    next_payment_date: '2026-10-02',
    purchase_order_items: [
      {
        id: 9001,
        product_id: 9,
        products: { name: 'Café 500g', sku: 'CAFE-500' },
        product_variant_id: null,
        product_variants: null,
        quantity_ordered: 100,
        quantity_received: 40,
        unit_cost: '10000',
      },
    ],
  };

  describe('contrato de familia', () => {
    it('declara version 1 en las cuatro tools', () => {
      const { tools } = buildTools();
      for (const name of [
        'list_purchase_orders',
        'get_purchase_order',
        'manage_purchase_orders',
        'approve_receive_purchase_order',
      ]) {
        expect(getTool(tools, name).version).toBe('1');
      }
    });

    it('reads readOnly con permiso de lectura; writes con confirmación', () => {
      const { tools } = buildTools();
      for (const name of ['list_purchase_orders', 'get_purchase_order']) {
        const tool = getTool(tools, name);
        expect(tool.readOnly).toBe(true);
        expect(tool.requiresConfirmation).toBeUndefined();
        expect(tool.requiredPermissions).toEqual([
          'store:orders:purchase_orders:read',
        ]);
      }
      const manage = getTool(tools, 'manage_purchase_orders');
      expect(manage.requiresConfirmation).toBe(true);
      expect(typeof manage.preview).toBe('function');
      expect(manage.requiredPermissions).toEqual([
        'store:orders:purchase_orders:create',
        'store:orders:purchase_orders:update',
        'store:orders:purchase_orders:cancel',
      ]);
      const approveReceive = getTool(tools, 'approve_receive_purchase_order');
      expect(approveReceive.requiresConfirmation).toBe(true);
      expect(typeof approveReceive.preview).toBe('function');
      expect(approveReceive.requiredPermissions).toEqual([
        'store:orders:purchase_orders:approve',
        'store:orders:purchase_orders:receive',
      ]);
    });
  });

  describe('list_purchase_orders (O-33)', () => {
    it('happy: filas compactas con paginación', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findAll: jest.fn().mockResolvedValue({
            data: [PO_ROW],
            meta: { total: 1, page: 1, limit: 10, total_pages: 1 },
          }),
        },
      });
      const tool = getTool(tools, 'list_purchase_orders');
      const answer = JSON.parse(
        await tool.handler!({ status: 'approved' }, CONTEXT),
      );

      expect(answer).toEqual({
        resumen: '1 orden(es) de 1 en total',
        pagina: 1,
        paginas: 1,
        ordenes: [
          {
            purchase_order_id: 501,
            order_number: 'OC-2026-0501',
            supplier_id: 21,
            supplier: 'Distribuidora Andina',
            location: 'Bodega central',
            status: 'approved',
            payment_status: 'partial',
            subtotal: 1000000,
            tax: 190000,
            total: 1190000,
            order_date: '2026-09-18T00:00:00.000Z',
            expected_date: '2026-09-25T00:00:00.000Z',
            next_payment_date: '2026-10-02',
            lines_count: 1,
          },
        ],
      });
      expect(answer.ordenes).toHaveLength(1);
      expect(answer.ordenes[0]).toEqual(
        expect.objectContaining({
          purchase_order_id: 501,
          order_number: 'OC-2026-0501',
          supplier: 'Distribuidora Andina',
          status: 'approved',
          total: 1190000,
        }),
      );
    });

    it('sad: status inválido no llama al servicio', async () => {
      const { tools, deps } = buildTools();
      const tool = getTool(tools, 'list_purchase_orders');
      const answer = JSON.parse(
        await tool.handler!({ status: 'enviada' }, CONTEXT),
      );

      expect(answer.error).toMatch(/inválido/);
      expect(deps.purchaseOrdersService.findAll).not.toHaveBeenCalled();
    });
  });

  describe('get_purchase_order (O-34)', () => {
    it('happy: detalle + recepciones + costos en una respuesta', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue({
            ...PO_ROW,
            payment_terms: '30 días',
            notes: null,
            payment_schedules: [{ scheduled_date: '2026-10-02' }],
          }),
          getReceptions: jest.fn().mockResolvedValue([{ id: 1 }]),
          getCostSummary: jest.fn().mockResolvedValue({ total: 1190000 }),
        },
      });
      const tool = getTool(tools, 'get_purchase_order');
      const answer = JSON.parse(
        await tool.handler!({ purchase_order_id: 501 }, CONTEXT),
      );

      expect(answer).toEqual({
        orden: {
          purchase_order_id: 501,
          order_number: 'OC-2026-0501',
          supplier_id: 21,
          supplier: 'Distribuidora Andina',
          location: 'Bodega central',
          status: 'approved',
          payment_status: 'partial',
          subtotal: 1000000,
          tax: 190000,
          total: 1190000,
          order_date: '2026-09-18T00:00:00.000Z',
          expected_date: '2026-09-25T00:00:00.000Z',
          next_payment_date: '2026-10-02',
          lines_count: 1,
          payment_terms: '30 días',
          notes: null,
          lineas: [
            {
              line_id: 9001,
              product_id: 9,
              product: 'Café 500g',
              sku: 'CAFE-500',
              variant_id: null,
              variant: null,
              ordered: 100,
              received: 40,
              pending: 60,
              unit_cost: 10000,
            },
          ],
          calendario_pagos: [{ scheduled_date: '2026-10-02' }],
        },
        recepciones: [{ id: 1 }],
        resumen_costos: { total: 1190000 },
      });
      expect(answer.orden.order_number).toBe('OC-2026-0501');
      expect(answer.orden.lineas[0]).toEqual(
        expect.objectContaining({
          line_id: 9001,
          product: 'Café 500g',
          ordered: 100,
          received: 40,
          pending: 60,
        }),
      );
      expect(answer.recepciones).toHaveLength(1);
      expect(answer.resumen_costos).toEqual({ total: 1190000 });
    });

    it('sad: OC inexistente responde {error, next_step}', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest
            .fn()
            .mockRejectedValue(
              new VendixHttpException(
                ErrorCodes.PO_FIND_001,
                'La orden de compra 999 no existe.',
              ),
            ),
          getReceptions: jest.fn().mockResolvedValue(null),
          getCostSummary: jest.fn().mockResolvedValue(null),
        },
      });
      const tool = getTool(tools, 'get_purchase_order');
      const answer = JSON.parse(
        await tool.handler!({ purchase_order_id: 999 }, CONTEXT),
      );

      expect(answer.error).toMatch(/999/);
      expect(answer.next_step).toMatch(/list_purchase_orders/);
    });
  });

  describe('manage_purchase_orders (O-35)', () => {
    it('preview create nombra proveedor humano y estimado', async () => {
      const { tools } = buildTools({
        suppliersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 21, name: 'Distribuidora Andina' }),
        },
      });
      const tool = getTool(tools, 'manage_purchase_orders');
      const preview = await tool.preview!(
        {
          action: 'create',
          supplier_id: 21,
          location_id: 4,
          items: [{ product_id: 9, quantity: 100, unit_price: 10000 }],
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Nueva OC — Distribuidora Andina',
        changes: [
          {
            field: 'supplier',
            label: 'Proveedor',
            from: null,
            to: 'Distribuidora Andina',
          },
          {
            field: 'items',
            label: 'Líneas',
            from: null,
            to: '1 línea(s), estimado $1000000',
          },
          {
            field: 'status',
            label: 'Estado inicial',
            from: null,
            to: 'draft (la aprobación es un acto aparte)',
          },
        ],
        domain: 'purchasing',
      });
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('Nueva OC — Distribuidora Andina');
    });

    it('preview cancel sobre recibida aborta sin token', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...PO_ROW, status: 'received' }),
        },
      });
      const tool = getTool(tools, 'manage_purchase_orders');
      const preview = await tool.preview!(
        { action: 'cancel', purchase_order_id: 501 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/received/);
    });

    it('preview update sobre no-borrador aborta sin token', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
        },
      });
      const tool = getTool(tools, 'manage_purchase_orders');
      const preview = await tool.preview!(
        { action: 'update', purchase_order_id: 501 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/borrador/);
    });

    it('handler create valida DTO real y delega en el servicio dueño', async () => {
      const { tools, deps } = buildTools({
        purchaseOrdersService: {
          create: jest.fn().mockResolvedValue({
            id: 502,
            order_number: 'OC-2026-0502',
            status: 'draft',
          }),
        },
        suppliersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ id: 21, name: 'Distribuidora Andina' }),
        },
      });
      const tool = getTool(tools, 'manage_purchase_orders');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'create',
            supplier_id: 21,
            location_id: 4,
            items: [{ product_id: 9, quantity: 100, unit_price: 10000 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.purchase_order_id).toBe(502);
      expect(answer.siguiente_paso).toMatch(/approve_receive_purchase_order/);
      expect(deps.purchaseOrdersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ supplier_id: 21, location_id: 4 }),
      );
    });

    it('handler cancel re-verifica: si ya se recibió, no cancela', async () => {
      const { tools, deps } = buildTools({
        purchaseOrdersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...PO_ROW, status: 'received' }),
          cancel: jest.fn(),
        },
      });
      const tool = getTool(tools, 'manage_purchase_orders');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'cancel', purchase_order_id: 501 },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/received/);
      expect(deps.purchaseOrdersService.cancel).not.toHaveBeenCalled();
    });
  });

  describe('approve_receive_purchase_order (O-36)', () => {
    const DRAFT = { ...PO_ROW, status: 'draft' };

    it('preview approve nombra la OC humana', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(DRAFT),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const preview = await tool.preview!(
        { purchase_order_id: 501, action: 'approve' },
        CONTEXT,
      );

      expect(preview.status).toBe('ok');
      expect(preview.target).toBe('OC OC-2026-0501 — Distribuidora Andina');
      expect(preview.changes).toContainEqual(
        expect.objectContaining({ from: 'draft', to: 'approved' }),
      );
    });

    it('preview receive detalla líneas con pendientes y advierte stock real', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const preview = await tool.preview!(
        {
          purchase_order_id: 501,
          action: 'receive',
          items: [{ id: 9001, quantity_received: 60 }],
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'warning',
        target: 'OC OC-2026-0501 — Distribuidora Andina',
        changes: [
          {
            field: 'reception',
            label: 'Recepción',
            from: null,
            to: 'Café 500g: 60u (pendiente 60)',
          },
        ],
        message:
          'La recepción mueve stock real a la bodega y recalcula costos. Guarda PO_VARIANT_001: una línea sin variante sobre un producto con variantes rechaza la recepción.',
        domain: 'purchasing',
      });
      expect(preview.status).toBe('warning');
      expect(JSON.stringify(preview.changes)).toMatch(/pendiente 60/);
      expect(preview.message).toMatch(/PO_VARIANT_001/);
    });

    it('preview receive sobre borrador aborta sin token', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(DRAFT),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const preview = await tool.preview!(
        {
          purchase_order_id: 501,
          action: 'receive',
          items: [{ id: 9001, quantity_received: 10 }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/draft/);
    });

    it('handler receive happy delega con DTO validado', async () => {
      const { tools, deps } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          receive: jest
            .fn()
            .mockResolvedValue({ ...PO_ROW, status: 'received' }),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const answer = JSON.parse(
        await tool.handler!(
          {
            purchase_order_id: 501,
            action: 'receive',
            items: [{ id: 9001, quantity_received: 60 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.status).toBe('received');
      expect(deps.purchaseOrdersService.receive).toHaveBeenCalledWith(
        501,
        expect.objectContaining({
          items: [
            expect.objectContaining({ id: 9001, quantity_received: 60 }),
          ],
        }),
      );
    });

    it('handler receive preserva PO_VARIANT_001 con escape hatch a cancel', async () => {
      const { tools, deps } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          receive: jest.fn().mockRejectedValue(
            new VendixHttpException(
              ErrorCodes.PO_VARIANT_001,
              'La línea 9001 no indica variante y "Café 500g" maneja 3.',
            ),
          ),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const answer = JSON.parse(
        await tool.handler!(
          {
            purchase_order_id: 501,
            action: 'receive',
            items: [{ id: 9001, quantity_received: 60 }],
          },
          CONTEXT,
        ),
      );

      expect(deps.purchaseOrdersService.receive).toHaveBeenCalled();
      expect(answer.code).toBe('PO_VARIANT_001');
      expect(answer.error).toMatch(/variante/);
      expect(answer.next_step).toMatch(/manage_purchase_orders \(cancel\)/);
    });

    it('handler approve_and_receive aprueba y luego recibe en secuencia', async () => {
      const { tools, deps } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(DRAFT),
          approve: jest
            .fn()
            .mockResolvedValue({ ...PO_ROW, status: 'approved' }),
          receive: jest
            .fn()
            .mockResolvedValue({ ...PO_ROW, status: 'partial' }),
        },
      });
      const tool = getTool(tools, 'approve_receive_purchase_order');
      const answer = JSON.parse(
        await tool.handler!(
          {
            purchase_order_id: 501,
            action: 'approve_and_receive',
            items: [{ id: 9001, quantity_received: 10 }],
          },
          CONTEXT,
        ),
      );

      expect(deps.purchaseOrdersService.approve).toHaveBeenCalledWith(501);
      expect(deps.purchaseOrdersService.receive).toHaveBeenCalledWith(
        501,
        expect.anything(),
      );
      expect(answer.status).toBe('partial');
    });
  });

  describe('record_po_payment (O-37)', () => {
    const PAYMENT_ARGS = {
      purchase_order_id: 501,
      amount: 400000,
      payment_date: '2026-09-29',
      payment_method: 'transferencia',
      reference: 'TR-8821',
    };

    function paymentTools(prior: any[] = [{ amount: '790000' }]) {
      return buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          getPayments: jest.fn().mockResolvedValue(prior),
          registerPayment: jest.fn().mockResolvedValue({
            id: 77,
            payment_status: 'paid',
          }),
        },
      });
    }

    it('contrato: version 1, confirmación, preview y permiso de pago', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'record_po_payment');
      expect(tool.version).toBe('1');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:orders:purchase_orders:pay',
      ]);
    });

    it('preview muestra pagado, saldo y saldo después', async () => {
      const { tools } = paymentTools();
      const tool = getTool(tools, 'record_po_payment');
      const preview = await tool.preview!(PAYMENT_ARGS, CONTEXT);

      expect(preview).toEqual({
        status: 'ok',
        target: 'OC OC-2026-0501 — Distribuidora Andina — pago de $400000',
        changes: [
          {
            field: 'payment',
            label: 'Pago',
            from: 'pagado $790000 de $1190000',
            to: '+$400000 (transferencia, 2026-09-29)',
          },
          {
            field: 'balance',
            label: 'Saldo después',
            from: '$400000',
            to: '$0',
          },
        ],
        domain: 'purchasing',
      });
    });

    it('preview frena el sobrepago sin token ni llamado', async () => {
      const registerPayment = jest.fn();
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          getPayments: jest.fn().mockResolvedValue([{ amount: '790000' }]),
          registerPayment,
        },
      });
      const tool = getTool(tools, 'record_po_payment');
      const preview = await tool.preview!(
        { ...PAYMENT_ARGS, amount: 400001 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/excede el saldo pendiente/);
      expect(registerPayment).not.toHaveBeenCalled();
    });

    it('preview rechaza monto cero (piso del DTO) sin leer la orden', async () => {
      const findOne = jest.fn();
      const { tools } = buildTools({
        purchaseOrdersService: { findOne },
      });
      const tool = getTool(tools, 'record_po_payment');
      const preview = await tool.preview!(
        { ...PAYMENT_ARGS, amount: 0 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/validación/);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('handler happy registra con DTO validado', async () => {
      const { tools, deps } = paymentTools();
      const tool = getTool(tools, 'record_po_payment');
      const answer = JSON.parse(
        await tool.handler!(PAYMENT_ARGS, CONTEXT),
      );

      expect(answer.payment_id).toBe(77);
      expect(answer.purchase_order_id).toBe(501);
      expect(deps.purchaseOrdersService.registerPayment).toHaveBeenCalledWith(
        501,
        expect.objectContaining({
          amount: 400000,
          payment_method: 'transferencia',
        }),
      );
    });

    it('handler re-verifica: si otro pago entró, no duplica', async () => {
      const registerPayment = jest.fn();
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          getPayments: jest
            .fn()
            .mockResolvedValue([{ amount: '1190000' }]),
          registerPayment,
        },
      });
      const tool = getTool(tools, 'record_po_payment');
      const answer = JSON.parse(
        await tool.handler!(PAYMENT_ARGS, CONTEXT),
      );

      expect(answer.error).toMatch(/otro pago entró/);
      expect(answer.next_step).toMatch(/get_purchase_order/);
      expect(registerPayment).not.toHaveBeenCalled();
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const { tools } = buildTools({
        purchaseOrdersService: {
          findOne: jest.fn().mockResolvedValue(PO_ROW),
          getPayments: jest.fn().mockResolvedValue([]),
          registerPayment: jest
            .fn()
            .mockRejectedValue(new Error('CxP bloqueada')),
        },
      });
      const tool = getTool(tools, 'record_po_payment');
      const answer = JSON.parse(
        await tool.handler!(PAYMENT_ARGS, CONTEXT),
      );

      expect(answer.error).toMatch(/CxP bloqueada/);
      expect(answer.next_step).toMatch(/get_purchase_order/);
    });
  });
});
