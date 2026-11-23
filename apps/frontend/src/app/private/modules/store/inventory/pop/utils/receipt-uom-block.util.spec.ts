import {
  cartReceiptUomBlocks,
  receiptUomBlockMessage,
} from './receipt-uom-block.util';

const G = { id: 1, code: 'g', dimension: 'mass', factor_to_base: '1.000000' };
const KG = { id: 2, code: 'kg', dimension: 'mass', factor_to_base: '1000.000000' };
const ML = { id: 3, code: 'ml', dimension: 'volume', factor_to_base: '1' };
const UNIT = { id: 4, code: 'unit', dimension: 'count', factor_to_base: '1' };
const CATALOG = [G, KG, ML, UNIT];

describe('receiptUomBlockMessage (QUI-1017)', () => {
  it('stock en g sin unidad de compra ⇒ bloquea nombrando el producto', () => {
    const msg = receiptUomBlockMessage({
      productName: 'Carne molida',
      stockUom: G,
      purchaseUom: null,
    });
    expect(msg).toContain('"Carne molida"');
    expect(msg).toContain('no tiene unidad de compra');
  });

  it('kg → g se convierte (no bloquea); g → kg bloquea', () => {
    expect(receiptUomBlockMessage({ stockUom: G, purchaseUom: KG })).toBeNull();
    expect(receiptUomBlockMessage({ stockUom: KG, purchaseUom: G })).toContain(
      'menor que la de stock',
    );
  });

  it('envase → contenido: bloquea la línea nueva sin contenido, no la del producto guardado', () => {
    expect(
      receiptUomBlockMessage({ stockUom: G, purchaseUom: UNIT }),
    ).toContain('cuántos g trae cada unit');
    expect(
      receiptUomBlockMessage({ stockUom: G, purchaseUom: UNIT, contentPerPackage: 250 }),
    ).toBeNull();
    expect(
      receiptUomBlockMessage({ stockUom: G, purchaseUom: UNIT, persistedProduct: true }),
    ).toBeNull();
  });

  it('masa ↔ volumen bloquea', () => {
    expect(receiptUomBlockMessage({ stockUom: ML, purchaseUom: KG })).toContain(
      'no se pueden convertir',
    );
  });

  it('stock por unidad o sin unidad de stock no aplica', () => {
    expect(receiptUomBlockMessage({ stockUom: UNIT, purchaseUom: null })).toBeNull();
    expect(receiptUomBlockMessage({ stockUom: null, purchaseUom: null })).toBeNull();
  });
});

describe('cartReceiptUomBlocks (QUI-1017)', () => {
  it('la UoM de la línea gana sobre la del producto y los mensajes no se repiten', () => {
    const blocked = {
      product: { id: 9, name: 'Costilla', stock_uom_id: 1, purchase_uom_id: null },
      stock_uom_id: null,
      purchase_uom_id: null,
    };
    const fixedByLine = {
      product: { id: 10, name: 'Lomo', stock_uom_id: 1, purchase_uom_id: null },
      stock_uom_id: null,
      purchase_uom_id: 2,
    };
    expect(cartReceiptUomBlocks([blocked, blocked, fixedByLine], CATALOG)).toEqual([
      jasmine.stringContaining('"Costilla"') as unknown as string,
    ]);
  });

  it('sin catálogo cargado no bloquea (el backend sigue validando)', () => {
    expect(
      cartReceiptUomBlocks(
        [{ product: { id: 9, name: 'Costilla', stock_uom_id: 1 } }],
        null,
      ),
    ).toEqual([]);
  });
});
