import { mapColumnsBySynonyms } from '@common/ai-ingest/sheets/column-mapper';
import {
  detectSheetPlans,
  membersIngestProfile,
  normalizeMemberRow,
  parseMoney,
  parsePeriodDays,
  parseSheetDate,
  splitDocument,
  splitFullName,
} from './member-ingest.profile';

describe('member-ingest profile', () => {
  it('splits full names with the Colombian convention (two surnames at the end)', () => {
    expect(splitFullName('Juan Carlos Pérez Gómez')).toEqual({ first: 'Juan Carlos', last: 'Pérez Gómez' });
    expect(splitFullName('Ana López Ruiz')).toEqual({ first: 'Ana', last: 'López Ruiz' });
    expect(splitFullName('Ana López')).toEqual({ first: 'Ana', last: 'López' });
    expect(splitFullName('Pérez Gómez, Juan')).toEqual({ first: 'Juan', last: 'Pérez Gómez' });
    expect(splitFullName('Madonna')).toEqual({ first: 'Madonna', last: null });
  });

  it('reads documents with the type written in words or initials', () => {
    expect(splitDocument('C.C. 1.020.304.050')).toEqual({ type: 'CC', number: '1020304050' });
    expect(splitDocument('Pasaporte AB123456')).toEqual({ type: 'PA', number: 'AB123456' });
    expect(splitDocument('52.123.456')).toEqual({ type: null, number: '52123456' });
    expect(splitDocument('AB123456')).toEqual({ type: null, number: 'AB123456' });
  });

  it('dates: day first, Excel serials, Spanish month names and no-year as 0000', () => {
    expect(parseSheetDate('2026-07-01')).toBe('2026-07-01');
    expect(parseSheetDate('01/07/2026')).toBe('2026-07-01');
    expect(parseSheetDate('1-7-26')).toBe('2026-07-01');
    expect(parseSheetDate('4 de julio')).toBe('0000-07-04');
    expect(parseSheetDate('04/07')).toBe('0000-07-04');
    expect(parseSheetDate('15 ene 2026')).toBe('2026-01-15');
    expect(parseSheetDate('46204')).toBe('2026-07-01');
    expect(parseSheetDate('31/02/2026')).toBeNull();
    expect(parseSheetDate('mañana')).toBeNull();
  });

  it('money and periods', () => {
    expect(parseMoney('$ 80.000')).toBe(80000);
    expect(parseMoney('120,000.50')).toBe(120000.5);
    expect(parseMoney('95.000,25')).toBe(95000.25);
    expect(parseMoney('gratis')).toBeNull();
    expect(parsePeriodDays('Mensual')).toBe(30);
    expect(parsePeriodDays('Trimestral')).toBe(90);
    expect(parsePeriodDays('3 meses')).toBe(90);
    expect(parsePeriodDays('45 días')).toBe(45);
    expect(parsePeriodDays('Anual')).toBe(365);
  });

  it('maps usual roster headers by synonyms (emergency phone is not the member phone)', () => {
    const mapping = mapColumnsBySynonyms(
      ['Nombres', 'Apellidos', 'Cédula', 'Celular', 'Teléfono de emergencia', 'Membresía', 'Vence'],
      membersIngestProfile.columnSynonyms,
    );
    expect(Object.fromEntries(mapping)).toEqual({
      Nombres: 'first_name',
      Apellidos: 'last_name',
      'Cédula': 'document_number',
      Celular: 'phone',
      'Teléfono de emergencia': 'emergency_contact_phone',
      'Membresía': 'plan_name',
      Vence: 'membership_end_date',
    });
  });

  it('a row keeps its source row; bad values become warnings, never a failed commit', () => {
    const { record, issues } = normalizeMemberRow(
      {
        full_name: 'Ana López',
        email: 'ana@@x',
        date_of_birth: '12/05',
        height_cm: '1,62',
        weight_kg: 'mucho',
        plan_name: 'Mensual',
      },
      { row: 9, sheet: 'Sede Norte' },
    );
    expect(record?.member).toMatchObject({
      first_name: 'Ana',
      last_name: 'López',
      email: null,
      date_of_birth: null,
      height_cm: 162,
      weight_kg: null,
      source_row: 9,
      source_sheet: 'Sede Norte',
    });
    expect(issues.map((i) => i.field)).toEqual(['email', 'date_of_birth', 'weight_kg']);
    expect(issues.every((i) => i.row === 9 && i.sheet === 'Sede Norte')).toBe(true);

    const empty = normalizeMemberRow({ email: 'x@y.co' }, { row: 3 });
    expect(empty.record).toBeUndefined();
    expect(empty.skipMessage).toBe('Fila sin nombre ni documento.');
  });

  it('detects each plan once, accent and case insensitive', () => {
    const rows = ['Élite', 'elite', 'Mensual'].map((plan_name, i) =>
      normalizeMemberRow({ full_name: `Socio ${i}`, plan_name, plan_price: i === 1 ? '150000' : '' }, { row: i + 2 })
        .record!,
    );
    expect(detectSheetPlans(rows)).toEqual([
      expect.objectContaining({ name: 'Élite', price: 150000 }),
      expect.objectContaining({ name: 'Mensual', price: null }),
    ]);
  });
});
