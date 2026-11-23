import {
  buildCustomerEstablishmentRows,
  customerFromEstablishmentRow,
  establishmentSummary,
  hasEstablishmentRows,
  preferredEstablishment,
} from './customer-establishment-rows.util';

describe('customer-establishment-rows.util', () => {
  const sede = (id: number, label: string | null, is_primary = false) => ({
    id,
    label,
    address_line1: `Calle ${id}`,
    city: 'Bogotá',
    is_primary,
  });

  const acme = {
    id: 1,
    legal_name: 'ACME SAS',
    document_number: '900123456',
    addresses: [sede(10, 'Sede Norte', true), sede(11, 'Sede Sur'), sede(12, null)],
  };
  const juan = { id: 2, first_name: 'Juan', last_name: 'Pérez', addresses: [sede(20, 'Casa')] };
  const ana = { id: 3, first_name: 'Ana', addresses: [] };

  it('un cliente con 0 o 1 establecimiento queda en una sola línea sin establecimiento', () => {
    const rows = buildCustomerEstablishmentRows([juan, ana]);
    expect(rows.map((r) => r.key)).toEqual(['2', '3']);
    expect(rows.every((r) => r.establishment === null)).toBeTrue();
    expect(hasEstablishmentRows(rows)).toBeFalse();
  });

  it('un cliente con N establecimientos se divide en N líneas, en el orden del backend', () => {
    const rows = buildCustomerEstablishmentRows([acme, juan]);
    expect(rows.map((r) => r.key)).toEqual(['1-10', '1-11', '1-12', '2']);
    expect(rows[0].customer).toBe(acme);
    expect(rows[1].establishment?.label).toBe('Sede Sur');
    expect(hasEstablishmentRows(rows)).toBeTrue();
  });

  it('si la búsqueda coincide con el cliente se muestran todas sus sedes', () => {
    const rows = buildCustomerEstablishmentRows([acme], '9001234');
    expect(rows.length).toBe(3);
  });

  it('si la búsqueda solo coincide con una sede (sin tildes ni mayúsculas) deja esa línea', () => {
    const rows = buildCustomerEstablishmentRows([acme], 'sede sur');
    expect(rows.map((r) => r.key)).toEqual(['1-11']);
    const accent = buildCustomerEstablishmentRows(
      [{ ...acme, addresses: [sede(10, 'Bogotá Centro'), sede(11, 'Medellín')] }],
      'medellin',
    );
    expect(accent.map((r) => r.key)).toEqual(['1-11']);
  });

  it('si la búsqueda no coincide con nada local se muestran todas las sedes', () => {
    expect(buildCustomerEstablishmentRows([acme], 'zzz').length).toBe(3);
  });

  it('elegir una línea con sede adjunta preferred_address_id sin mutar el cliente', () => {
    const [north] = buildCustomerEstablishmentRows([acme]);
    const picked = customerFromEstablishmentRow(north);
    expect(picked.preferred_address_id).toBe(10);
    expect(picked.id).toBe(1);
    expect((acme as { preferred_address_id?: number }).preferred_address_id).toBeUndefined();

    const [single] = buildCustomerEstablishmentRows([juan]);
    expect(customerFromEstablishmentRow(single)).toBe(juan);
  });

  it('establishmentSummary arma "nombre · dirección, ciudad" y tolera sede sin nombre', () => {
    expect(establishmentSummary(sede(10, 'Sede Norte'))).toBe('Sede Norte · Calle 10, Bogotá');
    expect(establishmentSummary(sede(12, null))).toBe('Calle 12, Bogotá');
    expect(establishmentSummary(null)).toBe('');
  });

  it('preferredEstablishment resuelve la sede elegida solo si sigue en la lista', () => {
    expect(preferredEstablishment({ ...acme, preferred_address_id: 11 })?.label).toBe('Sede Sur');
    expect(preferredEstablishment({ ...acme, preferred_address_id: 99 })).toBeNull();
    expect(preferredEstablishment(acme)).toBeNull();
    expect(preferredEstablishment(null)).toBeNull();
  });
});
