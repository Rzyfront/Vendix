import {
  createReturnTools,
  ReturnToolDeps,
} from './returns.tools';
import { RegisteredTool } from '../interfaces/tool.interface';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';

/**
 * Track B paso 10 — contrato O-29 (devoluciones).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) requiresConfirmation +
 * preview con sujeto humano y re-verificación en el handler. Solo el borrador
 * acepta edición o proceso; procesar mueve stock real vía el servicio dueño.
 */
describe('returns.tools · O-29 manage_return_orders', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: Record<string, any> = {}) {
    const deps = {
      returnOrdersService: {
        create: jest.fn(),
        findAll: jest.fn(),
        findOne: jest.fn(),
        update: jest.fn(),
        process: jest.fn(),
        cancel: jest.fn(),
        remove: jest.fn(),
        ...overrides,
      } as any,
    } satisfies ReturnToolDeps;
    return { deps, tools: createReturnTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const DRAFT = {
    id: 301,
    type: 'purchase_return',
    status: 'draft',
    related_order_id: 101,
    related_order_type: 'purchase_order',
    partner_type: 'supplier',
    return_order_items: [
      {
        id: 7001,
        product_id: 9,
        products: { name: 'Café 500g', sku: 'CAFE-500' },
        quantity: 2,
        condition: 'good',
      },
      {
        id: 7002,
        product_id: 10,
        products: { name: 'Panela 1kg', sku: 'PAN-1K' },
        quantity: 1,
        condition: 'damaged',
      },
    ],
  };

  describe('contrato de familia', () => {
    it('declara version 1, confirmación, preview y los 5 permisos', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_return_orders');
      expect(tool.version).toBe('1');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:orders:return_orders:create',
        'store:orders:return_orders:update',
        'store:orders:return_orders:process',
        'store:orders:return_orders:cancel',
        'store:orders:return_orders:delete',
      ]);
    });
  });

  describe('create', () => {
    it('preview muestra clase humana y líneas con estado inicial', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'create',
          type: 'purchase_return',
          related_order_id: 101,
          lines: [{ product_id: 9, quantity: 2 }],
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Nueva devolución — devolución de compra (al proveedor)',
        changes: [
          {
            field: 'type',
            label: 'Clase',
            from: null,
            to: 'devolución de compra (al proveedor)',
          },
          {
            field: 'lines',
            label: 'Líneas (1)',
            from: null,
            to: 'producto #9 x2 (good)',
          },
          {
            field: 'status',
            label: 'Estado inicial',
            from: null,
            to: 'draft (procesar mueve stock)',
          },
        ],
        domain: 'returns',
      });
    });

    it('preview sin líneas aborta sin token ni llamado', async () => {
      const create = jest.fn();
      const { tools } = buildTools({ create });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        { action: 'create', type: 'purchase_return', lines: [] },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/validación/);
      expect(create).not.toHaveBeenCalled();
    });

    it('handler happy delega con DTO validado', async () => {
      const create = jest.fn().mockResolvedValue({
        id: 302,
        type: 'purchase_return',
        status: 'draft',
      });
      const { tools } = buildTools({ create });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'create',
            type: 'purchase_return',
            related_order_id: 101,
            lines: [{ product_id: 9, quantity: 2 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.return_id).toBe(302);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'purchase_return' }),
      );
    });
  });

  describe('QUI-893 B1 — clientes se reembolsan con refund_order', () => {
    it('declara solo purchase_return y nombra refund_order en la descripción', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_return_orders');
      const props = (tool.parameters as any).properties;
      expect(props.type.enum).toEqual(['purchase_return']);
      expect(props.related_order_type.enum).toEqual(['purchase_order']);
      expect(props.partner_type.enum).toEqual(['supplier']);
      expect(tool.description).toMatch(/refund_order/);
      expect(tool.description).not.toMatch(/reembolso contable/);
    });

    it.each([
      [{ type: 'sales_return' }],
      [{ type: 'purchase_return', related_order_type: 'sales_order' }],
      [{ type: 'purchase_return', partner_type: 'customer' }],
    ])('create de devolución de cliente %j: preview y handler derivan a refund_order sin llamar al servicio', async (fields) => {
      const create = jest.fn();
      const { tools } = buildTools({ create });
      const tool = getTool(tools, 'manage_return_orders');
      const args = {
        action: 'create',
        related_order_id: 101,
        lines: [{ product_id: 9, quantity: 1 }],
        ...fields,
      };
      const preview = await tool.preview!(args, CONTEXT);
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/Reembolsar desde el detalle de la orden/);
      expect(preview.message).toMatch(/refund_order/);

      const answer = JSON.parse(await tool.handler!(args, CONTEXT));
      expect(answer.code).toBe('RETURN_ORDER_SALES_USE_REFUND_001');
      expect(answer.next_step).toMatch(/preview_refund/);
      expect(create).not.toHaveBeenCalled();
    });

    it('preview de process sobre un borrador viejo de cliente aborta y deriva a refund_order', async () => {
      const process = jest.fn();
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...DRAFT,
          type: 'sales_return',
          related_order_type: 'sales_order',
          partner_type: 'customer',
        }),
        process,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'process',
          return_id: 301,
          process_items: [{ id: 7001, action: 'restock' }],
        },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/refund_order/);
      expect(process).not.toHaveBeenCalled();
    });

    it('handler traduce el rechazo del dominio en la guía de refund_order', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        process: jest
          .fn()
          .mockRejectedValue(
            new VendixHttpException(ErrorCodes.RETURN_ORDER_SALES_USE_REFUND_001),
          ),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'process',
            return_id: 301,
            process_items: [{ id: 7001, action: 'restock' }],
          },
          CONTEXT,
        ),
      );
      expect(answer.code).toBe('RETURN_ORDER_SALES_USE_REFUND_001');
      expect(answer.next_step).toMatch(/refund_order/);
    });
  });

  describe('process', () => {
    it('preview nombra productos humanos con acción por línea', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'process',
          return_id: 301,
          process_items: [
            { id: 7001, action: 'restock', location_id: 4 },
            { id: 7002, action: 'write_off' },
          ],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe(
        'Devolución #301 — devolución de compra (al proveedor) (draft)',
      );
      expect(JSON.stringify(preview.changes)).toMatch(
        /Café 500g x2 → reingresar a inventario/,
      );
      expect(JSON.stringify(preview.changes)).toMatch(
        /Panela 1kg x1 → dar de baja/,
      );
      expect(preview.message).toMatch(/irreversible/);
    });

    it('preview con línea ajena aborta citando las líneas reales', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'process',
          return_id: 301,
          process_items: [{ id: 9999, action: 'restock' }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/7001, 7002/);
    });

    it('preview sobre procesada aborta sin token', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...DRAFT,
          status: 'processed',
        }),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'process',
          return_id: 301,
          process_items: [{ id: 7001, action: 'restock' }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/solo un borrador puede procesarse/);
    });

    it('handler happy procesa con acciones validadas', async () => {
      const process = jest.fn().mockResolvedValue({
        ...DRAFT,
        status: 'processed',
      });
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        process,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'process',
            return_id: 301,
            process_items: [{ id: 7001, action: 'restock', location_id: 4 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.status).toBe('processed');
      expect(process).toHaveBeenCalledWith(301, [
        { id: 7001, action: 'restock', location_id: 4 },
      ]);
    });

    it('handler re-verifica: si otro procesó en el medio, no duplica', async () => {
      const process = jest.fn();
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...DRAFT,
          status: 'processed',
        }),
        process,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'process',
            return_id: 301,
            process_items: [{ id: 7001, action: 'restock' }],
          },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/solo un borrador puede procesarse/);
      expect(process).not.toHaveBeenCalled();
    });
  });

  describe('update / cancel / delete', () => {
    it('preview update con líneas aborta (no se editan por esta vía)', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        {
          action: 'update',
          return_id: 301,
          lines: [{ product_id: 9, quantity: 5 }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/no se editan por esta vía/);
    });

    it('handler update happy delega escalares validados', async () => {
      const update = jest.fn().mockResolvedValue({
        ...DRAFT,
        partner_id: 55,
      });
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        update,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', return_id: 301, partner_id: 55 },
          CONTEXT,
        ),
      );

      expect(answer.status).toBe('draft');
      expect(update).toHaveBeenCalledWith(
        301,
        expect.objectContaining({ partner_id: 55 }),
      );
    });

    it('preview cancel advierte que no mueve stock', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        { action: 'cancel', return_id: 301 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.message).toMatch(/sin reingresar/);
    });

    it('preview cancel sobre procesada aborta', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...DRAFT,
          status: 'processed',
        }),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        { action: 'cancel', return_id: 301 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/ya está procesada/);
    });

    it('handler cancel happy cierra sin mover stock', async () => {
      const cancel = jest.fn().mockResolvedValue({
        ...DRAFT,
        status: 'cancelled',
      });
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        cancel,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!({ action: 'cancel', return_id: 301 }, CONTEXT),
      );

      expect(answer.status).toBe('cancelled');
      expect(cancel).toHaveBeenCalledWith(301);
    });

    it('preview delete sobre procesada advierte que el stock no se revierte', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue({
          ...DRAFT,
          status: 'processed',
        }),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const preview = await tool.preview!(
        { action: 'delete', return_id: 301 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.message).toMatch(/NO se revierte/);
    });

    it('handler delete happy elimina el registro', async () => {
      const remove = jest.fn().mockResolvedValue({ id: 301 });
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        remove,
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!({ action: 'delete', return_id: 301 }, CONTEXT),
      );

      expect(answer.return_id).toBe(301);
      expect(remove).toHaveBeenCalledWith(301);
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const { tools } = buildTools({
        findOne: jest.fn().mockResolvedValue(DRAFT),
        cancel: jest.fn().mockRejectedValue(new Error('bloqueo contable')),
      });
      const tool = getTool(tools, 'manage_return_orders');
      const answer = JSON.parse(
        await tool.handler!({ action: 'cancel', return_id: 301 }, CONTEXT),
      );

      expect(answer.error).toMatch(/bloqueo contable/);
      expect(answer.next_step).toMatch(/return-orders/);
    });
  });
});
