import {
  normalizeColombianAddress,
  parseFreeTextQuery,
  selectBestCandidate,
  viaTipoAxis,
  crossViaTipoLabel,
  GeocodeCandidate,
} from './colombian-address.util';

describe('normalizeColombianAddress', () => {
  it('parses "Cra 13 # 62-40" (Carrera abbreviation)', () => {
    const result = normalizeColombianAddress('Cra 13 # 62-40');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Carrera');
    expect(result.viaNum).toBe('13');
    expect(result.cruceNum).toBe('62');
    expect(result.placa).toBe('40');
    expect(result.complement).toBeNull();
    expect(result.normalized).toBe('Carrera 13 # 62-40');
  });

  it('parses "Calle 45A Bis # 12-30 Apto 301" and strips the complement', () => {
    const result = normalizeColombianAddress('Calle 45A Bis # 12-30 Apto 301');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Calle');
    expect(result.viaNum).toBe('45A Bis');
    expect(result.cruceNum).toBe('12');
    expect(result.placa).toBe('30');
    expect(result.complement).toBe('Apto 301');
    expect(result.normalized).toBe('Calle 45A Bis # 12-30');
  });

  it('parses "Av. Boyacá # 64-20" (named avenue, Avenida abbreviation)', () => {
    const result = normalizeColombianAddress('Av. Boyacá # 64-20');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Avenida');
    expect(result.viaNum).toBe('Boyacá');
    expect(result.cruceNum).toBe('64');
    expect(result.placa).toBe('20');
    expect(result.normalized).toBe('Avenida Boyacá # 64-20');
  });

  it('parses "Dg 15 sur # 20-10" (Diagonal abbreviation + orientation)', () => {
    const result = normalizeColombianAddress('Dg 15 sur # 20-10');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Diagonal');
    expect(result.viaNum).toBe('15 Sur');
    expect(result.cruceNum).toBe('20');
    expect(result.placa).toBe('10');
    expect(result.normalized).toBe('Diagonal 15 Sur # 20-10');
  });

  it('parses "Tv 5 No. 3-12" (Transversal abbreviation, "No." separator)', () => {
    const result = normalizeColombianAddress('Tv 5 No. 3-12');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Transversal');
    expect(result.viaNum).toBe('5');
    expect(result.cruceNum).toBe('3');
    expect(result.placa).toBe('12');
    expect(result.normalized).toBe('Transversal 5 # 3-12');
  });

  it('parses "cl 80 #11-42" (lowercase Calle abbreviation, no space before #)', () => {
    const result = normalizeColombianAddress('cl 80 #11-42');
    expect(result.isDaneFormat).toBe(true);
    expect(result.viaTipo).toBe('Calle');
    expect(result.viaNum).toBe('80');
    expect(result.cruceNum).toBe('11');
    expect(result.placa).toBe('42');
    expect(result.normalized).toBe('Calle 80 # 11-42');
  });

  it('marks free text with no DANE structure as non-DANE', () => {
    const result = normalizeColombianAddress('texto sin formato DANE');
    expect(result.isDaneFormat).toBe(false);
    expect(result.viaTipo).toBeNull();
    expect(result.viaNum).toBeNull();
    expect(result.cruceNum).toBeNull();
    expect(result.placa).toBeNull();
    expect(result.normalized).toBe('texto sin formato DANE');
  });

  it('recognizes a via type with no house-number marker as non-DANE but expands it', () => {
    const result = normalizeColombianAddress('Cra 13');
    expect(result.isDaneFormat).toBe(false);
    expect(result.viaTipo).toBe('Carrera');
    expect(result.viaNum).toBe('13');
    expect(result.cruceNum).toBeNull();
    expect(result.placa).toBeNull();
    expect(result.normalized).toBe('Carrera 13');
  });

  it('does not treat "Diagonal"/"Norte" as the "No." separator', () => {
    // "Dg 15 Norte" must not have "No" from "Norte" swallowed as a separator.
    const result = normalizeColombianAddress('Dg 15 Norte # 20-10');
    expect(result.viaTipo).toBe('Diagonal');
    expect(result.viaNum).toBe('15 Norte');
    expect(result.cruceNum).toBe('20');
    expect(result.placa).toBe('10');
  });

  it('preserves the raw input untouched', () => {
    const raw = '  Cra   13   #   62-40  ';
    const result = normalizeColombianAddress(raw);
    expect(result.raw).toBe(raw);
    expect(result.normalized).toBe('Carrera 13 # 62-40');
  });
});

