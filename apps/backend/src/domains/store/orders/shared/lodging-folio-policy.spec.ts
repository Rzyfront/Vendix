import { ErrorCodes, VendixHttpException } from 'src/common/errors';
import { assertNotLodgingFolioOrder } from './lodging-folio-policy';

/** Review ola 3, finding 6 — the generic order flow never touches an open folio. */
describe('assertNotLodgingFolioOrder', () => {
  const errorOf = (fn: () => void): VendixHttpException => {
    try {
      fn();
    } catch (error) {
      return error as VendixHttpException;
    }
    throw new Error('expected the guard to reject');
  };

  it('rejects the draft order of an open folio with ORD_STATUS_001 and points to Hotelería', () => {
    const error = errorOf(() => assertNotLodgingFolioOrder({ state: 'draft', lodging_folio: { id: 40 } }));

    expect(error.errorCode).toBe(ErrorCodes.ORD_STATUS_001.code);
    expect(error.message).toContain('Hotelería');
  });

  it('rejects a lean probe (no state) of a folio order', () => {
    expect(() => assertNotLodgingFolioOrder({ lodging_folio: { id: 40 } })).toThrow(VendixHttpException);
  });

  it('lets a normal order and a checked-out folio order through', () => {
    expect(() => assertNotLodgingFolioOrder({ state: 'draft', lodging_folio: null })).not.toThrow();
    expect(() => assertNotLodgingFolioOrder({ state: 'draft' })).not.toThrow();
    expect(() => assertNotLodgingFolioOrder({ state: 'finished', lodging_folio: { id: 40 } })).not.toThrow();
  });
});
