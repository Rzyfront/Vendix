import {
  ORDER_ADAPTER_VERSION,
  compactOrder,
  customerName,
  summarizeItems,
  toStockLines,
} from './order.adapter';

/**
 * Paso 15 (T6) — contrato del adaptador `orders`.
 *
 * Pinnea (a) la versión del adaptador contra el contrato (`'1'`),
 * (b) equivalencia happy con los mappers que vivían inline en
 * `orders.tools.ts` (camino feliz SIN `note`: forma idéntica a la previa) y
 * (c) degradación honesta: identidad ausente o versión pedida distinta
 * portan `note` explícito en vez de inventar la fila.
 */
describe('order.adapter', () => {
  describe('versión', () => {
    it("implementa el contrato v1 de las tools", () => {
      expect(ORDER_ADAPTER_VERSION).toBe('1');
    });
  });

  describe('customerName', () => {
    it('happy: usuario con nombres, o correo si no hay nombres', () => {
      expect(
        customerName({
          users: { first_name: 'Ana', last_name: 'Martínez' },
        }),
      ).toBe('Ana Martínez');
      expect(customerName({ users: { email: 'ana@x.co' } })).toBe('ana@x.co');
    });

    it('invitado: rasca el snapshot antes de rendirse', () => {
      expect(
        customerName({
          shipping_address_snapshot: { full_name: 'Pedro Pérez' },
        }),
      ).toBe('Pedro Pérez');
      expect(
        customerName({
          shipping_address_snapshot: {
            first_name: 'Pedro',
            last_name: 'Pérez',
          },
        }),
      ).toBe('Pedro Pérez');
    });

    it('sad: sin usuario ni snapshot, etiqueta honesta de invitado', () => {
      expect(customerName({})).toBe('Invitado (sin cliente registrado)');
    });
  });

  describe('compactOrder', () => {
    const ORDER = {
      id: 7,
      order_number: 'OV-007',
      users: { first_name: 'Ana', last_name: 'Ríos' },
      customer_id: 9,
      state: 'processing',
      channel: 'pos',
      delivery_type: 'delivery',
      grand_total: 100.456,
      total_paid: 40,
      remaining_balance: 60.456,
      dispatch_fulfillment: 'partial',
      order_items: [{ id: 1 }, { id: 2 }],
      created_at: '2026-01-01T00:00:00.000Z',
    };

    it('happy: fila exacta y SIN note', () => {
      const row = compactOrder(ORDER);
      expect(row).toEqual({
        order_id: 7,
        numero: 'OV-007',
        cliente: 'Ana Ríos',
        customer_id: 9,
        estado: 'processing',
        canal: 'pos',
        tipo_entrega: 'delivery',
        total: 100.46,
        pagado: 40,
        saldo_pendiente: 60.46,
        cumplimiento_despacho: 'partial',
        items: 2,
        creada: '2026-01-01T00:00:00.000Z',
      });
      expect('note' in row).toBe(false);
    });

    it('sad: sin identidad mínima, la fila porta note y no inventa', () => {
      const row = compactOrder({ state: 'draft' });
      expect(row.order_id).toBeUndefined();
      expect(row.numero).toBeUndefined();
      expect(row.note).toContain('sin identificador');
    });

    it('sad: versión pedida distinta degrada con note explícito', () => {
      const row = compactOrder(ORDER, '99');
      expect(row.order_id).toBe(7);
      expect(row.note).toContain('v99');
      expect(row.note).toContain(`v${ORDER_ADAPTER_VERSION}`);
    });
  });

  describe('toStockLines', () => {
    it('solo renglones con producto válido y cantidad positiva', () => {
      expect(
        toStockLines([
          {
            product_id: 1,
            product_variant_id: 2,
            quantity: 3,
            product_name: 'Coca',
          },
          { product_name: 'Servicio' },
          { product_id: 5, quantity: 0 },
        ]),
      ).toEqual([
        {
          product_id: 1,
          product_variant_id: 2,
          quantity: 3,
          product_name: 'Coca',
        },
      ]);
    });
  });

  describe('summarizeItems', () => {
    it('sujeto humano "2× X + 1× Y"', () => {
      expect(
        summarizeItems([
          { quantity: 2, product_name: 'Coca Cola 1L' },
          { quantity: 1, product_name: 'Pan' },
        ]),
      ).toBe('2× Coca Cola 1L + 1× Pan');
    });
  });
});
