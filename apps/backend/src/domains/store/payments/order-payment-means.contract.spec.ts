import {
  OrderForPaymentMeans,
  OrderPaymentForMeans,
  ORDER_PAYMENT_MEANS_INCLUDE,
  resolveOrderDianPaymentMeans,
  resolveOrderPaymentLabel,
} from './order-payment-means.contract';

/**
 * Constructor de un pago con la forma que entrega `ORDER_PAYMENT_MEANS_INCLUDE`.
 * Cada test desvía un solo eje respecto del pago sano.
 */
function payment(options: {
  state?: string | null;
  paid_at?: Date | string | null;
  store_display_name?: string | null;
  system_display_name?: string | null;
  system_name?: string | null;
  dian_code?: string | null;
}): OrderPaymentForMeans {
  return {
    state: options.state === undefined ? 'succeeded' : options.state,
    paid_at: options.paid_at === undefined ? new Date(0) : options.paid_at,
    store_payment_method: {
      display_name: options.store_display_name ?? null,
      system_payment_method: {
        name: options.system_name ?? null,
        display_name: options.system_display_name ?? null,
        dian_code: options.dian_code ?? null,
      },
    },
  };
}

/** Orden sin `payment_form` declarado: el par se deriva de los hechos. */
const ORDER_WITHOUT_FORM: OrderForPaymentMeans = { payment_form: null };

