import { buildCostPreviewRequest } from './pop-cost-preview';
import { SHIPPING_ALLOCATION_LEGEND } from './constants';
import type { PopCartItem, PopCartState } from './types';

/**
 * CP-PURCHASE-TRANSPARENCY B.5 / C.5 — las reglas que rompen EN SILENCIO.
 *
 * Cada caso de acá fija un defecto que no se ve en pantalla:
 *  - una línea de producto nuevo en la petición devuelve 400 y la confirmación
 *    se queda sin panel fiscal por un motivo que nada tiene que ver con el IVA;
 *  - un flete sin modo (o un modo sin flete) también devuelve 400, y el
 *    operador sólo ve «no se pudo crear la orden».
 */

function item(overrides: Partial<PopCartItem> = {}): PopCartItem {
  return {
    id: 'POP_ITEM_1',
    product: { id: 10, name: 'Arroz' },
    quantity: 2,
    unit_cost: 1500,
    subtotal: 3000,
    total: 3000,
    addedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

function cart(overrides: Partial<PopCartState> = {}): PopCartState {
  return {
    items: [item()],
    summary: {
      subtotal: 3000,
      tax_amount: 0,
      shipping_cost: 0,
      total: 3000,
      itemCount: 1,
      totalItems: 2,
    },
    locationId: 7,
    orderDate: '2026-08-22',
    shippingCost: 0,
    status: 'draft',
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildCostPreviewRequest', () => {
  it('devuelve null sin bodega: la vista previa se valora CONTRA una bodega', () => {
    expect(buildCostPreviewRequest(cart({ locationId: undefined }))).toBeNull();
  });

  it('manda las líneas con producto real', () => {
    const request = buildCostPreviewRequest(cart());
    expect(request).not.toBeNull();
    expect(request!.location_id).toBe(7);
    expect(request!.items).toEqual([
      { product_id: 10, quantity: 2, unit_cost: 1500 },
    ]);
  });

  it('incluye la variante sólo cuando la línea la tiene', () => {
    const request = buildCostPreviewRequest(
      cart({ items: [item({ variant: { id: 55, name: 'Rojo' } })] }),
    );
    expect(request!.items[0].product_variant_id).toBe(55);
  });

  it('excluye las líneas prebulk: su producto todavía no existe en backend', () => {
    const request = buildCostPreviewRequest(
      cart({
        items: [
          item(),
          item({ id: 'POP_ITEM_2', is_prebulk: true, product: { id: 11, name: 'Nuevo' } }),
        ],
      }),
    );
    expect(request!.items).toHaveLength(1);
    expect(request!.items[0].product_id).toBe(10);
  });

  it('excluye los ids NEGATIVOS (producto temporal del escáner o del importador)', () => {
    // `CostPreviewItemDto.product_id` exige `@Min(1)`: una sola línea con id
    // negativo devuelve 400 para TODA la petición.
    const request = buildCostPreviewRequest(
      cart({
        items: [item(), item({ id: 'POP_ITEM_2', product: { id: -9123, name: 'Temp' } })],
      }),
    );
    expect(request!.items).toHaveLength(1);
    expect(request!.items[0].product_id).toBe(10);
  });

  it('devuelve null cuando SÓLO hay productos nuevos: nada que consultar', () => {
    const request = buildCostPreviewRequest(
      cart({ items: [item({ product: { id: -1, name: 'Temp' } })] }),
    );
    expect(request).toBeNull();
  });

  it('con flete en cero NO manda el modo: `prorate` sin monto es 400', () => {
    const request = buildCostPreviewRequest(
      cart({ shippingCost: 0, shippingCostAllocation: 'prorate' }),
    );
    expect(request!.shipping_cost).toBe(0);
    expect('shipping_cost_allocation' in request!).toBe(false);
  });

  it('con flete > 0 siembra `prorate` cuando el carrito no trae modo', () => {
    const request = buildCostPreviewRequest(cart({ shippingCost: 12000 }));
    expect(request!.shipping_cost).toBe(12000);
    expect(request!.shipping_cost_allocation).toBe('prorate');
  });

  it('respeta `expense` cuando el operador lo eligió', () => {
    const request = buildCostPreviewRequest(
      cart({ shippingCost: 12000, shippingCostAllocation: 'expense' }),
    );
    expect(request!.shipping_cost_allocation).toBe('expense');
  });

  it('recorta el flete a 2 decimales: la columna es Decimal(12,2)', () => {
    const request = buildCostPreviewRequest(cart({ shippingCost: 1234.567 }));
    expect(request!.shipping_cost).toBe(1234.57);
  });

  it('trata un flete negativo o no numérico como cero, y sin modo', () => {
    const negative = buildCostPreviewRequest(cart({ shippingCost: -50 }));
    expect(negative!.shipping_cost).toBe(0);
    expect('shipping_cost_allocation' in negative!).toBe(false);

    const notANumber = buildCostPreviewRequest(
      cart({ shippingCost: Number.NaN }),
    );
    expect(notANumber!.shipping_cost).toBe(0);
  });

  it('no manda tax_rate ni descuentos: el POP móvil todavía no los captura', () => {
    // `PopCartItem.tax_rate` se usa internamente como FRACCIÓN y el DTO espera
    // un PORCENTAJE. Mandarlo tal cual declararía un IVA del 0,19 %.
    const request = buildCostPreviewRequest(
      cart({ items: [item({ tax_rate: 0.19, discount: 500 })] }),
    );
    expect(request!.items[0]).toEqual({
      product_id: 10,
      quantity: 2,
      unit_cost: 1500,
    });
  });
});

describe('SHIPPING_ALLOCATION_LEGEND', () => {
  /**
   * Los textos son los MISMOS que muestra la web
   * (`pop-order-config-modal.component.ts`, `allocationLegend`). Si divergen,
   * el mismo negocio lee dos explicaciones distintas de la misma decisión según
   * el dispositivo desde el que compra — por eso se fijan letra por letra.
   */
  it('explica el prorrateo en términos de negocio, palabra por palabra', () => {
    expect(SHIPPING_ALLOCATION_LEGEND.prorate).toBe(
      'El flete se reparte entre los productos según su participación en la compra, así que cada producto queda valorado con lo que realmente costó ponerlo en bodega: sube su costo unitario y con él el margen que calcula el sistema. El flete se suma al total de la orden.',
    );
  });

  it('explica el modo gasto, palabra por palabra', () => {
    expect(SHIPPING_ALLOCATION_LEGEND.expense).toBe(
      'El flete no toca el costo de los productos: se registra como un costo de la orden y el costo unitario no se mueve. El flete se suma igual al total de la orden.',
    );
  });

  it('los dos modos dicen que el flete se suma al total', () => {
    expect(SHIPPING_ALLOCATION_LEGEND.prorate).toContain(
      'se suma al total de la orden',
    );
    expect(SHIPPING_ALLOCATION_LEGEND.expense).toContain(
      'se suma igual al total de la orden',
    );
  });
});
