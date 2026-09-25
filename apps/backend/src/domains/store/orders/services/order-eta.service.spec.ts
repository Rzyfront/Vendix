import { OrderEtaService } from './order-eta.service';

/**
 * Paso 5 (roku-shop-checkout-tarifa-detalle-orden) — `computeEta`
 * variant-aware. Regla por ítem: variante con valor → producto →
 * default tienda (15); total = MAX. Puro: sin mocks.
 */
describe('OrderEtaService.computeEta', () => {
  const service = new OrderEtaService();
  const paidAt = new Date('2026-09-24T12:00:00.000Z');
  const ops = { default_preparation_time_minutes: 15 } as any;

  it('variante-gana: el tiempo de la variante prevalece sobre el del producto', () => {
    const eta = service.computeEta(
      [
        {
          preparation_time_minutes: 10,
          variant_preparation_time_minutes: 25,
        },
      ],
      0,
      ops,
      paidAt,
    );
    expect(eta.prepMinutes).toBe(25);
    expect(eta.readyAt).toEqual(new Date('2026-09-24T12:25:00.000Z'));
  });

  it('producto-gana: variante sin valor cae al tiempo del producto', () => {
    const eta = service.computeEta(
      [
        {
          preparation_time_minutes: 20,
          variant_preparation_time_minutes: null,
        },
        { preparation_time_minutes: 12 },
      ],
      0,
      ops,
      paidAt,
    );
    expect(eta.prepMinutes).toBe(20);
    expect(eta.readyAt).toEqual(new Date('2026-09-24T12:20:00.000Z'));
  });

  it('default-15: sin variante ni producto usa el default de la tienda', () => {
    const eta = service.computeEta(
      [
        {
          preparation_time_minutes: null,
          variant_preparation_time_minutes: null,
        },
        { preparation_time_minutes: null },
      ],
      0,
      ops,
      paidAt,
    );
    expect(eta.prepMinutes).toBe(15);
    expect(eta.readyAt).toEqual(new Date('2026-09-24T12:15:00.000Z'));
  });

  it('total MAX: el máximo entre ítems mixtos gana', () => {
    const eta = service.computeEta(
      [
        {
          preparation_time_minutes: 10,
          variant_preparation_time_minutes: 30,
        },
        { preparation_time_minutes: 45 },
        { preparation_time_minutes: null },
      ],
      10,
      ops,
      paidAt,
    );
    expect(eta.prepMinutes).toBe(45);
    expect(eta.transitMinutes).toBe(10);
    expect(eta.readyAt).toEqual(new Date('2026-09-24T12:45:00.000Z'));
    expect(eta.deliveredAt).toEqual(new Date('2026-09-24T12:55:00.000Z'));
  });
});
