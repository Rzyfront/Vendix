import { ORDER_DELIVERY_CONFIG, ORDER_DELIVERY_STEP_LABELS, pendingKitchenLabelsFromError } from './order-details-page.component';

describe('OrderDetailsPageComponent — vocabulario de entrega', () => {
  it('distingue Para llevar, recogida real y consumo en mesa', () => {
    expect(ORDER_DELIVERY_CONFIG.direct_delivery.label).toBe('Entrega directa en mostrador');
    expect(ORDER_DELIVERY_CONFIG.pickup.label).toBe('Recogida en tienda');
    expect(ORDER_DELIVERY_CONFIG.dine_in.label).toBe('Consumo en mesa');
    expect(ORDER_DELIVERY_STEP_LABELS.direct_delivery['shipped']).toBe('Entregada en mostrador');
    expect(ORDER_DELIVERY_STEP_LABELS.pickup['shipped']).toBe('Lista para recogida');
    expect(ORDER_DELIVERY_STEP_LABELS.pickup['delivered']).toBe('Recogida en tienda');
    expect(ORDER_DELIVERY_STEP_LABELS.dine_in['delivered']).toBe('Servida en mesa');
  });
});

describe('OrderDetailsPageComponent — platos pendientes al finalizar', () => {
  it('usa la lista fresca del error tipado, incluyendo variante y cantidad', () => {
    expect(pendingKitchenLabelsFromError({
      details: { pending_items: [
        { product_name: 'Hamburguesa', variant_label: 'Grande', quantity: 2 },
        { product_name: 'Papas', variant_label: null, quantity: 1 },
      ] },
    })).toEqual(['Hamburguesa (Grande) ×2', 'Papas']);
  });

  it('tolera errores sin una lista válida', () => {
    expect(pendingKitchenLabelsFromError({ details: { pending_items: null } })).toEqual([]);
    expect(pendingKitchenLabelsFromError(null)).toEqual([]);
  });
});
