import { availableStockLabel } from './product-card-stock.util';

/**
 * QUI-986 — en el POS móvil la tarjeta decía «Disponible» sin la cantidad,
 * mientras en escritorio mostraba «N Disponibles». La insignia móvil usa esta
 * etiqueta para que el cajero vea cómo baja el inventario al vender.
 */
describe('availableStockLabel (QUI-986)', () => {
  it('shows the available quantity for a product with tracked inventory', () => {
    expect(availableStockLabel({ stock: 25, track_inventory: true })).toBe(
      '25 disponibles',
    );
  });

  it('defaults to tracked inventory when the flag is absent', () => {
    expect(availableStockLabel({ stock: 7 })).toBe('7 disponibles');
  });

  it('formats thousands and up to 3 decimals like sale quantities (es-CO)', () => {
    expect(availableStockLabel({ stock: 1250 })).toBe('1.250 disponibles');
    expect(availableStockLabel({ stock: 12.3456 })).toBe('12,346 disponibles');
  });

  it('keeps the plain label when the product does not track inventory', () => {
    expect(availableStockLabel({ stock: 0, track_inventory: false })).toBe(
      'Disponible',
    );
    expect(
      availableStockLabel({
        stock: 0,
        track_inventory: true,
        effective_track_inventory: false,
      }),
    ).toBe('Disponible');
  });
});
