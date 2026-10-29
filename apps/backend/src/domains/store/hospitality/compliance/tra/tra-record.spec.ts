import { TraSource, buildTraRecord, missingTraFields } from './tra-record';

/**
 * H4.1 — the TRA record carries the fields of Res. 409/2022 art. 7: provider
 * (RNT), unit (accommodation type, value paid, room number) and each guest or
 * companion (document, name, residence and origin cities, travel purpose,
 * check-in and check-out).
 */
function source(overrides: Partial<TraSource> = {}): TraSource {
  return {
    event: 'check_in',
    rnt_number: ' 12345 ',
    guest: {
      is_primary: true,
      document_type: 'CC',
      document_number: ' 1020304050 ',
      first_name: 'Ana ',
      last_name: 'Pérez',
      nationality_country_code: 'CO',
      residence_city: 'Medellín',
      origin_city: 'Bogotá',
      travel_purpose: 'business',
    },
    room: {
      unit_type_name: 'Doble',
      unit_code: '201',
      amount: '450000.50',
      arrival_date: new Date('2026-11-10T00:00:00Z'),
      departure_date: new Date('2026-11-13T00:00:00Z'),
    },
    ...overrides,
  };
}

describe('buildTraRecord (H4.1, Res. 409/2022 art. 7)', () => {
  it('lleva prestador, unidad y huésped con los campos del artículo 7', () => {
    expect(buildTraRecord(source())).toEqual({
      evento: 'check_in',
      prestador: { rnt: '12345' },
      unidad: { tipo_acomodacion: 'Doble', numero_habitacion: '201', valor_pagado: 450000.5 },
      huesped: {
        tipo_huesped: 'titular',
        tipo_documento: 'CC',
        numero_documento: '1020304050',
        nombres: 'Ana',
        apellidos: 'Pérez',
        nacionalidad: 'CO',
        ciudad_residencia: 'Medellín',
        ciudad_procedencia: 'Bogotá',
        motivo_viaje: 'Negocios y motivos profesionales',
        motivo_viaje_codigo: 'business',
        fecha_check_in: '2026-11-10',
        fecha_check_out: '2026-11-13',
      },
    });
  });

  it('un acompañante sale como acompañante y el check-out conserva las fechas de la estadía', () => {
    const record = buildTraRecord(
      source({ event: 'check_out', guest: { ...source().guest, is_primary: false } }),
    );
    expect(record.evento).toBe('check_out');
    expect(record.huesped.tipo_huesped).toBe('acompanante');
    expect(record.huesped.fecha_check_out).toBe('2026-11-13');
    expect(missingTraFields(record)).toEqual([]);
  });

  it('sin RNT ni habitación asignada nombra lo que falta en español, sin lanzar', () => {
    const record = buildTraRecord(source({ rnt_number: '', room: null }));
    expect(missingTraFields(record)).toEqual([
      'RNT del hotel',
      'número de habitación',
      'tipo de acomodación',
      'fechas de la estadía',
    ]);
  });
});
