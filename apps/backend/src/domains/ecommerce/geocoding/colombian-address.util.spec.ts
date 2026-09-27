import {
  normalizeColombianAddress,
  parseFreeTextQuery,
  selectBestCandidate,
  viaTipoAxis,
  crossViaTipoLabel,
  GeocodeCandidate,
} from './colombian-address.util';

describe('normalizeColombianAddress', () => {
  it('parses a plain Calle DANE address', () => {
    const r = normalizeColombianAddress('Calle 14 # 26 - 13');
    expect(r.kind).toBe('dane');
    expect(r.viaTipo).toBe('Calle');
    expect(r.viaNum).toBe('14');
    expect(r.cruceNum).toBe('26');
    expect(r.placa).toBe('13');
    expect(r.isDaneFormat).toBe(true);
  });

  it('parses Carrera with a single-letter suffix', () => {
    const r = normalizeColombianAddress('Carrera 21 A # 13 - 03');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('21');
    expect(r.viaLetra).toBe('A');
    expect(r.cruceNum).toBe('13');
    expect(r.placa).toBe('03');
  });

  it('parses Carrera with an alphanumeric suffix (A1)', () => {
    const r = normalizeColombianAddress('Carrera 21 A1 # 13 - 03');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('21');
    expect(r.viaLetra).toBe('A1');
  });

  it('parses Calle with letter + bis (letter before bis)', () => {
    const r = normalizeColombianAddress('Calle 14 H bis # 26 - 13');
    expect(r.viaNum).toBe('14');
    expect(r.viaLetra).toBe('H');
    expect(r.viaBis).toBe('Bis');
  });

  it('parses Calle with bis + letter (bis before letter)', () => {
    const r = normalizeColombianAddress('Calle 100 Bis A # 15 - 20');
    expect(r.viaNum).toBe('100');
    expect(r.viaBis).toBe('Bis');
    expect(r.viaLetra).toBe('A');
  });

  it('parses Carrera with bis + alphanumeric letter', () => {
    const r = normalizeColombianAddress('Carrera 7 Bis A1 # 32 - 10');
    expect(r.viaNum).toBe('7');
    expect(r.viaBis).toBe('Bis');
    expect(r.viaLetra).toBe('A1');
  });

  it('parses Calle with cuadrante Sur', () => {
    const r = normalizeColombianAddress('Calle 170 Sur # 12 - 45');
    expect(r.viaNum).toBe('170');
    expect(r.viaCuadrante).toBe('Sur');
  });

  it('parses Carrera with cuadrante Este', () => {
    const r = normalizeColombianAddress('Carrera 7 Este # 32 - 10');
    expect(r.viaCuadrante).toBe('Este');
  });

  it('parses Calle with cuadrante Oeste', () => {
    const r = normalizeColombianAddress('Calle 5 Oeste # 24 - 12');
    expect(r.viaCuadrante).toBe('Oeste');
  });

  it('parses Diagonal', () => {
    const r = normalizeColombianAddress('Diagonal 45 # 28 - 14');
    expect(r.viaTipo).toBe('Diagonal');
    expect(r.viaNum).toBe('45');
  });

  it('parses Transversal', () => {
    const r = normalizeColombianAddress('Transversal 23 # 50 - 08');
    expect(r.viaTipo).toBe('Transversal');
  });

  it('parses Avenida Carrera (full words)', () => {
    const r = normalizeColombianAddress('Avenida Carrera 68 # 20 - 11');
    expect(r.viaTipo).toBe('Avenida Carrera');
    expect(r.viaNum).toBe('68');
  });

  it('parses "Av. Calle 26 # 59 - 51" with explicit contract assertions', () => {
    const r = normalizeColombianAddress('Av. Calle 26 # 59 - 51');
    expect(r.viaTipo).toBe('Avenida Calle');
    expect(r.viaNum).toBe('26');
    expect(r.cruceNum).toBe('59');
    expect(r.placa).toBe('51');
  });

  it('parses AK abbreviation for Avenida Carrera', () => {
    const r = normalizeColombianAddress('AK 68 # 20-11');
    expect(r.viaTipo).toBe('Avenida Carrera');
    expect(r.viaNum).toBe('68');
    expect(r.cruceNum).toBe('20');
    expect(r.placa).toBe('11');
  });

  it('parses Circunvalar', () => {
    const r = normalizeColombianAddress('Circunvalar 3 # 12 - 40');
    expect(r.viaTipo).toBe('Circunvalar');
  });

  it('parses Circular', () => {
    const r = normalizeColombianAddress('Circular 4 # 71 - 23');
    expect(r.viaTipo).toBe('Circular');
  });

  it('extracts Torre/Apt complement from a comma segment', () => {
    const r = normalizeColombianAddress('Calle 140 # 11 - 45, Torre 2 Apt 501');
    expect(r.viaTipo).toBe('Calle');
    expect(r.viaNum).toBe('140');
    expect(r.complementos.torre).toBe('2');
    expect(r.complementos.apto).toBe('501');
  });

  it('extracts cuadrante on the cross number and Local complement', () => {
    const r = normalizeColombianAddress('Carrera 43A # 1 Sur - 100, Local 215');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('43');
    expect(r.viaLetra).toBe('A');
    expect(r.cruceNum).toBe('1');
    expect(r.cruceCuadrante).toBe('Sur');
    expect(r.placa).toBe('100');
    expect(r.complementos.local).toBe('215');
  });

  it('parses Barrio + Manzana + Casa as kind manzana', () => {
    const r = normalizeColombianAddress('Barrio El Prado, Manzana C Casa 12');
    expect(r.kind).toBe('manzana');
    expect(r.barrio).toBe('El Prado');
    expect(r.complementos.manzana).toBe('C');
    expect(r.complementos.casa).toBe('12');
  });

  it('parses Urbanización + Mz + Lote as kind manzana', () => {
    const r = normalizeColombianAddress('Urbanización Los Alcaravanes, Mz 4 Lote 8');
    expect(r.kind).toBe('manzana');
    expect(r.urbanizacion).toBe('Los Alcaravanes');
    expect(r.complementos.manzana).toBe('4');
    expect(r.complementos.lote).toBe('8');
  });

  it('parses Corregimiento + Sector + Casa as kind rural', () => {
    const r = normalizeColombianAddress('Corregimiento Pasacaballos, Sector La Plaza, Casa 4');
    expect(r.kind).toBe('rural');
    expect(r.rural?.corregimiento).toBe('Pasacaballos');
    expect(r.rural?.sector).toBe('La Plaza');
    expect(r.complementos.casa).toBe('4');
  });

  it('parses Km + Vía + Finca as kind rural', () => {
    const r = normalizeColombianAddress('Km 7 Vía Tunja - Paipa, Finca La Esperanza');
    expect(r.kind).toBe('rural');
    expect(r.rural?.km).toBe('7');
    expect(r.rural?.via).toBe('Tunja - Paipa');
    expect(r.rural?.finca).toBe('La Esperanza');
  });

  it('parses Vereda + Sector + Predio as kind rural', () => {
    const r = normalizeColombianAddress('Vereda El Hato, Sector El Amparo, Predio San José');
    expect(r.kind).toBe('rural');
    expect(r.rural?.vereda).toBe('El Hato');
    expect(r.rural?.sector).toBe('El Amparo');
    expect(r.rural?.finca).toBe('San José');
  });

  it('parses a No.-separated plate range, using the start', () => {
    const r = normalizeColombianAddress('Calle 53 No. 13-02 al 13-20');
    expect(r.viaTipo).toBe('Calle');
    expect(r.viaNum).toBe('53');
    expect(r.cruceNum).toBe('13');
    expect(r.placa).toBe('02');
    expect(r.placaRangoFin).toBe('20');
  });

  it('parses a legacy parenthesised via name', () => {
    const r = normalizeColombianAddress('Avenida del Ferrocarril (Carrera 15) # 22 - 04');
    expect(r.legacyName).toBe('Avenida del Ferrocarril');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('15');
    expect(r.cruceNum).toBe('22');
    expect(r.placa).toBe('04');
  });

  it('parses "Calle 15 con carrera 26 - 10" with explicit contract assertions', () => {
    const r = normalizeColombianAddress('Calle 15 con carrera 26 - 10');
    expect(r.kind).toBe('interseccion');
    expect(r.viaTipo).toBe('Calle');
    expect(r.viaNum).toBe('15');
    expect(r.cruceTipo).toBe('Carrera');
    expect(r.cruceNum).toBe('26');
    expect(r.placa).toBe('10');
  });

  it('parses "Cl 15 y Kr 26" as an intersection without a plate', () => {
    const r = normalizeColombianAddress('Cl 15 y Kr 26');
    expect(r.kind).toBe('interseccion');
    expect(r.viaTipo).toBe('Calle');
    expect(r.cruceTipo).toBe('Carrera');
    expect(r.cruceNum).toBe('26');
    expect(r.placa).toBeNull();
  });

  it('parses a DANE address with no separator at all', () => {
    const r = normalizeColombianAddress('Calle 14 26-13');
    expect(r.kind).toBe('dane');
    expect(r.viaNum).toBe('14');
    expect(r.cruceNum).toBe('26');
    expect(r.placa).toBe('13');
  });

  it('parses a trailing cuadrante on the plate without swallowing it', () => {
    const r = normalizeColombianAddress('CL 45 # 12 - 30 Sur');
    expect(r.viaTipo).toBe('Calle');
    expect(r.cruceNum).toBe('12');
    expect(r.placa).toBe('30');
    expect(r.placaCuadrante).toBe('Sur');
  });

  it('parses "Cra. 13 N° 62-40"', () => {
    const r = normalizeColombianAddress('Cra. 13 N° 62-40');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('13');
    expect(r.cruceNum).toBe('62');
    expect(r.placa).toBe('40');
  });

  it('parses "kr 13 nro 62 40" (space instead of dash)', () => {
    const r = normalizeColombianAddress('kr 13 nro 62 40');
    expect(r.viaTipo).toBe('Carrera');
    expect(r.viaNum).toBe('13');
    expect(r.cruceNum).toBe('62');
    expect(r.placa).toBe('40');
  });

  it('parses "Av Cra 15 # 100-20" abbreviation variant', () => {
    const r = normalizeColombianAddress('Av Cra 15 # 100-20');
    expect(r.viaTipo).toBe('Avenida Carrera');
    expect(r.viaNum).toBe('15');
  });

  it('parses "Av Cl 15 # 100-20" abbreviation variant', () => {
    const r = normalizeColombianAddress('Av Cl 15 # 100-20');
    expect(r.viaTipo).toBe('Avenida Calle');
  });

  it('parses "Diag 45 # 28-14" abbreviation', () => {
    const r = normalizeColombianAddress('Diag 45 # 28-14');
    expect(r.viaTipo).toBe('Diagonal');
  });

  it('parses "Tv 23 # 50-08" abbreviation', () => {
    const r = normalizeColombianAddress('Tv 23 # 50-08');
    expect(r.viaTipo).toBe('Transversal');
  });

  it('parses "Autopista Norte # 108-27" (via type with no cross/plate marker text tail)', () => {
    const r = normalizeColombianAddress('Autopista Norte # 108-27');
    expect(r.viaTipo).toBe('Autopista');
    expect(r.cruceNum).toBe('108');
    expect(r.placa).toBe('27');
  });

  it('regression: "Torres" survives complement stripping', () => {
    const r = normalizeColombianAddress('Calle 100 # 15-20, Torres del Parque');
    expect(r.complement).toContain('Torres del Parque');
    expect(r.complementos.torre).toBeUndefined();
  });

  it('regression: "Edgar" survives complement stripping', () => {
    const r = normalizeColombianAddress('Calle 100 # 15-20, Edificio Edgar');
    expect(r.complement).toContain('Edgar');
  });

  it('regression: "Blanco" survives complement stripping', () => {
    const r = normalizeColombianAddress('Calle 100 # 15-20, Casa Blanco');
    // "Casa" itself is a real complement keyword here, but "Blanco" must
    // never be truncated to "Bl" + "anco".
    expect(r.complement).toContain('Blanco');
  });

  it('regression: "Interamericana" survives complement stripping', () => {
    const r = normalizeColombianAddress('Autopista Interamericana # 15-20');
    expect(r.viaTipo).toBe('Autopista');
    expect(r.viaNum).toContain('Interamericana');
  });

  it('regression: "Casablanca" survives complement stripping', () => {
    const r = normalizeColombianAddress('Calle 100 # 15-20, Barrio Casablanca');
    expect(r.barrio).toBe('Casablanca');
  });

  it('parses "Kra 13 # 62-40" abbreviation', () => {
    const r = normalizeColombianAddress('Kra 13 # 62-40');
    expect(r.viaTipo).toBe('Carrera');
  });

  it('parses "Cll 45 # 12-30" abbreviation', () => {
    const r = normalizeColombianAddress('Cll 45 # 12-30');
    expect(r.viaTipo).toBe('Calle');
  });

  it('parses "Cr 45 # 12-30" abbreviation', () => {
    const r = normalizeColombianAddress('Cr 45 # 12-30');
    expect(r.viaTipo).toBe('Carrera');
  });

  it('parses "Dg 45 # 28-14" abbreviation', () => {
    const r = normalizeColombianAddress('Dg 45 # 28-14');
    expect(r.viaTipo).toBe('Diagonal');
  });

  it('parses "Tr 23 # 50-08" abbreviation', () => {
    const r = normalizeColombianAddress('Tr 23 # 50-08');
    expect(r.viaTipo).toBe('Transversal');
  });

  it('is accent/case-insensitive on via type', () => {
    const r = normalizeColombianAddress('CARRERA 15 # 20-30');
    expect(r.viaTipo).toBe('Carrera');
  });

  it('falls back to kind libre and never throws for garbage input', () => {
    const r = normalizeColombianAddress('   ');
    expect(r.kind).toBe('libre');
    expect(r.viaTipo).toBeNull();
    expect(() => normalizeColombianAddress('')).not.toThrow();
  });

  it('parses "Número" spelled out as a separator', () => {
    const r = normalizeColombianAddress('Calle 45 Número 12-30');
    expect(r.cruceNum).toBe('12');
    expect(r.placa).toBe('30');
  });
});

