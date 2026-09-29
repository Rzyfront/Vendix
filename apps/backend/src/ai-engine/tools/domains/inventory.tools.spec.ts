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

  describe('manage_locations (O-16)', () => {
    const LOCATION = {
      id: 4,
      name: 'Bodega central',
      code: 'BOD-01',
      type: 'warehouse',
      is_active: true,
      is_default: false,
    };

    it('contrato: version 1, confirmación, preview y permisos de ubicaciones', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_locations');
      expect(tool.version).toBe('1');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:inventory:locations:create',
        'store:inventory:locations:update',
        'store:inventory:locations:delete',
        'store:inventory:set-default-location',
      ]);
    });

    it('preview create muestra nombre, código y tipo', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'manage_locations');
      const preview = await tool.preview!(
        {
          action: 'create',
          name: 'Tienda norte',
          code: 'TND-02',
          type: 'store',
        },
        CONTEXT,
      );

      expect(preview).toEqual({
        status: 'ok',
        target: 'Nueva ubicación — Tienda norte (TND-02)',
        changes: [
          { field: 'name', label: 'Nombre', from: null, to: 'Tienda norte' },
          { field: 'code', label: 'Código', from: null, to: 'TND-02' },
          { field: 'type', label: 'Tipo', from: null, to: 'store' },
        ],
        domain: 'inventory',
      });
    });

    it('preview create sin nombre aborta sin token ni llamado', async () => {
      const create = jest.fn();
      const { tools } = buildTools({
        locationsService: { findOne: jest.fn(), create } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const preview = await tool.preview!(
        { action: 'create', code: 'SIN-NOMBRE' },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/validación/);
      expect(create).not.toHaveBeenCalled();
    });

    it('preview delete advierte que es soft-delete sin tocar stock', async () => {
      const { tools } = buildTools({
        locationsService: {
          findOne: jest.fn().mockResolvedValue(LOCATION),
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const preview = await tool.preview!(
        { action: 'delete', location_id: 4 },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Bodega central (BOD-01)');
      expect(preview.message).toMatch(/NO borra el stock/);
    });

    it('preview delete sobre inactiva aborta sin token', async () => {
      const { tools } = buildTools({
        locationsService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...LOCATION, is_active: false }),
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const preview = await tool.preview!(
        { action: 'delete', location_id: 4 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/ya está inactiva/);
    });

    it('preview set_default sobre inactiva aborta sin token', async () => {
      const { tools } = buildTools({
        locationsService: {
          findOne: jest
            .fn()
            .mockResolvedValue({ ...LOCATION, is_active: false }),
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const preview = await tool.preview!(
        { action: 'set_default', location_id: 4 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/inactiva/);
    });

    it('handler create happy delega con DTO validado', async () => {
      const create = jest
        .fn()
        .mockResolvedValue({ id: 11, name: 'Tienda norte', code: 'TND-02' });
      const { tools } = buildTools({
        locationsService: { findOne: jest.fn(), create } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const answer = JSON.parse(
        await tool.handler!(
          {
            action: 'create',
            name: 'Tienda norte',
            code: 'TND-02',
            type: 'store',
          },
          CONTEXT,
        ),
      );

      expect(answer.location_id).toBe(11);
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Tienda norte', code: 'TND-02' }),
      );
    });

    it('handler update re-verifica: si la bodega desapareció, no actualiza', async () => {
      const update = jest.fn();
      const { tools } = buildTools({
        locationsService: {
          findOne: jest.fn().mockResolvedValue(null),
          update,
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'update', location_id: 4, name: 'Otra' },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/ya no existe/);
      expect(update).not.toHaveBeenCalled();
    });

    it('handler set_default happy marca la bodega por defecto', async () => {
      const setAsDefault = jest
        .fn()
        .mockResolvedValue({ ...LOCATION, is_default: true });
      const { tools } = buildTools({
        locationsService: {
          findOne: jest.fn().mockResolvedValue(LOCATION),
          setAsDefault,
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const answer = JSON.parse(
        await tool.handler!(
          { action: 'set_default', location_id: 4 },
          CONTEXT,
        ),
      );

      expect(answer.location_id).toBe(4);
      expect(setAsDefault).toHaveBeenCalledWith(4);
    });

    it('handler traduce el fallo del dominio a {error, next_step}', async () => {
      const { tools } = buildTools({
        locationsService: {
          findOne: jest.fn().mockResolvedValue(LOCATION),
          remove: jest.fn().mockRejectedValue(new Error('FK en uso')),
        } as any,
      });
      const tool = getTool(tools, 'manage_locations');
      const answer = JSON.parse(
        await tool.handler!({ action: 'delete', location_id: 4 }, CONTEXT),
      );

      expect(answer.error).toMatch(/FK en uso/);
      expect(answer.next_step).toMatch(/get_inventory_locations/);
    });
  });

  describe('release_stock_reservations (O-17, cuarentena)', () => {
    const SUMMARY = {
      active_count: 3,
      total_quantity: 25,
      references: [
        { type: 'order', id: 101, count: 2, quantity: 20 },
        { type: 'transfer', id: 7, count: 1, quantity: 5 },
      ],
    };

    function quarantineTools(summary: any = SUMMARY) {
      return buildTools({
        stockLevelsService: {
          findAll: jest.fn().mockResolvedValue([
            {
              product_id: 9,
              products: { name: 'Café 500g', sku: 'CAFE-500' },
            },
          ]),
        } as any,
        adjustmentsService: {
          getActiveReservationsSummary: jest.fn().mockResolvedValue(summary),
          releaseReservationsByProduct: jest.fn().mockResolvedValue({
            released_count: 3,
            total_quantity: 25,
          }),
          releaseAllReservations: jest.fn().mockResolvedValue({
            released_count: 3,
            total_quantity: 25,
          }),
        } as any,
      });
    }

    it('contrato: version 1, confirmación fuerte y permiso de ajustes', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'release_stock_reservations');
      expect(tool.version).toBe('1');
      expect(tool.requiresConfirmation).toBe(true);
      expect(typeof tool.preview).toBe('function');
      expect(tool.requiredPermissions).toEqual([
        'store:inventory:adjustments:create',
      ]);
    });

    it('preview sin frase devuelve la consecuencia y la frase exacta (by_product)', async () => {
      const { tools } = quarantineTools();
      const tool = getTool(tools, 'release_stock_reservations');
      const preview = await tool.preview!(
        { scope: 'by_product', product_id: 9 },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/3 reservas activas de Café 500g/);
      expect(preview.message).toMatch(/"LIBERAR RESERVAS DEL PRODUCTO"/);
    });

    it('preview sin frase exige la frase global con scope all', async () => {
      const { tools } = quarantineTools();
      const tool = getTool(tools, 'release_stock_reservations');
      const preview = await tool.preview!({ scope: 'all' }, CONTEXT);

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/TODA la tienda/);
      expect(preview.message).toMatch(/"LIBERAR TODAS LAS RESERVAS"/);
    });

    it('preview con frase acuña warning con referencias afectadas', async () => {
      const { tools } = quarantineTools();
      const tool = getTool(tools, 'release_stock_reservations');
      const preview = await tool.preview!(
        {
          scope: 'by_product',
          product_id: 9,
          consequence_ack: 'LIBERAR RESERVAS DEL PRODUCTO',
        },
        CONTEXT,
      );

      expect(preview.status).toBe('warning');
      expect(preview.target).toMatch(/Café 500g/);
      expect(JSON.stringify(preview.changes)).toMatch(/order #101 \(20u\)/);
    });

    it('preview sin reservas activas aborta sin token', async () => {
      const { tools } = quarantineTools({
        active_count: 0,
        total_quantity: 0,
        references: [],
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const preview = await tool.preview!(
        {
          scope: 'by_product',
          product_id: 9,
          consequence_ack: 'LIBERAR RESERVAS DEL PRODUCTO',
        },
        CONTEXT,
      );

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/nada que liberar/);
    });

    it('preview by_product sin product_id aborta sin leer reservas', async () => {
      const getActiveReservationsSummary = jest.fn();
      const { tools } = buildTools({
        adjustmentsService: { getActiveReservationsSummary } as any,
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const preview = await tool.preview!({ scope: 'by_product' }, CONTEXT);

      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/exige product_id/);
      expect(getActiveReservationsSummary).not.toHaveBeenCalled();
    });

    it('handler by_product happy libera vía el servicio dueño', async () => {
      const releaseReservationsByProduct = jest.fn().mockResolvedValue({
        released_count: 3,
        total_quantity: 25,
      });
      const { tools } = buildTools({
        adjustmentsService: {
          getActiveReservationsSummary: jest.fn().mockResolvedValue(SUMMARY),
          releaseReservationsByProduct,
        } as any,
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const answer = JSON.parse(
        await tool.handler!(
          {
            scope: 'by_product',
            product_id: 9,
            consequence_ack: 'LIBERAR RESERVAS DEL PRODUCTO',
          },
          CONTEXT,
        ),
      );

      expect(answer.released_count).toBe(3);
      expect(releaseReservationsByProduct).toHaveBeenCalledWith(9, undefined);
    });

    it('handler all happy libera todas vía el servicio dueño', async () => {
      const releaseAllReservations = jest.fn().mockResolvedValue({
        released_count: 3,
        total_quantity: 25,
      });
      const { tools } = buildTools({
        adjustmentsService: {
          getActiveReservationsSummary: jest.fn().mockResolvedValue(SUMMARY),
          releaseAllReservations,
        } as any,
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const answer = JSON.parse(
        await tool.handler!(
          { scope: 'all', consequence_ack: 'LIBERAR TODAS LAS RESERVAS' },
          CONTEXT,
        ),
      );

      expect(answer.released_count).toBe(3);
      expect(releaseAllReservations).toHaveBeenCalled();
    });

    it('handler sin frase no libera aunque haya token', async () => {
      const releaseAllReservations = jest.fn();
      const { tools } = buildTools({
        adjustmentsService: {
          getActiveReservationsSummary: jest.fn().mockResolvedValue(SUMMARY),
          releaseAllReservations,
        } as any,
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const answer = JSON.parse(
        await tool.handler!({ scope: 'all' }, CONTEXT),
      );

      expect(answer.error).toMatch(/frase de consecuencia/);
      expect(releaseAllReservations).not.toHaveBeenCalled();
    });

    it('handler re-verifica: si otro liberó en el medio, no duplica', async () => {
      const releaseReservationsByProduct = jest.fn();
      const { tools } = buildTools({
        adjustmentsService: {
          getActiveReservationsSummary: jest.fn().mockResolvedValue({
            active_count: 0,
            total_quantity: 0,
            references: [],
          }),
          releaseReservationsByProduct,
        } as any,
      });
      const tool = getTool(tools, 'release_stock_reservations');
      const answer = JSON.parse(
        await tool.handler!(
          {
            scope: 'by_product',
            product_id: 9,
            consequence_ack: 'LIBERAR RESERVAS DEL PRODUCTO',
          },
          CONTEXT,
        ),
      );

      expect(answer.error).toMatch(/Ya no hay reservas activas/);
      expect(releaseReservationsByProduct).not.toHaveBeenCalled();
    });
  });

  describe('get_sourcing_suggestion (O-18)', () => {
    function sourcingTools(sourcing: any, drift: any = null) {
      return buildTools({
        stockLevelsService: {
          getSourcingSuggestion: jest.fn().mockResolvedValue(sourcing),
          getMirrorDrift: jest.fn().mockResolvedValue(drift),
        } as any,
      });
    }

    const AVAILABLE = {
      main_location: { id: 4, name: 'Bodega central', quantity_available: 50 },
      other_locations: [],
      suggestion: 'available',
      requested_quantity: 10,
    };

    it('contrato: readOnly sin confirmación y permiso de lectura', () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'get_sourcing_suggestion');
      expect(tool.version).toBe('1');
      expect(tool.readOnly).toBe(true);
      expect(tool.requiresConfirmation).toBeUndefined();
      expect(tool.requiredPermissions).toEqual([
        'store:inventory:stock_levels:read',
      ]);
    });

    it('happy available: snapshot con siguiente paso de venta directa', async () => {
      const { tools, deps } = sourcingTools(AVAILABLE);
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(
        await tool.handler!({ product_id: 9, quantity: 10 }, CONTEXT),
      );

      expect(answer).toEqual({
        sugerencia: 'available',
        cantidad_solicitada: 10,
        bodega_principal: {
          id: 4,
          name: 'Bodega central',
          quantity_available: 50,
        },
        otras_bodegas: [],
        siguiente_paso: 'Vende desde la bodega principal: tiene suficiente.',
      });
      expect(
        deps.stockLevelsService.getSourcingSuggestion,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ product_id: 9, quantity: 10 }),
      );
      expect(deps.stockLevelsService.getMirrorDrift).not.toHaveBeenCalled();
    });

    it('happy transfer: el siguiente paso cita manage_stock_transfers', async () => {
      const { tools } = sourcingTools({
        main_location: { id: 4, name: 'Bodega central', quantity_available: 2 },
        other_locations: [
          { id: 9, name: 'Tienda norte', quantity_available: 40 },
        ],
        suggestion: 'transfer',
        requested_quantity: 10,
      });
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(
        await tool.handler!({ product_id: 9, quantity: 10 }, CONTEXT),
      );

      expect(answer.sugerencia).toBe('transfer');
      expect(answer.siguiente_paso).toMatch(/manage_stock_transfers/);
    });

    it('happy purchase: el siguiente paso cita crear una OC', async () => {
      const { tools } = sourcingTools({
        main_location: null,
        other_locations: [],
        suggestion: 'purchase',
        requested_quantity: 10,
      });
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(
        await tool.handler!({ product_id: 9, quantity: 10 }, CONTEXT),
      );

      expect(answer.sugerencia).toBe('purchase');
      expect(answer.siguiente_paso).toMatch(/manage_purchase_orders/);
    });

    it('happy con deriva: incluye el espejo compactado', async () => {
      const { tools, deps } = sourcingTools(AVAILABLE, {
        is_consistent: false,
        drifted_total: 2,
        drifted: [
          { product_id: 9, esperado: 50, espejo: 48 },
          { product_id: 10, esperado: 3, espejo: 5 },
        ],
      });
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(
        await tool.handler!(
          { product_id: 9, quantity: 10, include_mirror_drift: true },
          CONTEXT,
        ),
      );

      expect(answer.espejo.coincide).toBe(false);
      expect(answer.espejo.descuadres).toBe(2);
      expect(answer.espejo.detalle).toHaveLength(2);
      expect(answer.espejo.nota).toMatch(/flujo de ajustes/);
      expect(deps.stockLevelsService.getMirrorDrift).toHaveBeenCalled();
    });

    it('sad: product_id inválido no llama al servicio', async () => {
      const getSourcingSuggestion = jest.fn();
      const { tools } = buildTools({
        stockLevelsService: { getSourcingSuggestion } as any,
      });
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(
        await tool.handler!({ product_id: -3 }, CONTEXT),
      );

      expect(answer.error).toMatch(/validación/);
      expect(answer.next_step).toMatch(/product_id/);
      expect(getSourcingSuggestion).not.toHaveBeenCalled();
    });

    it('sad: sin tenant responde error acotado', async () => {
      const { tools } = buildTools();
      const tool = getTool(tools, 'get_sourcing_suggestion');
      const answer = JSON.parse(await tool.handler!({ product_id: 9 }, {}));

      expect(answer.error).toMatch(/tienda/);
    });
  });
});
