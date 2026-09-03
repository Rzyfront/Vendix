import { canResendOrderItem } from './can-resend';

/**
 * QUI-762 — predicado `canResendOrderItem`.
 *
 * Espejo del backend: si esta función devuelve `false`, el endpoint
 * `POST /store/kitchen-fire/resend` rechazaría con 422
 * `KITCHEN_FIRE_NOT_RESENDABLE`. La acción de "Reenviar a cocina" en el
 * detalle de la orden se oculta cuando el predicado es `false`, así que
 * romper este contrato en silencio reintroduciría acciones que siempre
 * fallan.
 *
 * Tres entradas booleanas (ocho casos canónicos) más dos casos de borde
 * para `orderState` ausente y `kitchen_ticket_items` vacío.
 */

type ItemShape = {
  inventory_consumed_at_fire?: boolean;
  kitchen_ticket_items?: Array<{
    id: number;
    status: 'pending' | 'in_preparation' | 'ready' | 'delivered' | 'cancelled';
    kitchen_ticket_id: number;
  }>;
};

function item(
  inventory_consumed_at_fire: boolean,
  deliveredCount: number,
): ItemShape {
  const kitchen_ticket_items =
    deliveredCount > 0
      ? Array.from({ length: deliveredCount }, () => ({
          id: 1,
          status: 'delivered' as const,
          kitchen_ticket_id: 1,
        }))
      : [
          {
            id: 1,
            status: 'in_preparation' as const,
            kitchen_ticket_id: 1,
          },
        ];
  return { inventory_consumed_at_fire, kitchen_ticket_items };
}

describe('canResendOrderItem (QUI-762)', () => {
  // ─── 8 casos canónicos ─────────────────────────────────────────────
  // bool A: inventory_consumed_at_fire (true = fue consumido al disparar)
  // bool B: orderState en ['cancelled', 'refunded'] (true = terminal)
  // bool C: algún kitchen_ticket_item con status 'delivered' (true = ya entregado)
  //
  // canResend = A && !B && !C

  const cases: ReadonlyArray<{
    name: string;
    A: boolean; // fired
    B: boolean; // order terminal
    C: boolean; // delivered ticket item
    expected: boolean;
  }> = [
    { name: 'A=true, B=false, C=false → true',  A: true,  B: false, C: false, expected: true  },
    { name: 'A=true, B=false, C=true  → false', A: true,  B: false, C: true,  expected: false },
    { name: 'A=true, B=true,  C=false → false', A: true,  B: true,  C: false, expected: false },
    { name: 'A=true, B=true,  C=true  → false', A: true,  B: true,  C: true,  expected: false },
    { name: 'A=false, B=false, C=false → false', A: false, B: false, C: false, expected: false },
    { name: 'A=false, B=false, C=true  → false', A: false, B: false, C: true,  expected: false },
    { name: 'A=false, B=true,  C=false → false', A: false, B: true,  C: false, expected: false },
    { name: 'A=false, B=true,  C=true  → false', A: false, B: true,  C: true,  expected: false },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const orderState = c.B ? 'cancelled' : 'processing';
      const i = item(c.A, c.C ? 1 : 0);
      expect(canResendOrderItem(i, orderState)).toBe(c.expected);
    });
  }

  // ─── Casos de borde ────────────────────────────────────────────────

  it('orderState = "refunded" se trata como terminal (false)', () => {
    expect(canResendOrderItem(item(true, 0), 'refunded')).toBe(false);
  });

  it('orderState ausente (null/undefined) bloquea el resend (guarda del componente)', () => {
    // El page llama al predicado con `this.order()?.state`. Durante la
    // ventana de carga `order()` es null y `state` es undefined. El
    // original (en el componente, antes de la extracción) devolvía
    // `false` ahí — el botón no debe ofrecerse hasta que la orden
    // cargue. Esta guarda es la que la extracción rompió al mover
    // el predicado al helper; el spec la sella como contrato.
    expect(canResendOrderItem(item(true, 0), null)).toBe(false);
    expect(canResendOrderItem(item(true, 0), undefined)).toBe(false);
  });

  it('kitchen_ticket_items undefined no rompe (se trata como "sin delivered")', () => {
    expect(canResendOrderItem({ inventory_consumed_at_fire: true }, 'processing')).toBe(true);
  });

  it('kitchen_ticket_items con estado in_preparation/ready/pending no bloquea', () => {
    const i: ItemShape = {
      inventory_consumed_at_fire: true,
      kitchen_ticket_items: [
        { id: 1, status: 'in_preparation', kitchen_ticket_id: 1 },
        { id: 2, status: 'ready', kitchen_ticket_id: 1 },
        { id: 3, status: 'pending', kitchen_ticket_id: 2 },
        { id: 4, status: 'cancelled', kitchen_ticket_id: 2 },
      ],
    };
    expect(canResendOrderItem(i, 'processing')).toBe(true);
  });

  it('cualquier delivered en CUALQUIER kitchen_ticket_item bloquea', () => {
    const i: ItemShape = {
      inventory_consumed_at_fire: true,
      kitchen_ticket_items: [
        { id: 1, status: 'ready', kitchen_ticket_id: 1 },
        { id: 2, status: 'delivered', kitchen_ticket_id: 1 },
      ],
    };
    expect(canResendOrderItem(i, 'processing')).toBe(false);
  });
});