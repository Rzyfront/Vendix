import {
  ageHours,
  buildSireRecord,
  isOverdue,
  isSireGuest,
  missingSireFields,
  overdueHours,
  splitSurnames,
} from './sire-record';

/** H4.2 — fields of the SIRE sheet and the "Atrasado" rule. */
describe('sire-record', () => {
  const source = {
    event: 'check_in' as const,
    moved_at: new Date('2026-11-10T03:30:00Z'), // 9 nov, 22:30 in Bogotá
    time_zone: 'America/Bogota',
    guest: {
      document_type: 'PA',
      document_number: ' X1234567 ',
      first_name: 'John',
      last_name: 'Smith Doe Jr',
      nationality_country_code: 'US',
      birth_date: new Date('1990-05-04T00:00:00Z'),
      residence_city: 'Miami',
      origin_city: 'Bogotá',
    },
    room_code: '201',
  };

  it('builds the sheet in the order and words of the SIRE form', () => {
    expect(buildSireRecord(source)).toEqual({
      tipo_movimiento: 'Entrada',
      fecha_movimiento: '09/11/2026',
      tipo_documento: 'Pasaporte',
      numero_documento: 'X1234567',
      nacionalidad: 'Estados Unidos',
      primer_apellido: 'Smith',
      segundo_apellido: 'Doe Jr',
      nombres: 'John',
      fecha_nacimiento: '04/05/1990',
      procedencia: 'Bogotá',
      residencia: 'Miami',
      habitacion: '201',
    });
  });

  it('names a check-out "Salida" and lists the missing fields', () => {
    const record = buildSireRecord({
      ...source,
      event: 'check_out',
      guest: { ...source.guest, birth_date: null, origin_city: ' ' },
    });
    expect(record.tipo_movimiento).toBe('Salida');
    expect(missingSireFields(record)).toEqual(['fecha de nacimiento', 'procedencia']);
  });

  it('splits one surname without inventing a second one', () => {
    expect(splitSurnames('Smith')).toEqual({ first: 'Smith', second: '' });
  });

  it('reports only foreign guests', () => {
    expect(isSireGuest('US')).toBe(true);
    expect(isSireGuest('ve')).toBe(true);
    expect(isSireGuest('CO')).toBe(false);
    expect(isSireGuest('')).toBe(false);
  });

  it('marks a pending movement overdue only past the threshold', () => {
    const moved = new Date('2026-11-10T10:00:00Z');
    const after24 = new Date('2026-11-11T10:00:00Z');
    const after25 = new Date('2026-11-11T11:00:00Z');
    expect(isOverdue('pending', moved, after24, 24)).toBe(false);
    expect(isOverdue('pending', moved, after25, 24)).toBe(true);
    expect(isOverdue('manual', moved, after25, 24)).toBe(false);
    expect(isOverdue('pending', moved, after25, 48)).toBe(false);
    expect(ageHours(moved, after25)).toBe(25);
  });

  it('falls back to 24 h for an invalid threshold', () => {
    expect(overdueHours(12)).toBe(12);
    expect(overdueHours(undefined)).toBe(24);
    expect(overdueHours(0)).toBe(24);
    expect(overdueHours('abc')).toBe(24);
  });
});
