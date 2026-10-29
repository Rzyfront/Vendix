import { notesWithRnt, rntLine, rntRenewalNotice, RNT_MISSING_REASON, storeRnt } from './rnt';
import { VatExemptionGuest, vatExemptionBlockers } from '../reservations/guests/lodging-vat-exemption';

/**
 * H4.3 — the RNT is printed on the guest documents and reminded in March. D14:
 * a missing RNT only explains why the VAT exemption does not apply; nothing
 * else is blocked by it.
 */
describe('RNT (H4.3)', () => {
  describe('storeRnt / rntLine', () => {
    it('reads the trimmed RNT of the settings', () => {
      expect(storeRnt({ rnt_number: ' 12345 ' })).toBe('12345');
      expect(rntLine('12345')).toBe('RNT 12345');
    });

    it('an empty or missing RNT prints nothing', () => {
      expect(storeRnt({ rnt_number: '   ' })).toBeNull();
      expect(storeRnt(undefined)).toBeNull();
      expect(storeRnt({ rnt_number: 12345 })).toBeNull();
      expect(rntLine(null)).toBeNull();
    });
  });

  describe('notesWithRnt (invoice footer)', () => {
    it('appends the RNT to the invoice notes', () => {
      expect(notesWithRnt('Reserva R-0001', '12345')).toBe('Reserva R-0001 · RNT 12345');
      expect(notesWithRnt(null, '12345')).toBe('RNT 12345');
    });

    it('leaves the notes untouched without an RNT and never repeats it', () => {
      expect(notesWithRnt('Reserva R-0001', '')).toBe('Reserva R-0001');
      expect(notesWithRnt(null, null)).toBeUndefined();
      expect(notesWithRnt('RNT 12345', '12345')).toBe('RNT 12345');
    });
  });

  describe('rntRenewalNotice (March reminder)', () => {
    it('in March a store with RNT gets the reminder to renew before March 31', () => {
      const notice = rntRenewalNotice({ rnt_number: '12345' }, { year: 2027, month: 3 });
      expect(notice).toEqual({
        title: 'Renueva el RNT del hotel',
        body: 'Renueva el Registro Nacional de Turismo (RNT) 12345 antes del 31 de marzo de 2027. Si ya lo hiciste, ignora este aviso.',
        data: { kind: 'rnt_renewal', year: 2027, rnt_number: '12345', route: '/admin/settings/general/hoteleria' },
      });
    });

    it('outside March there is no reminder', () => {
      expect(rntRenewalNotice({ rnt_number: '12345' }, { year: 2027, month: 2 })).toBeNull();
      expect(rntRenewalNotice({ rnt_number: '12345' }, { year: 2027, month: 4 })).toBeNull();
    });

    it('the owner can turn it off, and a store without RNT has nothing to renew', () => {
      expect(
        rntRenewalNotice({ rnt_number: '12345', rnt_renewal_reminder: false }, { year: 2027, month: 3 }),
      ).toBeNull();
      expect(rntRenewalNotice({ rnt_number: '' }, { year: 2027, month: 3 })).toBeNull();
    });
  });

  describe('missing RNT rules (D14)', () => {
    const holder: VatExemptionGuest = {
      is_primary: true,
      document_type: 'PA',
      nationality_country_code: 'US',
      is_non_resident: true,
      entry_permit_type: 'PIP-5',
    };

    it('without RNT the VAT exemption is not applied and says why', () => {
      const reasons = vatExemptionBlockers('', holder);
      expect(reasons).toEqual([RNT_MISSING_REASON]);
      expect(RNT_MISSING_REASON).toBe('La tienda no tiene RNT: regístralo en Configuración → Hotelería');
    });

    it('with RNT the same guest takes the exemption', () => {
      expect(vatExemptionBlockers('12345', holder)).toEqual([]);
    });
  });
});
