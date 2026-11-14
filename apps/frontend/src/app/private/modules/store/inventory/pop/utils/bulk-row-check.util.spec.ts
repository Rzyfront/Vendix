import {
  BULK_ROW_ERRORS,
  BulkMatchableRow,
  applyBulkLineMatch,
  bulkRowBasicErrors,
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
