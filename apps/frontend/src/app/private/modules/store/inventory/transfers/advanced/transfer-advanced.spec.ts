import type { TransferPickerRow } from '../quick-move/transfer-draft';
import {
  AdvancedLine,
  AdvancedOrderForm,
  TransferBatchOption,
  TransferFlowView,
  addRowsToLines,
  applyDefaultBatches,
  applyPastedEntry,
  applyScan,
  buildAdvancedPayload,
  buildDispatchBody,
  buildReceiveBody,
  canCloseWithLoss,
  canDispatch,
  defaultBatchId,
  deliveryDeadlinePassed,
  effectiveMode,
  emptyAdvancedForm,
  findRowForCode,
  hasExitAlert,
  needsSupportAlert,
  parseAdvancedDraft,
  parsePastedList,
  receiptStoreBlock,
  serializeAdvancedDraft,
  validateAdvancedOrder,
} from './transfer-advanced';

function row(over: Partial<TransferPickerRow> = {}): TransferPickerRow {
  return {
    id: 10,
    product_id: 10,
    product_variant_id: null,
    name: 'Café',
    variant_name: null,
    sku: 'CAF-500',
    stock_at_origin: {
      quantity_on_hand: 5,
      quantity_reserved: 0,
      quantity_available: 5,
    },
    stock_at_destination: {
      quantity_on_hand: 1,
      quantity_reserved: 0,
      quantity_available: 1,
    },
    ...over,
  };
}

function line(over: Partial<AdvancedLine> = {}): AdvancedLine {
  return {
    key: '10:base',
    product_id: 10,
    product_variant_id: null,
    product_name: 'Café',
    variant_name: null,
    sku: 'CAF-500',
    available_at_origin: 5,
    available_at_destination: 1,
    quantity: 2,
    batch_id: null,
    ...over,
  };
}

function form(over: Partial<AdvancedOrderForm> = {}): AdvancedOrderForm {
  return {
    ...emptyAdvancedForm(),
    from_location_id: 1,
    to_location_id: 2,
    lines: [line()],
    ...over,
  };
}

function transfer(over: Partial<TransferFlowView> = {}): TransferFlowView {
  return {
    id: 1,
    status: 'in_transit',
    movement_mode: 'with_dispatch_notes',
    is_external_destination: false,
    dispatched_at: '2026-11-10T10:00:00Z',
    expected_date: '2026-11-15T00:00:00Z',
    stock_transfer_items: [
      {
        id: 11,
        quantity: 5,
        quantity_dispatched: 5,
        quantity_received: 2,
        quantity_lost: 0,
      },
    ],
    ...over,
  };
}

