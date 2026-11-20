import {
  TransferDraftHandoffService,
  TransferPickerRow,
  buildTransferPayload,
  mergePickerRows,
  pickerRowKey,
  pickerRowToLine,
  totalUnits,
  transferLineKey,
} from './transfer-draft';

function row(over: Partial<TransferPickerRow> = {}): TransferPickerRow {
  return {
    id: 10,
    product_id: 10,
    product_variant_id: null,
    name: 'Camisa',
    variant_name: null,
    sku: 'CAM-1',
    stock_at_origin: {
      quantity_on_hand: 8,
      quantity_reserved: 0,
      quantity_available: 8,
    },
    stock_at_destination: {
      quantity_on_hand: 2,
      quantity_reserved: 0,
      quantity_available: 2,
    },
    ...over,
  };
}

/**
 * Reglas del movimiento rápido que no dependen de Angular: la línea es el PAR
 * producto + variante (dos variantes del mismo producto son dos líneas), el
 * payload lleva `product_variant_id` y nada repetido entra a la orden.
 */
describe('transfer-draft — líneas producto + variante', () => {
  it('dos variantes del mismo producto son claves distintas; la base no se confunde con una variante', () => {
    expect(transferLineKey(10, 1)).toBe('10:1');
    expect(transferLineKey(10, 2)).toBe('10:2');
    expect(transferLineKey(10, 1)).not.toBe(transferLineKey(10, 2));
    expect(transferLineKey(10, null)).toBe('10:base');
    expect(transferLineKey(10, undefined)).toBe('10:base');
  });

  it('la clave de una fila del picker usa product_id (no el id legacy) y la variante', () => {
    expect(pickerRowKey(row({ id: 10, product_id: 10, product_variant_id: 7 }))).toBe(
      '10:7',
    );
    expect(pickerRowKey(row({ id: 10, product_id: 10, product_variant_id: null }))).toBe(
      '10:base',
    );
  });

  it('una fila sin product_id cae al id del producto del contrato viejo', () => {
    expect(pickerRowKey({ ...row(), product_id: undefined, id: 10 })).toBe('10:base');
  });
});

describe('transfer-draft — mergePickerRows (multiselección con dedup)', () => {
  it('agrega varias filas de una vez, incluidas dos variantes del mismo producto', () => {
    const result = mergePickerRows([], [
      row({ product_variant_id: 1, variant_name: 'Roja' }),
      row({ product_variant_id: 2, variant_name: 'Azul' }),
      row({ product_id: 11, id: 11, sku: 'PAN-1' }),
    ]);

    expect(result.added).toBe(3);
    expect(result.skipped).toBe(0);
    expect(result.lines.map((l) => l.key)).toEqual(['10:1', '10:2', '11:base']);
  });

  it('no repite el mismo par producto + variante aunque llegue dos veces', () => {
    const first = mergePickerRows([], [row({ product_variant_id: 1 })]);
    const second = mergePickerRows(first.lines, [
      row({ product_variant_id: 1 }),
      row({ product_variant_id: 2 }),
    ]);

    expect(second.added).toBe(1);
    expect(second.skipped).toBe(1);
    expect(second.lines.map((l) => l.key)).toEqual(['10:1', '10:2']);
    expect(second.lines.every((l) => l.quantity === 1)).toBeTrue();
  });

  it('omite filas sin disponible en el origen', () => {
    const result = mergePickerRows([], [
      row({
        stock_at_origin: {
          quantity_on_hand: 0,
          quantity_reserved: 0,
          quantity_available: 0,
        },
      }),
    ]);

    expect(result.added).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.lines).toEqual([]);
  });

  it('la fila agregada arranca en 1 y trae el disponible de origen y destino', () => {
    const line = pickerRowToLine(
      row({
        product_variant_id: 3,
        variant_name: 'Verde',
        stock_at_origin: {
          quantity_on_hand: 5,
          quantity_reserved: 1,
          quantity_available: 4,
        },
        stock_at_destination: {
          quantity_on_hand: 1,
          quantity_reserved: 0,
          quantity_available: 1,
        },
      }),
    );

    expect(line.quantity).toBe(1);
    expect(line.available_at_origin).toBe(4);
    expect(line.available_at_destination).toBe(1);
    expect(line.variant_name).toBe('Verde');
    expect(line.key).toBe('10:3');
  });
});

describe('transfer-draft — buildTransferPayload', () => {
  const base = {
    from_location_id: 1,
    to_location_id: 2,
    notes: '  Reposición semanal  ',
    lines: [
      {
        ...pickerRowToLine(row({ product_variant_id: 1 })),
        quantity: 3,
      },
      {
        ...pickerRowToLine(row({ product_variant_id: 2, sku: 'CAM-2' })),
        quantity: 2,
      },
      {
        ...pickerRowToLine(row({ product_id: 11, id: 11, sku: 'PAN-1', product_variant_id: null })),
        quantity: 4,
      },
    ],
  };

  it('manda cada variante con su product_variant_id y la base sin el campo', () => {
    const payload = buildTransferPayload(base)!;

    expect(payload.items).toEqual([
      { product_id: 10, product_variant_id: 1, quantity: 3 },
      { product_id: 10, product_variant_id: 2, quantity: 2 },
      { product_id: 11, quantity: 4 },
    ]);
    expect('product_variant_id' in payload.items[2]).toBeFalse();
    expect(payload.notes).toBe('Reposición semanal');
  });

  it('no arma payload sin origen, sin destino, con origen = destino o sin líneas', () => {
    expect(buildTransferPayload({ ...base, from_location_id: null })).toBeNull();
    expect(buildTransferPayload({ ...base, to_location_id: null })).toBeNull();
    expect(buildTransferPayload({ ...base, to_location_id: 1 })).toBeNull();
    expect(buildTransferPayload({ ...base, lines: [] })).toBeNull();
  });

  it('no arma payload si una cantidad excede el disponible, es cero o no es entera', () => {
    const over = [{ ...base.lines[0], quantity: 9 }];
    const zero = [{ ...base.lines[0], quantity: 0 }];
    const decimal = [{ ...base.lines[0], quantity: 1.5 }];

    expect(buildTransferPayload({ ...base, lines: over })).toBeNull();
    expect(buildTransferPayload({ ...base, lines: zero })).toBeNull();
    expect(buildTransferPayload({ ...base, lines: decimal })).toBeNull();
  });

  it('suma las unidades de todas las líneas', () => {
    expect(totalUnits(base.lines)).toBe(9);
    expect(totalUnits([])).toBe(0);
  });
});

describe('TransferDraftHandoffService', () => {
  it('entrega el borrador una sola vez y lo limpia', () => {
    const service = new TransferDraftHandoffService();
    const draft = {
      from_location_id: 1,
      to_location_id: 2,
      from_location_name: 'Principal',
      to_location_name: 'Sucursal',
      notes: 'x',
      lines: [pickerRowToLine(row())],
    };

    expect(service.consume()).toBeNull();
    service.set(draft);

    const handed = service.consume();
    expect(handed?.from_location_id).toBe(1);
    expect(handed?.from_location_name).toBe('Principal');
    expect(handed?.lines.length).toBe(1);
    // Copia defensiva: quien lo recibe no muta lo entregado.
    expect(handed?.lines[0]).not.toBe(draft.lines[0]);
    expect(service.consume()).toBeNull();
  });
});
