import {
  createInventoryTools,
  InventoryToolServices,
} from './inventory.tools';
import { RegisteredTool } from '../interfaces/tool.interface';

/**
 * Track B paso 5 — contrato O-14 / O-15 (inventario writes).
 *
 * Patrón canónico T4: (a) happy/sad, (b) snapshot de salida, (c) forma
 * `{error, next_step}`, (d) permiso declarado, (e) requiresConfirmation +
 * preview con sujeto humano y re-verificación en el handler.
 *
 * Estos writes mutan stock SOLO vía `StockTransfersService` (que a su vez
 * delega en `StockLevelManager`) y `InventoryAdjustmentsService`: la spec
 * espía que ningún otro escritor interviene.
 */
describe('inventory.tools · O-14 manage_stock_transfers / O-15 approve_stock_adjustment', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  function buildTools(overrides: Partial<InventoryToolServices> = {}) {
    const deps = {
      stockLevelsService: {} as any,
      inventoryIntegrationService: {} as any,
      adjustmentsService: {
        getAdjustmentById: jest.fn(),
        approveAdjustment: jest.fn(),
      } as any,
      movementsService: {} as any,
      locationsService: {
        findAll: jest.fn(),
      } as any,
      transfersService: {
        findOne: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        approve: jest.fn(),
        complete: jest.fn(),
        cancel: jest.fn(),
      } as any,
      ...overrides,
    } satisfies InventoryToolServices;
    return { deps, tools: createInventoryTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  const TRANSFER = {
    id: 301,
    transfer_number: 'TRF-0301',
    from_location_id: 4,
    to_location_id: 9,
    from_location: { name: 'Bodega central' },
    to_location: { name: 'Tienda norte' },
    status: 'pending',
    stock_transfer_items: [
      {
        id: 7001,
        product_id: 9,
        products: { name: 'Café 500g', sku: 'CAFE-500' },
        product_variant_id: null,
        product_variants: null,
        quantity: 50,
      },
    ],
  };

  describe('contrato de familia', () => {
    it('O-14/O-15 declaran version 1, confirmación y preview', () => {
      const { tools } = buildTools();
      const manage = getTool(tools, 'manage_stock_transfers');
      expect(manage.version).toBe('1');
      expect(manage.requiresConfirmation).toBe(true);
      expect(typeof manage.preview).toBe('function');
      expect(manage.requiredPermissions).toEqual([
        'store:stock-transfers:create',
        'store:stock-transfers:update',
      ]);

      const approve = getTool(tools, 'approve_stock_adjustment');
      expect(approve.version).toBe('1');
      expect(approve.requiresConfirmation).toBe(true);
      expect(typeof approve.preview).toBe('function');
      expect(approve.requiredPermissions).toEqual([
        'store:inventory:adjustments:approve',
      ]);
    });

    it('no declara prisma: los writes delegan en los servicios inyectados', () => {
      const { tools } = buildTools();
      expect(getTool(tools, 'manage_stock_transfers')).toBeDefined();
      expect(getTool(tools, 'approve_stock_adjustment')).toBeDefined();
    });
  });

  describe('manage_stock_transfers (O-14)', () => {
    it('preview create muestra origen→destino con cantidades', async () => {
      const { tools } = buildTools({
        locationsService: {
          findAll: jest.fn().mockResolvedValue({
            data: [
              { id: 4, name: 'Bodega central' },
              { id: 9, name: 'Tienda norte' },
            ],
          }),
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const preview = await tool.preview!(
        {
          action: 'create',
          from_location_id: 4,
          to_location_id: 9,
          items: [{ product_id: 9, quantity: 50 }],
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Nueva transferencia — Bodega central → Tienda norte',
        changes: [
          {
            field: 'route',
            label: 'Ruta',
            from: null,
            to: 'Bodega central → Tienda norte',
          },
          {
            field: 'items',
            label: 'Líneas (50 unidades)',
            from: null,
            to: 'producto #9 x50',
          },
          {
            field: 'status',
            label: 'Estado inicial',
            from: null,
            to: 'pending (aprobar reserva en origen)',
          },
        ],
        domain: 'inventory',
      });
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe(
        'Nueva transferencia — Bodega central → Tienda norte',
      );
      expect(JSON.stringify(preview.changes)).toMatch(/50 unidades/);
    });

    it('preview create con misma bodega aborta sin token', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_stock_transfers');
      const preview = await tool.preview!(
        {
          action: 'create',
          from_location_id: 4,
          to_location_id: 4,
          items: [{ product_id: 9, quantity: 1 }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/misma bodega/);
    });

    it('preview approve nombra la transferencia humana y advierte la reserva', async () => {
      const { tools } = buildTools({
        transfersService: {
          findOne: jest.fn().mockResolvedValue(TRANSFER),
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const preview = await tool.preview!(
        { action: 'approve', transfer_id: 301 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe(
        'Transferencia TRF-0301 — Bodega central → Tienda norte',
      );
      expect(preview.changes).toContainEqual(
        expect.objectContaining({ to: 'in_transit (reserva en origen)' }),
      );
      expect(JSON.stringify(preview.changes)).toMatch(/Café 500g x50/);
    });

    it('preview complete rechaza recibir más de lo despachado', async () => {
      const { tools } = buildTools({
        transfersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...TRANSFER, status: 'in_transit' }),
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const preview = await tool.preview!(
        {
          action: 'complete',
          transfer_id: 301,
          items: [{ id: 7001, quantity_received: 80 }],
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/no se puede recibir más de lo enviado/);
    });

    it('handler approve re-verifica: si ya está en tránsito, no re-aprueba', async () => {
      const approve = jest.fn();
      const { tools } = buildTools({
        transfersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...TRANSFER, status: 'in_transit' }),
          approve,
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const answer = JSON.parse(
        await tool.handler!({ action: 'approve', transfer_id: 301 }, CONTEXT),
      );

      expect(answer.error).toMatch(/in_transit/);
      expect(approve).not.toHaveBeenCalled();
    });

    it('handler complete happy delega con items validados', async () => {
      const complete = jest.fn().mockResolvedValue({
        ...TRANSFER,
        status: 'received',
      });
      const { tools } = buildTools({
        transfersService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...TRANSFER, status: 'in_transit' }),
          complete,
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'complete',
            transfer_id: 301,
            items: [{ id: 7001, quantity_received: 50 }],
          },
          CONTEXT,
        ),
      );

      expect(answer.status).toBe('received');
      expect(complete).toHaveBeenCalledWith(301, [
        expect.objectContaining({ id: 7001, quantity_received: 50 }),
      ]);
    });

    it('handler cancel happy libera reservas vía el servicio', async () => {
      const cancel = jest.fn().mockResolvedValue({
        ...TRANSFER,
        status: 'cancelled',
      });
      const { tools } = buildTools({
        transfersService: {
          findOne: jest.fn().mockResolvedValue(TRANSFER),
          cancel,
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const answer = JSON.parse(
        await tool.handler!({ action: 'cancel', transfer_id: 301 }, CONTEXT),
      );

      expect(answer.status).toBe('cancelled');
      expect(cancel).toHaveBeenCalledWith(301);
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const { tools } = buildTools({
        transfersService: {
          findOne: jest.fn().mockResolvedValue(TRANSFER),
          approve: jest
            .fn()
            .mockRejectedValue(new Error('Sin stock disponible en origen')),
        } as any,
      });
      const tool = getTool(tools, 'manage_stock_transfers');
      const answer = JSON.parse(
        await tool.handler!({ action: 'approve', transfer_id: 301 }, CONTEXT),
      );

      expect(answer.error).toMatch(/Sin stock disponible/);
      expect(answer.next_step).toMatch(/get_stock_levels/);
    });
  });

  describe('approve_stock_adjustment (O-15)', () => {
    const ADJUSTMENT = {
      id: 1201,
      product_id: 9,
      products: { name: 'Café 500g' },
      adjustment_type: 'damage',
      quantity_before: 100,
      quantity_after: 95,
      approved_by_user_id: null,
      approved_at: null,
    };

    it('preview nombra producto humano con antes→después', async () => {
      const { tools } = buildTools({
        adjustmentsService: {
          getAdjustmentById: jest.fn().mockResolvedValue(ADJUSTMENT),
        } as any,
      });
      const tool = getTool(tools, 'approve_stock_adjustment');
      const preview = await tool.preview!(
        { adjustment_ids: [1201] },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Aprobar ajuste #1201 — Café 500g: 100 → 95 (damage)',
        changes: [
          {
            field: 'approval',
            label: 'Ajustes',
            from: 'pendientes',
            to: 'Café 500g: 100 → 95 (damage)',
          },
        ],
        domain: 'inventory',
      });
      expect(preview.status).toBe('ok');
      expect(preview.target).toBe(
        'Aprobar ajuste #1201 — Café 500g: 100 → 95 (damage)',
      );
    });

    it('preview sobre ajuste ya aprobado aborta sin token', async () => {
      const { tools } = buildTools({
        adjustmentsService: {
          getAdjustmentById: jest.fn().mockResolvedValue({
            ...ADJUSTMENT,
            approved_by_user_id: 5,
            approved_at: '2026-09-01T00:00:00.000Z',
          }),
        } as any,
      });
      const tool = getTool(tools, 'approve_stock_adjustment');
      const preview = await tool.preview!(
        { adjustment_ids: [1201] },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/ya están aprobados/);
    });

    it('handler happy sella con el user_id del turno', async () => {
      const approveAdjustment = jest.fn().mockResolvedValue({
        ...ADJUSTMENT,
        approved_by_user_id: 11,
      });
      const { tools } = buildTools({
        adjustmentsService: {
          getAdjustmentById: jest.fn().mockResolvedValue(ADJUSTMENT),
          approveAdjustment,
        } as any,
      });
      const tool = getTool(tools, 'approve_stock_adjustment');
      const answer = JSON.parse(
        await tool.handler!({ adjustment_ids: [1201] }, CONTEXT),
      );

      expect(answer.adjustment_ids).toEqual([1201]);
      expect(approveAdjustment).toHaveBeenCalledWith(1201, 11);
    });

    it('handler re-verifica: si otro aprobó en el medio, no duplica', async () => {
      const approveAdjustment = jest.fn();
      const { tools } = buildTools({
        adjustmentsService: {
          getAdjustmentById: jest.fn().mockResolvedValue({
            ...ADJUSTMENT,
            approved_by_user_id: 5,
          }),
          approveAdjustment,
        } as any,
      });
      const tool = getTool(tools, 'approve_stock_adjustment');
      const answer = JSON.parse(
        await tool.handler!({ adjustment_ids: [1201] }, CONTEXT),
      );

      expect(answer.error).toMatch(/ya fue aprobado/);
      expect(approveAdjustment).not.toHaveBeenCalled();
    });
  });
});
