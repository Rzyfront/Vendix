import { BadRequestException } from '@nestjs/common';
import {
  assertStockAvailableAtOrigin,
  assertTransferLines,
  expandTransferablePickerRows,
  transferLineKey,
} from './transfer-item-rules';

describe('transfer-item-rules', () => {
  describe('assertTransferLines', () => {
    it('acepta dos variantes del mismo producto como líneas distintas', () => {
      expect(() =>
        assertTransferLines([
          { product_id: 1, product_variant_id: 10, quantity: 2 },
          { product_id: 1, product_variant_id: 11, quantity: 1 },
          { product_id: 2, quantity: 5 },
        ]),
      ).not.toThrow();
    });

    it('rechaza el mismo par producto + variante repetido', () => {
      expect(() =>
        assertTransferLines([
          { product_id: 1, product_variant_id: 10, quantity: 2 },
          { product_id: 1, product_variant_id: 10, quantity: 1 },
        ]),
      ).toThrow(/repetido/);
      expect(() =>
        assertTransferLines([
          { product_id: 3, quantity: 1 },
          { product_id: 3, product_variant_id: null, quantity: 1 },
        ]),
      ).toThrow(BadRequestException);
    });

    it('rechaza lista vacía y cantidades no enteras o no positivas', () => {
      expect(() => assertTransferLines([])).toThrow(/al menos un producto/);
      expect(() => assertTransferLines(undefined)).toThrow(BadRequestException);
      expect(() =>
        assertTransferLines([{ product_id: 1, quantity: 0 }]),
      ).toThrow(/entero mayor que cero/);
      expect(() =>
        assertTransferLines([{ product_id: 1, quantity: -3 }]),
      ).toThrow(BadRequestException);
      expect(() =>
        assertTransferLines([{ product_id: 1, quantity: 1.5 }]),
      ).toThrow(BadRequestException);
    });

    it('la clave distingue base de variante', () => {
      expect(transferLineKey({ product_id: 1 })).toBe('1:base');
      expect(transferLineKey({ product_id: 1, product_variant_id: 7 })).toBe(
        '1:7',
      );
    });
  });

  describe('assertStockAvailableAtOrigin', () => {
    const tx = () => ({
      stock_levels: { findFirst: jest.fn() },
      product_variants: { count: jest.fn() },
    });

    it('busca el stock por producto + variante en el origen', async () => {
      const client = tx();
      client.stock_levels.findFirst.mockResolvedValue({
        quantity_available: 5,
        products: { name: 'Camisa' },
        product_variants: { name: 'Roja', sku: 'CAM-R' },
      });

      await assertStockAvailableAtOrigin(
        client,
        [{ product_id: 1, product_variant_id: 10, quantity: 5 }],
        7,
      );

      expect(client.stock_levels.findFirst.mock.calls[0][0].where).toEqual({
        product_id: 1,
        product_variant_id: 10,
        location_id: 7,
      });
    });

    it('producto con variantes enviado sin variante: pide elegir la variante', async () => {
      const client = tx();
      client.stock_levels.findFirst.mockResolvedValue(null);
      client.product_variants.count.mockResolvedValue(2);

      await expect(
        assertStockAvailableAtOrigin(client, [{ product_id: 1, quantity: 1 }], 7),
      ).rejects.toThrow(/maneja variantes/);
    });

    it('stock insuficiente: dice cuánto hay y cuánto se pidió', async () => {
      const client = tx();
      client.stock_levels.findFirst.mockResolvedValue({
        quantity_available: 2,
        products: { name: 'Camisa' },
        product_variants: { name: 'Roja', sku: 'CAM-R' },
      });

      await expect(
        assertStockAvailableAtOrigin(
          client,
          [{ product_id: 1, product_variant_id: 10, quantity: 3 }],
          7,
        ),
      ).rejects.toThrow('Stock insuficiente de Camisa (Roja) en la bodega de origen: disponible 2, pedido 3');
    });
  });

  describe('expandTransferablePickerRows', () => {
    const sl = (
      location_id: number,
      variant: number | null,
      available: number,
    ) => ({
      location_id,
      product_variant_id: variant,
      quantity_on_hand: available,
      quantity_reserved: 0,
      quantity_available: available,
      product_variants: variant
        ? { id: variant, name: `V${variant}`, sku: `SKU-${variant}` }
        : null,
    });

    it('producto simple: una fila con la variante nula', () => {
      const rows = expandTransferablePickerRows(
        { id: 1, name: 'Arroz', sku: 'ARR' },
        [sl(7, null, 4), sl(9, null, 1)],
        7,
        9,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        jasmineLike({
          id: 1,
          product_id: 1,
          product_variant_id: null,
          sku: 'ARR',
        }),
      );
      expect(rows[0].stock_at_origin.quantity_available).toBe(4);
      expect(rows[0].stock_at_destination.quantity_available).toBe(1);
    });

    it('conserva la fila base con existencias aunque haya variantes', () => {
      const rows = expandTransferablePickerRows(
        { id: 1, name: 'Camisa', sku: 'CAM' },
        [sl(7, null, 2), sl(7, 10, 3)],
        7,
        9,
      );
      expect(rows.map((r) => r.product_variant_id)).toEqual([null, 10]);
    });
  });
});

function jasmineLike<T extends object>(partial: T) {
  return expect.objectContaining(partial);
}