describe('transfer-advanced (P3) — lógica de la orden avanzada', () => {
  describe('modo y destino externo (D3/D8)', () => {
    it('un destino externo fuerza el modo con remisiones', () => {
      expect(effectiveMode({ mode: 'mass_only', is_external: false })).toBe(
        'mass_only',
      );
      expect(effectiveMode({ mode: 'mass_only', is_external: true })).toBe(
        'with_dispatch_notes',
      );
    });

    it('avisa la alerta solo si sale sin documento NI motivo', () => {
      const base = form({ is_external: true });
      expect(needsSupportAlert(base)).toBeTrue();
      expect(
        needsSupportAlert({
          ...base,
          external: { ...base.external, exit_reason: 'Muestra' },
        }),
      ).toBeFalse();
      expect(
        needsSupportAlert({
          ...base,
          external: { ...base.external, support_document_type: 'invoice' },
        }),
      ).toBeFalse();
      expect(needsSupportAlert(form())).toBeFalse();
    });
  });

  describe('validaciones', () => {
    it('pide origen, destino distinto y productos', () => {
      expect(validateAdvancedOrder(form())).toEqual([]);
      expect(validateAdvancedOrder(form({ from_location_id: null }))).toContain(
        'Elige la bodega de origen.',
      );
      expect(validateAdvancedOrder(form({ to_location_id: 1 }))).toContain(
        'El origen y el destino deben ser bodegas diferentes.',
      );
      expect(validateAdvancedOrder(form({ lines: [] }))).toContain(
        'Agrega al menos un producto.',
      );
    });

    it('rechaza cantidades sobre el disponible o no enteras', () => {
      const errors = validateAdvancedOrder(
        form({ lines: [line({ quantity: 6 })] }),
      );
      expect(errors.some((e) => e.includes('cantidades'))).toBeTrue();
      expect(
        validateAdvancedOrder(form({ lines: [line({ quantity: 1.5 })] }))
          .length,
      ).toBe(1);
    });

    it('destino externo exige nombre y no destino propio', () => {
      const external = form({ is_external: true, to_location_id: null });
      expect(validateAdvancedOrder(external)).toEqual([
        'Escribe el nombre del destino externo.',
      ]);
      expect(
        validateAdvancedOrder({
          ...external,
          external: { ...external.external, name: 'Cliente X' },
        }),
      ).toEqual([]);
    });

    it('valida cada método de transporte', () => {
      const t = emptyAdvancedForm().transport;
      expect(
        validateAdvancedOrder(
          form({ transport: { ...t, method: 'internal_carrier' } }),
        ),
      ).toContain('Elige el transportador o escribe su nombre.');
      expect(
        validateAdvancedOrder(
          form({ transport: { ...t, method: 'internal_vehicle' } }),
        ),
      ).toContain('Elige un vehículo o registra uno con su placa.');
      expect(
        validateAdvancedOrder(
          form({
            transport: {
              ...t,
              method: 'internal_vehicle',
              new_vehicle_plate: 'abc123',
            },
          }),
        ),
      ).toEqual([]);
      expect(
        validateAdvancedOrder(
          form({ transport: { ...t, method: 'external_shipping_method' } }),
        ),
      ).toContain('Elige la transportadora o escribe su nombre.');
      expect(
        validateAdvancedOrder(form({ transport: { ...t, shipping_cost: -1 } })),
      ).toContain('El costo de transporte no puede ser negativo.');
    });
  });

  describe('lote por fila (D5)', () => {
    const batches: TransferBatchOption[] = [
      {
        id: 1,
        product_id: 10,
        product_variant_id: null,
        batch_number: 'L-VACIO',
        expiration_date: '2026-11-01',
        available: 0,
      },
      {
        id: 2,
        product_id: 10,
        product_variant_id: null,
        batch_number: 'L-VIEJO',
        expiration_date: '2026-12-01',
        available: 3,
      },
      {
        id: 3,
        product_id: 10,
        product_variant_id: null,
        batch_number: 'L-NUEVO',
        expiration_date: '2027-01-01',
        available: 9,
      },
      {
        id: 4,
        product_id: 10,
        product_variant_id: 7,
        batch_number: 'L-VAR',
        expiration_date: null,
        available: 4,
      },
    ];

    it('por defecto toma el más antiguo con saldo de esa variante', () => {
      expect(defaultBatchId(batches, line())).toBe(2);
      expect(defaultBatchId(batches, line({ product_variant_id: 7 }))).toBe(4);
      expect(defaultBatchId(batches, line({ product_id: 99 }))).toBeNull();
    });

    it('no pisa el lote que el usuario eligió', () => {
      const lines = applyDefaultBatches(
        [line(), line({ key: '10:7', product_variant_id: 7, batch_id: 99 })],
        batches,
      );
      expect(lines.map((l) => l.batch_id)).toEqual([2, 99]);
    });
  });

  describe('carga de productos', () => {
    it('agrega filas sin repetir y con todo el stock si se pide', () => {
      const r1 = addRowsToLines([], [row(), row()]);
      expect(r1.added).toBe(1);
      expect(r1.skipped).toBe(1);
      expect(r1.lines[0].quantity).toBe(1);

      const r2 = addRowsToLines([], [row()], { fullStock: true });
      expect(r2.lines[0].quantity).toBe(5);

      const noStock = row({
        stock_at_origin: {
          quantity_on_hand: 0,
          quantity_reserved: 0,
          quantity_available: 0,
        },
      });
      expect(addRowsToLines([], [noStock]).added).toBe(0);
    });

    it('escáner: cada lectura suma 1 sin pasar del disponible', () => {
      let result = applyScan([], row());
      expect(result.outcome).toBe('added');
      result = applyScan(result.lines, row());
      expect(result.outcome).toBe('incremented');
      expect(result.lines[0].quantity).toBe(2);
      const full = [line({ quantity: 5 })];
      expect(applyScan(full, row()).outcome).toBe('max_reached');
    });

    it('identifica el código por SKU exacto o resultado único', () => {
      const rows = [
        row({ sku: 'CAF-500' }),
        row({ id: 11, product_id: 11, sku: 'CAF-500-X' }),
      ];
      expect(findRowForCode(rows, 'caf-500')?.product_id).toBe(10);
      expect(findRowForCode([row()], 'otro')?.product_id).toBe(10);
      expect(findRowForCode(rows, 'otro')).toBeNull();
    });

    it('pegar lista: SKU;cantidad, separadores de hoja de cálculo y filas inválidas', () => {
      const { entries, invalid } = parsePastedList(
        'CAF-500;3\nAZU-1K\t2\n\nCAF-500;1\n;4\nPAN;0\nLEC;2;x\nARR,dos',
      );
      expect(entries).toEqual([
        { line: 1, sku: 'CAF-500', quantity: 4 },
        { line: 2, sku: 'AZU-1K', quantity: 2 },
      ]);
      expect(invalid.map((i) => [i.line, i.reason])).toEqual([
        [5, 'Falta el SKU'],
        [6, 'La cantidad debe ser un número entero mayor que 0'],
        [7, 'Usa solo SKU y cantidad'],
        [8, 'La cantidad debe ser un número entero mayor que 0'],
      ]);
      expect(parsePastedList('SAL').entries[0].quantity).toBe(1);
    });

    it('aplica una fila pegada sumando sin pasar del disponible', () => {
      const added = applyPastedEntry([], row(), 3);
      expect(added.error).toBeNull();
      expect(added.lines[0].quantity).toBe(3);
      const more = applyPastedEntry(added.lines, row(), 3);
      expect(more.error).toContain('solo hay 5');
      expect(applyPastedEntry(added.lines, row(), 2).lines[0].quantity).toBe(5);
    });
  });

  describe('payload', () => {
    it('arma el payload propio con modo, lote y transporte', () => {
      const payload = buildAdvancedPayload(
        form({
          mode: 'mass_only',
          expected_date: '2026-11-30',
          lines: [
            line({ batch_id: 2 }),
            line({
              key: '11:7',
              product_id: 11,
              product_variant_id: 7,
              quantity: 1,
            }),
          ],
          transport: {
            ...emptyAdvancedForm().transport,
            method: 'internal_vehicle',
            new_vehicle_plate: ' abc123 ',
            new_vehicle_type: 'van',
            driver_name: 'Pedro',
            shipping_cost: 25000,
          },
        }),
      );
      expect(payload).toEqual({
        from_location_id: 1,
        to_location_id: 2,
        movement_mode: 'mass_only',
        expected_date: '2026-11-30',
        shipping_cost: 25000,
        transport_method: 'internal_vehicle',
        driver_name: 'Pedro',
        vehicle: { plate: 'ABC123', type: 'van' },
        items: [
          { product_id: 10, batch_id: 2, quantity: 2 },
          { product_id: 11, product_variant_id: 7, quantity: 1 },
        ],
      });
    });

    it('destino externo sin destino propio, con soporte y modo forzado', () => {
      const base = form({
        is_external: true,
        to_location_id: 2,
        mode: 'mass_only',
      });
      const payload = buildAdvancedPayload({
        ...base,
        external: {
          ...base.external,
          name: ' Cliente X ',
          tax_id: '900123',
          support_document_type: 'invoice',
          support_document_id: 'FE-10',
        },
      });
      expect(payload?.to_location_id).toBeUndefined();
      expect(payload?.movement_mode).toBe('with_dispatch_notes');
      expect(payload?.is_external_destination).toBeTrue();
      expect(payload?.external_destination_name).toBe('Cliente X');
      expect(payload?.support_document_type).toBe('invoice');
      expect(payload?.shipping_cost).toBeUndefined();
      expect(payload?.transport_method).toBeUndefined();
    });

    it('devuelve null si la orden no es válida', () => {
      expect(buildAdvancedPayload(form({ lines: [] }))).toBeNull();
    });
  });

  describe('borrador local', () => {
    it('guarda y recupera el formulario completo', () => {
      const original = form({ notes: 'Para la feria' });
      const parsed = parseAdvancedDraft(
        serializeAdvancedDraft(original, new Date('2026-11-19T10:00:00Z')),
      );
      expect(parsed?.form.notes).toBe('Para la feria');
      expect(parsed?.form.lines[0].key).toBe('10:base');
      expect(parsed?.saved_at).toBe('2026-11-19T10:00:00.000Z');
      expect(parseAdvancedDraft('no-json')).toBeNull();
      expect(
        parseAdvancedDraft(JSON.stringify({ v: 99, form: original })),
      ).toBeNull();
    });
  });

  describe('detalle: despacho, pérdida, alerta y tienda de la recepción', () => {
    const now = new Date('2026-11-19T12:00:00Z');

    it('despachar solo en orden avanzada aprobada y nunca despachada', () => {
      const approved = transfer({
        status: 'approved',
        dispatched_at: null,
        stock_transfer_items: [
          { id: 11, quantity: 5, quantity_dispatched: null },
        ],
      });
      expect(canDispatch(approved)).toBeTrue();
      expect(canDispatch({ ...approved, status: 'in_transit' })).toBeTrue();
      expect(canDispatch(transfer())).toBeFalse();
      expect(canDispatch({ ...approved, movement_mode: null })).toBeFalse();
      expect(canDispatch({ ...approved, status: 'pending' })).toBeFalse();
    });

    it('la fecha límite vence al terminar el día (UTC)', () => {
      expect(deliveryDeadlinePassed('2026-11-19T00:00:00Z', now)).toBeFalse();
      expect(deliveryDeadlinePassed('2026-11-18T00:00:00Z', now)).toBeTrue();
      expect(deliveryDeadlinePassed(null, now)).toBeFalse();
    });

    it('cerrar como pérdida solo con pendiente y fecha vencida', () => {
      expect(canCloseWithLoss(transfer(), now)).toBeTrue();
      expect(
        canCloseWithLoss(
          transfer({ expected_date: '2026-11-25T00:00:00Z' }),
          now,
        ),
      ).toBeFalse();
      expect(
        canCloseWithLoss(transfer({ expected_date: null }), now),
      ).toBeFalse();
      expect(
        canCloseWithLoss(transfer({ status: 'received' }), now),
      ).toBeFalse();
      expect(
        canCloseWithLoss(transfer({ is_external_destination: true }), now),
      ).toBeFalse();
      expect(
        canCloseWithLoss(
          transfer({
            stock_transfer_items: [
              {
                id: 11,
                quantity: 5,
                quantity_dispatched: 5,
                quantity_received: 5,
              },
            ],
          }),
          now,
        ),
      ).toBeFalse();
      expect(
        canCloseWithLoss(
          transfer({
            dispatched_at: null,
            stock_transfer_items: [
              { id: 11, quantity: 5, quantity_dispatched: null },
            ],
          }),
          now,
        ),
      ).toBeFalse();
    });

    it('marca la alerta de salida sin soporte', () => {
      expect(hasExitAlert({ no_support_alert: true })).toBeTrue();
      expect(hasExitAlert({ no_support_alert: false })).toBeFalse();
      expect(hasExitAlert(null)).toBeFalse();
    });

    it('R3-2: avisa si las entregas siguen en otra tienda (solo superficie de tienda)', () => {
      const t = transfer({
        receipt_note: {
          id: 5,
          dispatch_number: 'REM1',
          store_id: 4,
          store: { id: 4, name: 'Centro' },
        },
      });
      expect(receiptStoreBlock(t, 'store', 3)).toBe('Centro');
      expect(receiptStoreBlock(t, 'store', 4)).toBeNull();
      expect(receiptStoreBlock(t, 'organization', 3)).toBeNull();
      expect(receiptStoreBlock(transfer(), 'store', 3)).toBeNull();
      expect(
        receiptStoreBlock({ ...t, movement_mode: 'mass_only' }, 'store', 3),
      ).toBeNull();
    });

    it('arma el conteo de salida y rechaza excesos o todo en cero', () => {
      const t = transfer({
        stock_transfer_items: [
          { id: 11, quantity: 5 },
          { id: 12, quantity: 2 },
        ],
      });
      expect(
        buildDispatchBody(
          t,
          [
            { id: 11, quantity_dispatched: 4, batch_id: 9 },
            { id: 12, quantity_dispatched: 0, batch_id: null },
          ],
          ' urgente ',
        ).body,
      ).toEqual({
        items: [
          { id: 11, quantity_dispatched: 4, batch_id: 9 },
          { id: 12, quantity_dispatched: 0 },
        ],
        notes: 'urgente',
      });
      expect(
        buildDispatchBody(t, [
          { id: 11, quantity_dispatched: 6, batch_id: null },
        ]).error,
      ).toContain('más de lo pedido');
      expect(
        buildDispatchBody(t, [
          { id: 11, quantity_dispatched: 0, batch_id: null },
        ]).error,
      ).toBe('Despacha al menos una unidad.');
    });

    it('arma la recepción solo con lo pendiente', () => {
      const t = transfer({
        stock_transfer_items: [
          { id: 11, quantity: 5, quantity_dispatched: 5, quantity_received: 2 },
          { id: 12, quantity: 2, quantity_dispatched: 2, quantity_received: 2 },
        ],
      });
      expect(buildReceiveBody(t, { 11: 3 }).items).toEqual([
        { id: 11, quantity_received: 3 },
      ]);
      expect(buildReceiveBody(t, { 11: 4 }).error).toContain('faltan 3');
      expect(buildReceiveBody(t, {}).error).toBe(
        'Registra al menos una unidad recibida.',
      );
    });
  });
});