describe('parseFreeTextQuery', () => {
  it('splits address/city/state and drops trailing Colombia', () => {
    const r = parseFreeTextQuery('Cra 13 # 62-40, Bogotá, Bogotá D.C., Colombia');
    expect(r.addressLine).toBe('Cra 13 # 62-40');
    expect(r.city).toBe('Bogotá');
    expect(r.state).toBe('Bogotá D.C.');
  });

  it('handles a bare address with no city/state', () => {
    const r = parseFreeTextQuery('Cra 13 # 62-40');
    expect(r.addressLine).toBe('Cra 13 # 62-40');
    expect(r.city).toBeNull();
  });
});

describe('viaTipoAxis / crossViaTipoLabel', () => {
  it('resolves calle/carrera axes and their cross label', () => {
    expect(viaTipoAxis('Calle')).toBe('calle');
    expect(viaTipoAxis('Carrera')).toBe('carrera');
    expect(crossViaTipoLabel('Calle')).toBe('Carrera');
    expect(crossViaTipoLabel('Carrera')).toBe('Calle');
    expect(viaTipoAxis('Avenida')).toBeNull();
    expect(viaTipoAxis('Circular')).toBeNull();
  });
});

describe('selectBestCandidate', () => {
  function candidate(overrides: Partial<GeocodeCandidate>): GeocodeCandidate {
    return { lat: '4.6', lon: '-74.1', ...overrides };
  }

  it('discards city/admin-only candidates', () => {
    const candidates = [candidate({ addresstype: 'city', address: { city: 'Bogotá' } })];
    expect(selectBestCandidate(candidates)).toBeNull();
  });

  it('prefers exact over street over area', () => {
    const candidates = [
      candidate({ addresstype: 'suburb' }),
      candidate({ addresstype: 'road' }),
      candidate({ addresstype: 'house', address: { house_number: '10' } }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.precision).toBe('exact');
  });

  it('tie-breaks same-rank candidates by importance', () => {
    const candidates = [
      candidate({ addresstype: 'road', importance: 0.2 }),
      candidate({ addresstype: 'road', importance: 0.8, lat: '4.7' }),
    ];
    const best = selectBestCandidate(candidates);
    expect(best?.candidate.lat).toBe('4.7');
  });
});
