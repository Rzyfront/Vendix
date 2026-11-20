import { BadRequestException } from '@nestjs/common';
import {
  createInventoryTransferTools,
  InventoryTransferToolServices,
  parseTransferRequest,
  TRANSFER_TOOL_MAX_LINES,
} from './inventory-transfers.tools';
import { createInventoryTools } from './inventory.tools';
import { RegisteredTool, ToolPreview } from '../interfaces/tool.interface';

/**
 * P4 — transferencias multi-producto para Vexi/Vex.
 *
 * Contrato: (a) la lectura resuelve varios productos en una llamada, (b) la
 * escritura propone con vista previa humana antes de mover nada, (c) el modo
 * inmediato solo entre bodegas propias (D9) y el destino externo solo como
 * orden pendiente con remisión (D8), (d) el handler re-valida y delega en el
 * servicio de transferencias (nunca toca stock), (e) nada de lo que ve la
 * persona lleva IDs, nombres de herramientas ni estados internos.
 */
describe('inventory-transfers.tools · P4 transferencias multi-producto', () => {
  const CONTEXT = { store_id: 7, organization_id: 3, user_id: 11, roles: [] };

  /** snake_case de herramientas/campos internos, `#123`, estados en inglés. */
  const JARGON =
    /\b[a-z]+_[a-z_]+\b|#\d+|\b(pending|completed|in_transit|quick|draft|mass_only)\b/;

  const LOCATIONS = {
    data: [
      { id: 4, name: 'Bodega Principal' },
      { id: 9, name: 'Tienda Centro' },
    ],
  };

  const ROWS = [
    {
      product_id: 10,
      product_variant_id: null,
      name: 'Cargador USB-C 65W',
      variant_name: null,
      sku: 'CHG-65',
      stock_at_origin: { quantity_available: 40 },
      stock_at_destination: { quantity_available: 5 },
    },
    {
      product_id: 20,
      product_variant_id: 201,
      name: 'iPhone 15 Pro',
      variant_name: 'Black Titanium',
      sku: 'IP15-BT',
      stock_at_origin: { quantity_available: 12 },
      stock_at_destination: { quantity_available: 0 },
    },
    {
      product_id: 20,
      product_variant_id: 202,
      name: 'iPhone 15 Pro',
      variant_name: 'White Titanium',
      sku: 'IP15-WT',
      stock_at_origin: { quantity_available: 8 },
      stock_at_destination: { quantity_available: 1 },
    },
  ];

  function buildTools(overrides: Partial<InventoryTransferToolServices> = {}) {
    const deps = {
      locationsService: {
        findAll: jest.fn().mockResolvedValue(LOCATIONS),
      } as any,
      transfersService: {
        getLocationStock: jest
          .fn()
          .mockResolvedValue({ rows: ROWS, has_more: false, limit: 500 }),
        searchTransferableProducts: jest.fn(),
        create: jest.fn(),
        createAndComplete: jest.fn(),
      } as any,
      ...overrides,
    } satisfies InventoryTransferToolServices;
    return { deps, tools: createInventoryTransferTools(deps) };
  }

  function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
    const tool = tools.find((t) => t.name === name);
    if (!tool?.handler) throw new Error(`${name} sin handler`);
    return tool;
  }

  function visibleText(preview: ToolPreview): string {
    return [
      preview.target,
      preview.message ?? '',
      ...preview.changes.flatMap((c) => [
        c.label,
        String(c.from ?? ''),
        String(c.to ?? ''),
      ]),
    ].join(' | ');
  }

  const QUICK_ARGS = {
    mode: 'quick',
    from_location_id: 4,
    to_location_id: 9,
    items: [
      { product_id: 10, quantity: 2 },
      { product_id: 20, product_variant_id: 201, quantity: 3 },
    ],
  };

  describe('contrato', () => {
    it('lectura readOnly y escritura con confirmación, preview y permisos de los endpoints', () => {
      const { tools } = buildTools();
      const find = getTool(tools, 'find_transfer_products');
      const create = getTool(tools, 'create_stock_transfer');

      expect(find.readOnly).toBe(true);
      expect(find.requiresConfirmation).toBeFalsy();
      expect(find.requiredPermissions).toEqual(['store:stock-transfers:read']);

      expect(create.version).toBe('1');
      expect(create.readOnly).toBeFalsy();
      expect(create.clientSide).toBeFalsy();
      expect(create.requiresConfirmation).toBe(true);
      expect(typeof create.preview).toBe('function');
      // POST store/stock-transfers y POST .../complete aceptan `create`.
      expect(create.requiredPermissions).toEqual([
        'store:stock-transfers:create',
      ]);
      expect(create.parameters.properties.mode.enum).toEqual([
        'quick',
        'draft',
      ]);
    });

    it('el factory de inventario las registra junto al resto', () => {
      const tools = createInventoryTools({
        stockLevelsService: {} as any,
        inventoryIntegrationService: {} as any,
        adjustmentsService: {} as any,
        movementsService: {} as any,
        locationsService: {} as any,
        transfersService: {} as any,
      });
      const names = tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'manage_stock_transfers',
          'find_transfer_products',
          'create_stock_transfer',
        ]),
      );
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('parseTransferRequest', () => {
    it('acepta varias líneas con variantes en modo inmediato', () => {
      const parsed = parseTransferRequest(QUICK_ARGS);
      expect(parsed).toEqual(
        expect.objectContaining({
          ok: true,
          mode: 'quick',
          fromId: 4,
          toId: 9,
          withDispatchNotes: false,
          lines: [
            { product_id: 10, product_variant_id: null, quantity: 2, batch_id: null },
            { product_id: 20, product_variant_id: 201, quantity: 3, batch_id: null },
          ],
        }),
      );
    });

    it.each([
      [
        'destino externo en modo inmediato (D9)',
        { ...QUICK_ARGS, external_destination: { name: 'Cliente X' } },
        /solo funciona entre tus propias bodegas/,
      ],
      [
        'remisiones en modo inmediato',
        { ...QUICK_ARGS, documents: 'dispatch_notes' },
        /no genera remisiones/,
      ],
      [
        'lote en modo inmediato',
        {
          ...QUICK_ARGS,
          items: [{ product_id: 10, quantity: 1, batch_id: 5 }],
        },
        /no elige lotes/,
      ],
      [
        'producto + variante repetido',
        {
          ...QUICK_ARGS,
          items: [
            { product_id: 20, product_variant_id: 201, quantity: 1 },
            { product_id: 20, product_variant_id: 201, quantity: 2 },
          ],
        },
        /aparece dos veces/,
      ],
      [
        'cantidad decimal',
        { ...QUICK_ARGS, items: [{ product_id: 10, quantity: 1.5 }] },
        /enteros mayores que cero/,
      ],
      [
        'misma bodega',
        { ...QUICK_ARGS, to_location_id: 4 },
        /no pueden ser la misma/,
      ],
      [
        'sin destino interno ni externo',
        { ...QUICK_ARGS, to_location_id: undefined },
        /Falta la bodega de destino/,
      ],
      [
        'modo desconocido',
        { ...QUICK_ARGS, mode: 'now' },
        /mode=quick/,
      ],
      [
        'destino externo sin nombre',
        {
          ...QUICK_ARGS,
          mode: 'draft',
          to_location_id: undefined,
          external_destination: { name: '  ' },
        },
        /nombre del destino externo/,
      ],
    ])('rechaza %s', (_label, args, message) => {
      const parsed = parseTransferRequest(args as any);
      expect(parsed.ok).toBe(false);
      expect((parsed as any).message).toMatch(message);
    });

    it(`limita la orden a ${TRANSFER_TOOL_MAX_LINES} líneas`, () => {
      const items = Array.from({ length: TRANSFER_TOOL_MAX_LINES + 1 }, (_, i) => ({
        product_id: i + 1,
        quantity: 1,
      }));
      const parsed = parseTransferRequest({ ...QUICK_ARGS, items });
      expect(parsed.ok).toBe(false);
    });

    it('un destino externo siempre lleva remisión de salida (D8)', () => {
      const parsed = parseTransferRequest({
        mode: 'draft',
        from_location_id: 4,
        documents: 'none',
        external_destination: { name: 'Distribuidora Andina' },
        items: [{ product_id: 10, quantity: 2 }],
      });
      expect(parsed).toEqual(
        expect.objectContaining({ ok: true, toId: null, withDispatchNotes: true }),
      );
    });
  });

  describe('create_stock_transfer · vista previa', () => {
    it('modo inmediato: nombra productos, variantes y la proyección por bodega, sin jerga', async () => {
      const { tools, deps } = buildTools();
      const tool = getTool(tools, 'create_stock_transfer');

      const preview = await tool.preview!(QUICK_ARGS, CONTEXT);

      expect(preview.status).toBe('warning');
      expect(preview.target).toBe('Mover ahora: Bodega Principal → Tienda Centro');
      expect(preview.message).toMatch(/se mueve de inmediato/);
      const labels = preview.changes.map((c) => c.label);
      expect(labels).toEqual([
        'Ruta',
        'Cargador USB-C 65W',
        'iPhone 15 Pro (Black Titanium)',
        'Total',
      ]);
      expect(preview.changes[1].to).toBe(
        '38 en Bodega Principal · 7 en Tienda Centro (mueve 2)',
      );
      expect(preview.changes[3].to).toBe('2 productos, 5 unidades');
      expect(visibleText(preview)).not.toMatch(JARGON);
      // Misma lectura que la vista avanzada (valida alcance D7).
      expect(deps.transfersService.getLocationStock).toHaveBeenCalledWith(
        4,
        9,
        null,
        500,
        [10, 20],
      );
      expect(deps.transfersService.createAndComplete).not.toHaveBeenCalled();
    });

    it('pide elegir variante cuando el producto las maneja y no llegó cuál', async () => {
      const { tools } = buildTools();
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        { ...QUICK_ARGS, items: [{ product_id: 20, quantity: 1 }] },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toBe(
        'iPhone 15 Pro maneja variantes: hay que elegir cuál se mueve.',
      );
    });

    it('no propone si no alcanza el disponible en origen', async () => {
      const { tools } = buildTools();
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        {
          ...QUICK_ARGS,
          items: [{ product_id: 20, product_variant_id: 202, quantity: 9 }],
        },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toBe(
        'No alcanza iPhone 15 Pro (White Titanium) en Bodega Principal: hay 8 disponibles y se piden 9.',
      );
      expect(visibleText(preview)).not.toMatch(JARGON);
    });

    it('un producto sin existencias en origen aborta sin token', async () => {
      const { tools } = buildTools();
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        { ...QUICK_ARGS, items: [{ product_id: 77, quantity: 1 }] },
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toMatch(/no tiene existencias en Bodega Principal/);
    });

    it('fuera del alcance de la tienda/organización (D7) no propone', async () => {
      const { tools } = buildTools({
        transfersService: {
          getLocationStock: jest
            .fn()
            .mockRejectedValue(
              new BadRequestException(
                'No tienes permiso para transferir entre tiendas',
              ),
            ),
        } as any,
      });
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        QUICK_ARGS,
        CONTEXT,
      );
      expect(preview.status).toBe('error');
      expect(preview.message).toBe(
        'No tienes permiso para transferir entre tiendas',
      );
    });

    it('destino externo como orden pendiente: avisa la alerta sin soporte y no consulta destino', async () => {
      const { tools, deps } = buildTools();
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        {
          mode: 'draft',
          from_location_id: 4,
          external_destination: { name: 'Distribuidora Andina' },
          items: [{ product_id: 10, quantity: 6 }],
        },
        CONTEXT,
      );
      expect(preview.status).toBe('warning');
      expect(preview.target).toBe(
        'Orden pendiente: Bodega Principal → Distribuidora Andina (destino externo)',
      );
      expect(preview.message).toMatch(/sin documento ni motivo queda marcada con alerta/);
      expect(preview.message).toMatch(/Todavía no se mueve inventario/);
      const manejo = preview.changes.find((c) => c.field === 'documents');
      expect(manejo?.to).toBe('Con remisión de salida (sin recepción)');
      expect(visibleText(preview)).not.toMatch(JARGON);
      expect(deps.transfersService.getLocationStock).toHaveBeenCalledWith(
        4,
        null,
        null,
        500,
        [10],
      );
    });

    it('orden pendiente interna con remisiones: estado ok, sin mover', async () => {
      const { tools } = buildTools();
      const preview = await getTool(tools, 'create_stock_transfer').preview!(
        { ...QUICK_ARGS, mode: 'draft', documents: 'dispatch_notes' },
        CONTEXT,
      );
      expect(preview.status).toBe('ok');
      expect(preview.changes[1].to).toBe('2 por enviar');
      expect(
        preview.changes.find((c) => c.field === 'documents')?.to,
      ).toBe('Con remisión de salida y de entrada');
    });
  });

  describe('create_stock_transfer · ejecución', () => {
    it('modo inmediato delega en createAndComplete con todas las líneas y variantes', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.createAndComplete.mockResolvedValue({
        id: 501,
        transfer_number: 'TRF-0501',
        status: 'completed',
      });
      const answer = JSON.parse(
        await getTool(tools, 'create_stock_transfer').handler!(
          { ...QUICK_ARGS, notes: 'Reposición vitrina' },
          CONTEXT,
        ),
      );

      expect(deps.transfersService.create).not.toHaveBeenCalled();
      const dto = deps.transfersService.createAndComplete.mock.calls[0][0];
      expect(dto).toEqual(
        expect.objectContaining({
          from_location_id: 4,
          to_location_id: 9,
          movement_mode: 'quick',
          notes: 'Reposición vitrina',
        }),
      );
      expect(dto.items).toEqual([
        expect.objectContaining({ product_id: 10, quantity: 2 }),
        expect.objectContaining({
          product_id: 20,
          product_variant_id: 201,
          quantity: 3,
        }),
      ]);
      expect(dto.items[0].product_variant_id).toBeUndefined();
      expect(answer.resumen).toBe(
        'Transferencia TRF-0501 aplicada: se movieron 5 unidades de 2 productos.',
      );
      expect(answer.resumen).not.toMatch(JARGON);
      expect(answer.transfer_id).toBe(501);
      expect(answer.status).toBe('completed');
    });

    it('orden pendiente con remisiones delega en create con with_dispatch_notes', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.create.mockResolvedValue({
        id: 502,
        transfer_number: 'TRF-0502',
        status: 'pending',
      });
      const answer = JSON.parse(
        await getTool(tools, 'create_stock_transfer').handler!(
          {
            ...QUICK_ARGS,
            mode: 'draft',
            documents: 'dispatch_notes',
            expected_date: '2026-12-01',
          },
          CONTEXT,
        ),
      );

      expect(deps.transfersService.createAndComplete).not.toHaveBeenCalled();
      const dto = deps.transfersService.create.mock.calls[0][0];
      expect(dto.movement_mode).toBe('with_dispatch_notes');
      expect(dto.expected_date).toBeInstanceOf(Date);
      expect(dto.is_external_destination).toBeUndefined();
      expect(answer.resumen).toBe(
        'Orden de transferencia TRF-0502 creada y pendiente de aprobar: todavía no se movió inventario.',
      );
      expect(answer.siguiente_paso).not.toMatch(JARGON);
    });

    it('solo movimiento masivo usa mass_only', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.create.mockResolvedValue({ id: 503 });
      await getTool(tools, 'create_stock_transfer').handler!(
        { ...QUICK_ARGS, mode: 'draft' },
        CONTEXT,
      );
      expect(deps.transfersService.create.mock.calls[0][0].movement_mode).toBe(
        'mass_only',
      );
    });

    it('destino externo: salida con remisión, soporte y sin bodega destino', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.create.mockResolvedValue({ id: 504 });
      await getTool(tools, 'create_stock_transfer').handler!(
        {
          mode: 'draft',
          from_location_id: 4,
          to_location_id: 9,
          external_destination: {
            name: 'Distribuidora Andina',
            support_document_type: 'invoice',
            support_document_id: 'FV-120',
          },
          items: [{ product_id: 10, quantity: 6 }],
        },
        CONTEXT,
      );
      const dto = deps.transfersService.create.mock.calls[0][0];
      expect(dto).toEqual(
        expect.objectContaining({
          movement_mode: 'with_dispatch_notes',
          is_external_destination: true,
          external_destination_name: 'Distribuidora Andina',
          support_document_type: 'invoice',
          support_document_id: 'FV-120',
        }),
      );
      expect(dto.to_location_id).toBeUndefined();
    });

    it('re-valida en el handler: destino externo en modo inmediato no llama al servicio', async () => {
      const { tools, deps } = buildTools();
      const answer = JSON.parse(
        await getTool(tools, 'create_stock_transfer').handler!(
          { ...QUICK_ARGS, external_destination: { name: 'Cliente X' } },
          CONTEXT,
        ),
      );
      expect(answer.error).toMatch(/solo funciona entre tus propias bodegas/);
      expect(deps.transfersService.createAndComplete).not.toHaveBeenCalled();
      expect(deps.transfersService.create).not.toHaveBeenCalled();
    });

    it('fecha límite inválida no crea nada', async () => {
      const { tools, deps } = buildTools();
      const answer = JSON.parse(
        await getTool(tools, 'create_stock_transfer').handler!(
          { ...QUICK_ARGS, mode: 'draft', expected_date: 'mañana' },
          CONTEXT,
        ),
      );
      expect(answer.error).toMatch(/fecha límite no es válida/);
      expect(deps.transfersService.create).not.toHaveBeenCalled();
    });

    it('traduce el fallo del dominio (p. ej. stock insuficiente al ejecutar) a {error, next_step}', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.createAndComplete.mockRejectedValue(
        new BadRequestException(
          'Stock insuficiente de Cargador USB-C 65W en la bodega de origen: disponible 1, pedido 2',
        ),
      );
      const answer = JSON.parse(
        await getTool(tools, 'create_stock_transfer').handler!(
          QUICK_ARGS,
          CONTEXT,
        ),
      );
      expect(answer.error).toMatch(/Stock insuficiente de Cargador USB-C 65W/);
      expect(answer.next_step).toMatch(/no repitas el movimiento/);
    });
  });

  describe('find_transfer_products', () => {
    it('resuelve varias búsquedas en una llamada con disponible en origen y destino', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.searchTransferableProducts
        .mockResolvedValueOnce([ROWS[0]])
        .mockResolvedValueOnce([ROWS[1], ROWS[2]]);
      const answer = JSON.parse(
        await getTool(tools, 'find_transfer_products').handler!(
          {
            from_location_id: 4,
            to_location_id: 9,
            searches: ['cargador', 'iphone 15'],
          },
          CONTEXT,
        ),
      );

      expect(deps.transfersService.searchTransferableProducts).toHaveBeenNthCalledWith(
        1,
        'cargador',
        4,
        9,
        10,
      );
      expect(answer.resultados).toHaveLength(2);
      expect(answer.resultados[1].coincidencias).toEqual([
        {
          product_id: 20,
          product_variant_id: 201,
          producto: 'iPhone 15 Pro (Black Titanium)',
          sku: 'IP15-BT',
          disponible_origen: 12,
          disponible_destino: 0,
        },
        {
          product_id: 20,
          product_variant_id: 202,
          producto: 'iPhone 15 Pro (White Titanium)',
          sku: 'IP15-WT',
          disponible_origen: 8,
          disponible_destino: 1,
        },
      ]);
    });

    it('sin destino (salida externa) omite el disponible en destino', async () => {
      const { tools, deps } = buildTools();
      deps.transfersService.searchTransferableProducts.mockResolvedValue([
        ROWS[0],
      ]);
      const answer = JSON.parse(
        await getTool(tools, 'find_transfer_products').handler!(
          { from_location_id: 4, searches: ['cargador'] },
          CONTEXT,
        ),
      );
      expect(answer.resultados[0].coincidencias[0]).not.toHaveProperty(
        'disponible_destino',
      );
    });

    it('sin búsquedas válidas no consulta', async () => {
      const { tools, deps } = buildTools();
      const answer = JSON.parse(
        await getTool(tools, 'find_transfer_products').handler!(
          { from_location_id: 4, searches: ['  '] },
          CONTEXT,
        ),
      );
      expect(answer.error).toBeDefined();
      expect(
        deps.transfersService.searchTransferableProducts,
      ).not.toHaveBeenCalled();
    });
  });
});