describe('parseFreeTextQuery', () => {
  it('splits "line, city, Colombia" and drops the trailing country segment', () => {
    const result = parseFreeTextQuery('Cra 13 # 62-40, Bogotá, Colombia');
    expect(result.addressLine).toBe('Cra 13 # 62-40');
    expect(result.city).toBe('Bogotá');
    expect(result.state).toBeNull();
  });

  it('splits "line, city, state, Colombia" into all three parts', () => {
    const result = parseFreeTextQuery(
      'Cra 13 # 62-40, Bogotá, Cundinamarca, Colombia',
    );
    expect(result.addressLine).toBe('Cra 13 # 62-40');
    expect(result.city).toBe('Bogotá');
    expect(result.state).toBe('Cundinamarca');
  });

  it('keeps the line as-is when there are no commas', () => {
    const result = parseFreeTextQuery('Cra 13 # 62-40');
    expect(result.addressLine).toBe('Cra 13 # 62-40');
    expect(result.city).toBeNull();
    expect(result.state).toBeNull();
  });
});

describe('viaTipoAxis / crossViaTipoLabel', () => {
  it('maps Calle/Diagonal to the calle axis and their cross to Carrera', () => {
    expect(viaTipoAxis('Calle')).toBe('calle');
    expect(viaTipoAxis('Diagonal')).toBe('calle');
    expect(crossViaTipoLabel('Calle')).toBe('Carrera');
    expect(crossViaTipoLabel('Diagonal')).toBe('Carrera');
  });

  it('maps Carrera/Transversal to the carrera axis and their cross to Calle', () => {
    expect(viaTipoAxis('Carrera')).toBe('carrera');
    expect(viaTipoAxis('Transversal')).toBe('carrera');
    expect(crossViaTipoLabel('Carrera')).toBe('Calle');
    expect(crossViaTipoLabel('Transversal')).toBe('Calle');
  });

  it('treats a bare Avenida as ambiguous (no cross axis)', () => {
    expect(viaTipoAxis('Avenida')).toBeNull();
    expect(crossViaTipoLabel('Avenida')).toBeNull();
  });
});

describe('selectBestCandidate', () => {
  const admin: GeocodeCandidate = {
    lat: '4.6097',
    lon: '-74.0817',
    addresstype: 'city',
    type: 'administrative',
    address: { city: 'Bogotá' },
  };
  const street: GeocodeCandidate = {
    lat: '4.65',
    lon: '-74.05',
    addresstype: 'road',
    type: 'residential',
    address: { road: 'Carrera 13', city: 'Bogotá' },
  };
  const exact: GeocodeCandidate = {
    lat: '4.651',
    lon: '-74.051',
    addresstype: 'house',
    address: { road: 'Carrera 13', house_number: '62-40', city: 'Bogotá' },
  };
  const area: GeocodeCandidate = {
    lat: '4.66',
    lon: '-74.06',
    addresstype: 'suburb',
    address: { suburb: 'Chapinero', city: 'Bogotá' },
  };

  it('discards a city/administrative-only candidate outright', () => {
    const best = selectBestCandidate([admin]);
    expect(best).toBeNull();
  });

  it('prefers an exact (house-numbered) candidate over a street or area one', () => {
    const best = selectBestCandidate([area, street, exact, admin]);
    expect(best).not.toBeNull();
    expect(best?.precision).toBe('exact');
    expect(best?.candidate).toBe(exact);
  });

  it('prefers a street candidate over an area (barrio) candidate', () => {
    const best = selectBestCandidate([area, street, admin]);
    expect(best?.precision).toBe('street');
    expect(best?.candidate).toBe(street);
  });

  it('falls back to an area (barrio) candidate as a last resort', () => {
    const best = selectBestCandidate([area, admin]);
    expect(best?.precision).toBe('area');
    expect(best?.candidate).toBe(area);
  });

  it('returns null when every candidate is administrative', () => {
    const best = selectBestCandidate([admin]);
    expect(best).toBeNull();
  });

  it('returns null for an empty candidate list', () => {
    expect(selectBestCandidate([])).toBeNull();
  });

  it('breaks ties within the same precision by matching the wanted city', () => {
    const streetOtherCity: GeocodeCandidate = {
      ...street,
      address: { road: 'Carrera 13', city: 'Medellín' },
    };
    const streetWantedCity: GeocodeCandidate = {
      ...street,
      lat: '4.70',
      lon: '-74.07',
      address: { road: 'Carrera 13', city: 'Bogotá' },
    };
    const best = selectBestCandidate(
      [streetOtherCity, streetWantedCity],
      'Bogotá',
    );
    expect(best?.candidate).toBe(streetWantedCity);
  });

  it('ignores candidates with missing/invalid coordinates', () => {
    const broken: GeocodeCandidate = {
      lat: '',
      lon: '',
      addresstype: 'road',
    };
    const best = selectBestCandidate([broken, street]);
    expect(best?.candidate).toBe(street);
  });
});