describe('order-payment-means.contract', () => {
  describe('ORDER_PAYMENT_MEANS_INCLUDE', () => {
    it('filtra por pago cobrado, anida el método del sistema y ordena por cobro', () => {
      expect(ORDER_PAYMENT_MEANS_INCLUDE).toEqual({
        where: { state: 'succeeded' },
        include: {
          store_payment_method: { include: { system_payment_method: true } },
        },
        orderBy: { paid_at: 'asc' },
      });
    });
  });

  describe('pago único', () => {
    const payments = [
      payment({
        store_display_name: 'Tarjeta de Crédito',
        dian_code: '48',
        paid_at: new Date('2026-01-10T10:00:00Z'),
      }),
    ];

    it('imprime la etiqueta del método y declara su código DIAN', () => {
      expect(resolveOrderPaymentLabel(payments)).toBe('Tarjeta de Crédito');
      expect(resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)).toEqual(
        { payment_form: '1', payment_means_code: '48' },
      );
    });
  });

  describe('pago mixto', () => {
    const payments = [
      payment({
        store_display_name: 'Efectivo',
        dian_code: '10',
        paid_at: new Date('2026-01-10T10:00:00Z'),
      }),
      payment({
        store_display_name: 'Tarjeta de Crédito',
        dian_code: '48',
        paid_at: new Date('2026-01-10T10:05:00Z'),
      }),
    ];

    it('une las etiquetas en orden de cobro', () => {
      expect(resolveOrderPaymentLabel(payments)).toBe(
        'Efectivo + Tarjeta de Crédito',
      );
    });

    it("declara '1' porque afirmar un instrumento único sería falso", () => {
      expect(resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)).toEqual(
        { payment_form: '1', payment_means_code: '1' },
      );
    });

    it('ordena por paid_at aunque la consulta llegue desordenada', () => {
      expect(resolveOrderPaymentLabel([payments[1], payments[0]])).toBe(
        'Efectivo + Tarjeta de Crédito',
      );
    });

    it('manda los pagos sin paid_at al final', () => {
      const sinFecha = payment({
        store_display_name: 'Bono',
        dian_code: '10',
        paid_at: null,
      });
      expect(resolveOrderPaymentLabel([sinFecha, payments[1]])).toBe(
        'Tarjeta de Crédito + Bono',
      );
    });
  });

  describe('sin pagos', () => {
    it("no tiene etiqueta y declara crédito con instrumento no definido", () => {
      expect(resolveOrderPaymentLabel([])).toBeUndefined();
      expect(resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, [])).toEqual({
        payment_form: '2',
        payment_means_code: '1',
      });
    });

    it('tolera pagos ausentes o nulos', () => {
      expect(resolveOrderPaymentLabel(undefined)).toBeUndefined();
      expect(resolveOrderPaymentLabel(null)).toBeUndefined();
      expect(resolveOrderDianPaymentMeans(null, null)).toEqual({
        payment_form: '2',
        payment_means_code: '1',
      });
    });
  });

  describe('dian_code nulo', () => {
    const payments = [
      payment({ store_display_name: 'Nequi Tienda', dian_code: null }),
    ];

    it("resuelve la etiqueta y cae a '1', nunca a efectivo", () => {
      expect(resolveOrderPaymentLabel(payments)).toBe('Nequi Tienda');
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)
          .payment_means_code,
      ).toBe('1');
    });

    it('trata la cadena vacía igual que el nulo', () => {
      const vacio = [payment({ store_display_name: 'Bono', dian_code: '   ' })];
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, vacio)
          .payment_means_code,
      ).toBe('1');
    });
  });

  describe('dian_code fuera de la tabla de la DIAN', () => {
    it("descarta el '99' histórico de wallet y declara '1'", () => {
      const payments = [
        payment({ store_display_name: 'Wallet', dian_code: '99' }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Wallet');
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)
          .payment_means_code,
      ).toBe('1');
    });

    it('un código válido no nombrado en la unión sí se declara', () => {
      const payments = [payment({ store_display_name: 'Giro', dian_code: '64' })];
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)
          .payment_means_code,
      ).toBe('64');
    });
  });

  describe('estados que no son cobro', () => {
    it('ignora pending y failed en la etiqueta y en el código', () => {
      const payments = [
        payment({ state: 'pending', store_display_name: 'Efectivo', dian_code: '10' }),
        payment({ state: 'failed', store_display_name: 'Tarjeta', dian_code: '48' }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBeUndefined();
      expect(resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)).toEqual(
        { payment_form: '2', payment_means_code: '1' },
      );
    });

    it('un pago fallido no contamina el código del pago cobrado', () => {
      const payments = [
        payment({
          store_display_name: 'Efectivo',
          dian_code: '10',
          paid_at: new Date('2026-01-10T10:00:00Z'),
        }),
        payment({ state: 'failed', store_display_name: 'Tarjeta', dian_code: '48' }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Efectivo');
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)
          .payment_means_code,
      ).toBe('10');
    });
  });

  describe('deduplicación de etiquetas', () => {
    it('dos abonos en efectivo son un solo método, sin separador', () => {
      const payments = [
        payment({
          store_display_name: 'Efectivo',
          dian_code: '10',
          paid_at: new Date('2026-01-10T10:00:00Z'),
        }),
        payment({
          store_display_name: 'Efectivo',
          dian_code: '10',
          paid_at: new Date('2026-01-10T11:00:00Z'),
        }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Efectivo');
      expect(
        resolveOrderDianPaymentMeans(ORDER_WITHOUT_FORM, payments)
          .payment_means_code,
      ).toBe('10');
    });
  });

  describe('cascada de la etiqueta', () => {
    it('el alias de la tienda gana sobre el nombre del sistema', () => {
      const payments = [
        payment({
          store_display_name: 'Datáfono Bancolombia',
          system_display_name: 'Tarjeta de Crédito',
          system_name: 'credit_card',
        }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Datáfono Bancolombia');
    });

    it('cae al display_name del sistema cuando el alias está vacío', () => {
      const payments = [
        payment({
          store_display_name: '   ',
          system_display_name: 'Tarjeta de Crédito',
          system_name: 'credit_card',
        }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Tarjeta de Crédito');
    });

    it('cae al name técnico como último recurso', () => {
      const payments = [payment({ system_name: 'credit_card' })];
      expect(resolveOrderPaymentLabel(payments)).toBe('credit_card');
    });

    it('omite el pago sin ningún nombre', () => {
      const payments = [
        payment({ dian_code: '10' }),
        payment({
          store_display_name: 'Efectivo',
          dian_code: '10',
          paid_at: new Date('2026-01-10T11:00:00Z'),
        }),
      ];
      expect(resolveOrderPaymentLabel(payments)).toBe('Efectivo');
    });
  });

  describe('payment_form declarado por el POS', () => {
    it("respeta '2' aunque exista un pago cobrado", () => {
      const payments = [
        payment({ store_display_name: 'Efectivo', dian_code: '10' }),
      ];
      expect(
        resolveOrderDianPaymentMeans({ payment_form: '2' }, payments),
      ).toEqual({ payment_form: '2', payment_means_code: '10' });
    });

    it("respeta '1' aunque no exista ningún pago", () => {
      expect(resolveOrderDianPaymentMeans({ payment_form: '1' }, [])).toEqual({
        payment_form: '1',
        payment_means_code: '1',
      });
    });

    it('ignora un payment_form fuera de la tabla y deriva de los hechos', () => {
      expect(resolveOrderDianPaymentMeans({ payment_form: '9' }, [])).toEqual({
        payment_form: '2',
        payment_means_code: '1',
      });
    });
  });
});
