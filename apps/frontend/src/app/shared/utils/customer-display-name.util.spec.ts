/**
 * Spec de `customer-display-name.util.ts`.
 *
 * Fija como contrato el caso que rompía "Todos los Clientes" y "Facturas" en
 * producción: un cliente persona JURIDICA (NIT) sólo trae `legal_name` —
 * `first_name`/`last_name` quedan vacíos/`null` porque el backend los
 * rechaza para ese `person_type` — y varias pantallas construían el nombre
 * concatenando sólo `first_name` + `last_name`, mostrando "—"/"Sin cliente"
 * sobre un registro completo.
 */
import {
  customerDisplayName,
  DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK,
} from './customer-display-name.util';

describe('customerDisplayName', () => {
  it('usa legal_name para un cliente JURIDICA sin first_name/last_name', () => {
    expect(
      customerDisplayName({
        legal_name: 'ÓPTICA PANORAMA SAS',
        first_name: null,
        last_name: null,
      }),
    ).toBe('ÓPTICA PANORAMA SAS');
  });

  it('recorta espacios de legal_name', () => {
    expect(
      customerDisplayName({ legal_name: '  Comercializadora XYZ  ' }),
    ).toBe('Comercializadora XYZ');
  });

  it('cae a first_name + last_name cuando no hay legal_name', () => {
    expect(
      customerDisplayName({
        legal_name: null,
        first_name: 'Juan',
        last_name: 'Pérez',
      }),
    ).toBe('Juan Pérez');
  });

  it('une sólo la parte presente cuando falta first_name o last_name', () => {
    expect(customerDisplayName({ first_name: 'Juan', last_name: null })).toBe(
      'Juan',
    );
    expect(customerDisplayName({ first_name: null, last_name: 'Pérez' })).toBe(
      'Pérez',
    );
  });

  it('ignora legal_name en blanco y cae a first_name/last_name', () => {
    expect(
      customerDisplayName({
        legal_name: '   ',
        first_name: 'Juan',
        last_name: 'Pérez',
      }),
    ).toBe('Juan Pérez');
  });

  it('devuelve el fallback por defecto ("Sin cliente") sin ningún dato', () => {
    expect(customerDisplayName({})).toBe(DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK);
    expect(customerDisplayName(null)).toBe(DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK);
    expect(customerDisplayName(undefined)).toBe(
      DEFAULT_CUSTOMER_DISPLAY_NAME_FALLBACK,
    );
  });

  it('acepta un fallback explícito por llamador (ej. "-" en tablas)', () => {
    expect(customerDisplayName(null, '-')).toBe('-');
    expect(customerDisplayName({}, '-')).toBe('-');
  });

  it('prioriza legal_name incluso si por error también trae first_name/last_name', () => {
    expect(
      customerDisplayName({
        legal_name: 'ÓPTICA PANORAMA SAS',
        first_name: 'No',
        last_name: 'Debería verse',
      }),
    ).toBe('ÓPTICA PANORAMA SAS');
  });
});
