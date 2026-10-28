import { guestFieldErrors, reportsSire, resolveNationality } from './lodging-guest-rules';

/** H3.1 — a Colombian holder that fills every TRA field. */
const HOLDER = {
  document_type: 'CC',
  document_number: '1020304050',
  first_name: 'Ana',
  last_name: 'Pérez',
  nationality_country_code: null,
  birth_date: null,
  residence_city: 'Bogotá',
  origin_city: 'Medellín',
  travel_purpose: 'vacation',
};

/** H3.1 — a US companion with a passport. */
const COMPANION = {
  ...HOLDER,
  document_type: 'PA',
  document_number: 'X1234567',
  first_name: 'John',
  last_name: 'Smith',
  nationality_country_code: 'US',
  birth_date: '1990-05-01',
  residence_city: 'Miami',
  origin_city: 'Miami',
};

describe('H3.1 guest register rules (TRA and SIRE)', () => {
  it('accepts a Colombian holder with every TRA field and defaults nationality to CO', () => {
    expect(guestFieldErrors(HOLDER)).toEqual([]);
    expect(resolveNationality(HOLDER)).toBe('CO');
    expect(reportsSire(resolveNationality(HOLDER))).toBe(false);
  });

  it('says "Falta ciudad de residencia" when the TRA field is missing', () => {
    expect(guestFieldErrors({ ...HOLDER, residence_city: '  ' })).toEqual([
      'Falta ciudad de residencia',
    ]);
  });

  it('names every missing TRA field', () => {
    expect(
      guestFieldErrors({
        ...HOLDER,
        document_number: '',
        first_name: '',
        last_name: '',
        origin_city: null,
        travel_purpose: null,
      }),
    ).toEqual([
      'Falta número de documento',
      'Falta nombre',
      'Falta apellido',
      'Falta ciudad de procedencia',
      'Falta motivo de viaje',
    ]);
  });

  it('requires the nationality of a passport', () => {
    expect(guestFieldErrors({ ...COMPANION, nationality_country_code: null })).toEqual([
      'El pasaporte exige nacionalidad',
    ]);
    expect(resolveNationality({ ...COMPANION, nationality_country_code: null })).toBeNull();
  });

  it('requires the nationality of other foreign documents too', () => {
    expect(
      guestFieldErrors({ ...COMPANION, document_type: 'CE', nationality_country_code: '' }),
    ).toEqual(['El documento extranjero exige nacionalidad']);
  });

  it('flags a foreign guest as SIRE and asks for the birth date', () => {
    expect(guestFieldErrors(COMPANION)).toEqual([]);
    expect(reportsSire(resolveNationality(COMPANION))).toBe(true);
    expect(guestFieldErrors({ ...COMPANION, birth_date: null })).toEqual([
      'Falta fecha de nacimiento (reporta SIRE)',
    ]);
  });

  it('rejects an unknown travel purpose', () => {
    expect(guestFieldErrors({ ...HOLDER, travel_purpose: 'party' })).toEqual([
      'Falta motivo de viaje',
    ]);
  });

  it('keeps a Colombian document with a foreign nationality out of the passport rule', () => {
    const dual = { ...HOLDER, nationality_country_code: 'es' };
    expect(resolveNationality(dual)).toBe('ES');
    expect(guestFieldErrors({ ...dual, birth_date: '1985-01-01' })).toEqual([]);
  });
});
