import type { AppPageDocument } from '../../templates';
import {
  EMPTY_BOOKING_CONTEXT,
  MISSING_ONLINE_PAYMENT_WARNING,
  bookingBuilderAdapter,
  fillPolicyDefaults,
} from './booking-builder';

const page = (props: Record<string, unknown>, enabled = true): AppPageDocument =>
  ({
    version: 1,
    blocks: [{ id: 'policies', type: 'policies', enabled, props }],
  }) as unknown as AppPageDocument;

const defaults = {
  check_in: 'Desde las 3:00 p. m.',
  check_out: 'Hasta las 12:00 m.',
  cancellation: 'Flexible: gratis hasta 48 h antes de la llegada',
};

describe('fillPolicyDefaults (S11 preview)', () => {
  it('fills the empty policy texts with the hotel rules', () => {
    const out = fillPolicyDefaults(page({ check_in: '', check_out: '  ' }), defaults);
    expect(out.blocks[0].props).toEqual(jasmine.objectContaining(defaults));
  });

  it('keeps the texts the owner saved', () => {
    const out = fillPolicyDefaults(page({ check_in: 'Desde las 2:00 p. m.' }), defaults);
    expect(out.blocks[0].props['check_in']).toBe('Desde las 2:00 p. m.');
  });

  it('leaves a hidden section and a missing context alone', () => {
    const hidden = page({ check_in: '' }, false);
    expect(fillPolicyDefaults(hidden, defaults)).toBe(hidden);
    const shown = page({ check_in: '' });
    expect(fillPolicyDefaults(shown, undefined)).toBe(shown);
  });
});

describe('booking adapter warnings (S9)', () => {
  const adapter = bookingBuilderAdapter({} as never, {} as never);

  it('warns when guests cannot pay online', () => {
    expect(adapter.warnings!({ ...EMPTY_BOOKING_CONTEXT, online_payment_ready: false })).toEqual([
      MISSING_ONLINE_PAYMENT_WARNING,
    ]);
    expect(MISSING_ONLINE_PAYMENT_WARNING.text).toBe(
      'Falta activar el pago en línea: los huéspedes no podrán completar reservas.',
    );
  });

  it('says nothing when online payment is active or the context is unknown', () => {
    expect(adapter.warnings!({ ...EMPTY_BOOKING_CONTEXT, online_payment_ready: true })).toEqual([]);
    expect(adapter.warnings!(null)).toEqual([]);
  });
});
