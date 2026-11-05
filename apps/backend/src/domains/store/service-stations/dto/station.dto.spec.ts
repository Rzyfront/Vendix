import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateServiceStationDto, RENTAL_BLOCK_PRICE_MAX, UpdateServiceStationDto } from './station.dto';

const errorsOf = (cls: typeof CreateServiceStationDto | typeof UpdateServiceStationDto, body: Record<string, unknown>) =>
  validateSync(plainToInstance(cls, body)).filter((error) => error.property.startsWith('rental_block'));

describe('Station DTOs — alquiler por bloque', () => {
  describe.each([
    ['CreateServiceStationDto', CreateServiceStationDto, { name: 'Cancha 1' }],
    ['UpdateServiceStationDto', UpdateServiceStationDto, {}],
  ] as const)('%s', (_label, cls, base) => {
    it.each([
      ['sin alquiler', {}],
      ['minutos y precio juntos', { rental_block_minutes: 30, rental_block_price: 5000 }],
      ['quitar el alquiler (ambos null)', { rental_block_minutes: null, rental_block_price: null }],
      ['precio en el tope', { rental_block_minutes: 30, rental_block_price: RENTAL_BLOCK_PRICE_MAX }],
    ])('acepta %s', (_case, body) => {
      expect(errorsOf(cls, { ...base, ...body })).toEqual([]);
    });

    it.each([
      ['solo minutos', { rental_block_minutes: 30 }],
      ['solo precio', { rental_block_price: 5000 }],
      ['minutos con precio null', { rental_block_minutes: 30, rental_block_price: null }],
      ['precio con minutos null', { rental_block_minutes: null, rental_block_price: 5000 }],
    ])('rechaza %s', (_case, body) => {
      const errors = errorsOf(cls, { ...base, ...body });
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.flatMap((error) => Object.keys(error.constraints ?? {}))).toContain('IsRentalBlockPair');
    });

    it('rechaza un precio por encima del tope de la columna', () => {
      const errors = errorsOf(cls, { ...base, rental_block_minutes: 30, rental_block_price: RENTAL_BLOCK_PRICE_MAX + 1 });
      expect(errors.flatMap((error) => Object.keys(error.constraints ?? {}))).toContain('max');
    });
  });
});

describe('Station DTOs — impuesto del alquiler', () => {
  const taxErrorsOf = (cls: typeof CreateServiceStationDto | typeof UpdateServiceStationDto, body: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, body)).filter((error) => error.property.startsWith('rental_tax'));

  describe.each([
    ['CreateServiceStationDto', CreateServiceStationDto, { name: 'Cancha 1' }],
    ['UpdateServiceStationDto', UpdateServiceStationDto, {}],
  ] as const)('%s', (_label, cls, base) => {
    it.each([
      ['sin impuesto (omitido)', {}],
      ['quitar el impuesto (null)', { rental_tax_category_id: null }],
      ['categoría y modo agregado', { rental_tax_category_id: 3, rental_tax_is_inclusive: false }],
      ['categoría como texto numérico', { rental_tax_category_id: '3', rental_tax_is_inclusive: true }],
    ])('acepta %s', (_case, body) => {
      expect(taxErrorsOf(cls, { ...base, ...body })).toEqual([]);
    });

    it.each([
      ['categoría 0', { rental_tax_category_id: 0 }],
      ['categoría decimal', { rental_tax_category_id: 1.5 }],
      ['modo no booleano', { rental_tax_is_inclusive: 'si' }],
    ])('rechaza %s', (_case, body) => {
      expect(taxErrorsOf(cls, { ...base, ...body }).length).toBeGreaterThan(0);
    });
  });
});

