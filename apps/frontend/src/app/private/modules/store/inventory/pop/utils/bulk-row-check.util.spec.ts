import {
  BULK_ROW_ERRORS,
  BulkMatchableRow,
  applyBulkLineMatch,
  bulkRowBasicErrors,
  mapWithConcurrency,
} from './bulk-row-check.util';

describe('bulk-row-check.util (QUI-1004)', () => {
  const row = (over: Partial<BulkMatchableRow> = {}): BulkMatchableRow => ({
    name: 'Café nuevo',
    sku: 'CAF-NEW',
    errors: [],
    ...over,
  });

  describe('bulkRowBasicErrors', () => {
    it('fila válida no tiene errores (costo vacío no es error)', () => {
      expect(
        bulkRowBasicErrors({ sku: 'A', quantity: 2, unit_cost: 0 }),
      ).toEqual([]);
    });

    it('fila inválida: sin código, cantidad inválida y costo negativo', () => {
      expect(
        bulkRowBasicErrors({ sku: '', quantity: 0, unit_cost: -5 }),
      ).toEqual([
        BULK_ROW_ERRORS.missingCode,
        BULK_ROW_ERRORS.invalidQuantity,
        BULK_ROW_ERRORS.invalidCost,
      ]);
      expect(
        bulkRowBasicErrors({ sku: 'A', quantity: Number.NaN, unit_cost: 1 }),
      ).toEqual([BULK_ROW_ERRORS.invalidQuantity]);
    });

    it('solo código de barras basta para identificar el producto', () => {
      expect(
        bulkRowBasicErrors({ sku: '', barcode: '7701', quantity: 1, unit_cost: 1 }),
      ).toEqual([]);
    });
  });

  describe('applyBulkLineMatch', () => {
    it('producto inexistente NO es error: se marca para crear', () => {
      const r = row();
      applyBulkLineMatch(r, {
        index: 0,
        product_id: null,
        product_variant_id: null,
        product_name: null,
        sku: 'CAF-NEW',
        will_create: true,
      });
      expect(r.errors).toEqual([]);
      expect(r.will_create).toBeTrue();
      expect(r.product_id).toBeNull();
    });

    it('producto existente toma su id y completa nombre desde el catálogo', () => {
      const r = row({ name: '' });
      applyBulkLineMatch(r, {
        index: 0,
        product_id: 7,
        product_variant_id: 70,
        product_name: 'Camisa - M',
        sku: 'CAM-M',
        will_create: false,
      });
      expect(r).toEqual(
        jasmine.objectContaining({
          errors: [],
          product_id: 7,
          product_variant_id: 70,
          will_create: false,
          name: 'Camisa - M',
        }),
      );
    });

    it('producto nuevo sin nombre es error (no se puede crear)', () => {
      const r = row({ name: '' });
      applyBulkLineMatch(r, {
        index: 0,
        product_id: null,
        product_variant_id: null,
        product_name: null,
        sku: 'X',
        will_create: true,
      });
      expect(r.errors).toEqual([BULK_ROW_ERRORS.newProductWithoutName]);
      expect(r.will_create).toBeUndefined();
    });

    it('error del backend o fila sin respuesta queda en error', () => {
      const a = row();
      applyBulkLineMatch(a, {
        index: 0,
        product_id: null,
        product_variant_id: null,
        product_name: null,
        sku: null,
        will_create: false,
        error: { code: 'PO_BULK_LINE_WITHOUT_CODE', message: 'falta el SKU' },
      });
      expect(a.errors).toEqual(['falta el SKU']);
      const b = row();
      applyBulkLineMatch(b, undefined);
      expect(b.errors).toEqual([BULK_ROW_ERRORS.notChecked]);
    });
  });
});

describe('mapWithConcurrency (QUI-1004 — validación de compras en paralelo)', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

  it('nunca tiene más de `limit` lotes en vuelo y conserva el orden de los resultados', async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 4, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await tick();
      inFlight--;
      return n * 10;
    });
    expect(peak).toBe(4);
    expect(results).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  });

  it('un lote que falla una vez se reintenta y la revisión sigue', async () => {
    const calls: number[] = [];
    const results = await mapWithConcurrency([1, 2, 3], 2, async (n) => {
      calls.push(n);
      if (n === 2 && calls.filter((c) => c === 2).length === 1) throw new Error('timeout');
      return n;
    });
    expect(results).toEqual([1, 2, 3]);
    expect(calls.filter((c) => c === 2).length).toBe(2);
  });

  it('un lote que falla dos veces aborta y no se inician más lotes', async () => {
    const started: number[] = [];
    await expectAsync(
      mapWithConcurrency([1, 2, 3, 4, 5], 1, async (n) => {
        started.push(n);
        if (n === 2) throw new Error('down');
        return n;
      }),
    ).toBeRejectedWithError('down');
    expect(started).toEqual([1, 2, 2]);
  });
});
