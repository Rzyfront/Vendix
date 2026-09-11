import {
  shouldShortCircuitResolve,
  CustomerResolveFormIdentifiers,
} from './customer-resolve-guard.util';

/**
 * CP-pos-customer-stale — Unit tests for the resolve short-circuit guard.
 *
 * Regression net for "seleccionar-A-luego-crear-B vende a A": any filled
 * identifier must force a backend resolve, never a silent short-circuit.
 * Pure-function tests (no TestBed). Run with `ng test` (Karma + Jasmine).
 */
describe('shouldShortCircuitResolve', () => {
  const empty: CustomerResolveFormIdentifiers = {
    hasEmail: false,
    hasDocument: false,
    hasName: false,
  };

  it('short-circuits when a customer is selected and the form is empty', () => {
    expect(shouldShortCircuitResolve(true, empty)).toBeTrue();
  });

  it('never short-circuits without a selected customer, even with an empty form', () => {
    expect(shouldShortCircuitResolve(false, empty)).toBeFalse();
  });

  it('forces resolve when the cashier typed an email (A selected, B typed)', () => {
    expect(
      shouldShortCircuitResolve(true, {
        ...empty,
        hasEmail: true,
      }),
    ).toBeFalse();
  });

  it('forces resolve when the cashier typed a document', () => {
    expect(
      shouldShortCircuitResolve(true, {
        ...empty,
        hasDocument: true,
      }),
    ).toBeFalse();
  });

  it('forces resolve when the cashier typed only a name (quick-sale)', () => {
    expect(
      shouldShortCircuitResolve(true, {
        ...empty,
        hasName: true,
      }),
    ).toBeFalse();
  });

  it('forces resolve without selection whenever any identifier exists', () => {
    expect(
      shouldShortCircuitResolve(false, {
        hasEmail: true,
        hasDocument: true,
        hasName: true,
      }),
    ).toBeFalse();
  });
});