describe('Station DTOs — reglas de anticipo (S1)', () => {
  const rulesErrorsOf = (cls: typeof CreateServiceStationDto | typeof UpdateServiceStationDto, body: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, body)).map((error) => error.property);

  describe.each([
    ['CreateServiceStationDto', CreateServiceStationDto, { name: 'Cava 3' }],
    ['UpdateServiceStationDto', UpdateServiceStationDto, {}],
  ] as const)('%s', (_label, cls, base) => {
    it.each([
      ['sin reglas', {}],
      ['sin anticipo', { deposit_policy: 'none' }],
      ['anticipo obligatorio con monto', { deposit_policy: 'required', deposit_amount: 400000 }],
      ['anticipo opcional con monto', { deposit_policy: 'optional', deposit_amount: 50000 }],
      ['todas las reglas', {
        deposit_policy: 'required', deposit_amount: 400000, deposit_exhausted_policy: 'recharge',
        leftover_policy: 'minimum_spend', booking_duration_mode: 'free', hold_minutes: 30,
        open_end_block_minutes: 360, cancel_refund_hours: 24, reservation_fee_tax_category_id: 3,
      }],
      ['quitar plazo de devolución e impuesto', { cancel_refund_hours: null, reservation_fee_tax_category_id: null }],
      ['plazo de devolución en cero', { cancel_refund_hours: 0 }],
      ['límites del apartado', { hold_minutes: 5, open_end_block_minutes: 2880 }],
    ])('acepta %s', (_case, body) => {
      expect(rulesErrorsOf(cls, { ...base, ...body })).toEqual([]);
    });

    it.each([
      ['política inválida', { deposit_policy: 'siempre' }, 'deposit_policy'],
      ['anticipo obligatorio sin monto', { deposit_policy: 'required' }, 'deposit_amount'],
      ['anticipo opcional con monto cero', { deposit_policy: 'optional', deposit_amount: 0 }, 'deposit_amount'],
      ['monto con más de dos decimales', { deposit_policy: 'required', deposit_amount: 10.123 }, 'deposit_amount'],
      ['agotado inválido', { deposit_exhausted_policy: 'x' }, 'deposit_exhausted_policy'],
      ['sobrante inválido', { leftover_policy: 'x' }, 'leftover_policy'],
      ['modo de duración inválido', { booking_duration_mode: 'x' }, 'booking_duration_mode'],
      ['apartado menor a 5 minutos', { hold_minutes: 4 }, 'hold_minutes'],
      ['apartado mayor a 1440 minutos', { hold_minutes: 1441 }, 'hold_minutes'],
      ['bloque sin fin menor a 30 minutos', { open_end_block_minutes: 29 }, 'open_end_block_minutes'],
      ['bloque sin fin mayor a 2880 minutos', { open_end_block_minutes: 2881 }, 'open_end_block_minutes'],
      ['plazo de devolución negativo', { cancel_refund_hours: -1 }, 'cancel_refund_hours'],
      ['plazo de devolución decimal', { cancel_refund_hours: 1.5 }, 'cancel_refund_hours'],
      ['categoría de impuesto 0', { reservation_fee_tax_category_id: 0 }, 'reservation_fee_tax_category_id'],
    ])('rechaza %s', (_case, body, property) => {
      expect(rulesErrorsOf(cls, { ...base, ...body })).toContain(property);
    });
  });
});

describe('Station DTOs — reglas de alquiler y cobro para reservar (S17)', () => {
  const rulesErrorsOf = (cls: typeof CreateServiceStationDto | typeof UpdateServiceStationDto, body: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, body)).map((error) => error.property);

  describe.each([
    ['CreateServiceStationDto', CreateServiceStationDto, { name: 'Cancha 1' }],
    ['UpdateServiceStationDto', UpdateServiceStationDto, {}],
  ] as const)('%s', (_label, cls, base) => {
    it.each([
      ['unidad, modo y momento del cobro', { rental_block_unit: 'hour', rental_billing_mode: 'planned', rental_charge_timing: 'at_start' }],
      ['sin cobro para reservar', { booking_prepay_mode: 'none' }],
      ['cobro total', { booking_prepay_mode: 'full' }],
      ['cobro total limpiando valores', { booking_prepay_mode: 'full', booking_prepay_percent: null, booking_prepay_amount: null }],
      ['cobro parcial por porcentaje', { booking_prepay_mode: 'partial', booking_prepay_percent: 30 }],
      ['cobro parcial por monto', { booking_prepay_mode: 'partial', booking_prepay_amount: 50000 }],
      ['porcentaje con dos decimales', { booking_prepay_mode: 'partial', booking_prepay_percent: 12.5 }],
    ])('acepta %s', (_case, body) => {
      expect(rulesErrorsOf(cls, { ...base, ...body })).toEqual([]);
    });

    it.each([
      ['unidad inválida', { rental_block_unit: 'week' }, 'rental_block_unit'],
      ['modo de cobro inválido', { rental_billing_mode: 'x' }, 'rental_billing_mode'],
      ['momento de cobro inválido', { rental_charge_timing: 'x' }, 'rental_charge_timing'],
      ['cobro para reservar inválido', { booking_prepay_mode: 'x' }, 'booking_prepay_mode'],
      ['parcial sin porcentaje ni monto', { booking_prepay_mode: 'partial' }, 'booking_prepay_mode'],
      ['parcial con porcentaje y monto', { booking_prepay_mode: 'partial', booking_prepay_percent: 30, booking_prepay_amount: 50000 }, 'booking_prepay_mode'],
      ['total con porcentaje', { booking_prepay_mode: 'full', booking_prepay_percent: 30 }, 'booking_prepay_mode'],
      ['ninguno con monto', { booking_prepay_mode: 'none', booking_prepay_amount: 50000 }, 'booking_prepay_mode'],
      ['porcentaje cero', { booking_prepay_mode: 'partial', booking_prepay_percent: 0 }, 'booking_prepay_percent'],
      ['porcentaje de 100', { booking_prepay_mode: 'partial', booking_prepay_percent: 100 }, 'booking_prepay_percent'],
      ['porcentaje con tres decimales', { booking_prepay_mode: 'partial', booking_prepay_percent: 12.345 }, 'booking_prepay_percent'],
      ['monto cero', { booking_prepay_mode: 'partial', booking_prepay_amount: 0 }, 'booking_prepay_amount'],
    ])('rechaza %s', (_case, body, property) => {
      expect(rulesErrorsOf(cls, { ...base, ...body })).toContain(property);
    });
  });
});
