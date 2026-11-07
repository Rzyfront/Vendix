import {
  addColombianBusinessDays,
  applyComputedFields,
  colombianHolidays,
  computeWaitUntil,
  cronMatches,
  describeCron,
  evaluateExpression,
  parseCron,
  parseExpression,
  validateFormValues,
  zonedParts,
  WorkflowDefinitionV1,
} from './index';

describe('P2.9 expressions — closed grammar, no code', () => {
  const ev = (src: string, data: Record<string, unknown> = {}) =>
    evaluateExpression(src, data, { today: '2026-11-07' });

  it('arithmetic with precedence, parentheses and rounding', () => {
    expect(ev('round(subtotal * 1.19, 2)', { subtotal: 1000.5 })).toBe(1190.6);
    expect(ev('2 + 3 * 4')).toBe(14);
    expect(ev('(2 + 3) * 4')).toBe(20);
    expect(ev('-a + 10 % 4', { a: 1 })).toBe(1);
    expect(ev('0.1 + 0.2')).toBe(0.3);
  });

  it('text, comparisons, booleans and if()', () => {
    expect(ev('concat(upper(nombre), " - ", len(nombre))', { nombre: 'ana' })).toBe('ANA - 3');
    expect(ev('"N° " + ref', { ref: 'FLU-1' })).toBe('N° FLU-1');
    expect(ev('if(monto > 1000000 && !urgente, "alto", "normal")', { monto: 2e6, urgente: false })).toBe('alto');
    expect(ev('coalesce(a, b, "x")', { a: null, b: '' })).toBe('x');
  });

  it('dates: today, add_days, add_months, days_between, parts', () => {
    expect(ev('add_days(today(), 3)')).toBe('2026-11-10');
    expect(ev('add_months("2026-01-31", 1)')).toBe('2026-02-28');
    expect(ev('days_between(a, b)', { a: '2026-11-01', b: '2026-11-08' })).toBe(7);
    expect(ev('year(f) * 100 + month(f)', { f: '2026-03-09' })).toBe(202603);
  });

  it('missing or bad values give null instead of throwing', () => {
    expect(ev('a / 0', { a: 1 })).toBeNull();
    expect(ev('x * 2')).toBeNull();
    expect(ev('add_days("no-es-fecha", 1)')).toBeNull();
  });

  it('rejects anything outside the grammar (no property access, no unknown functions)', () => {
    for (const bad of [
      'constructor.constructor("return 1")()',
      'eval("1")',
      'a; b',
      'a.b',
      'process',
      '(1 + 2',
      'round()',
      '`x`',
      'a = 1',
    ]) {
      const p = parseExpression(bad);
      if (p.ok) {
        // A bare identifier parses as a field reference and reads only data.
        expect(bad).toBe('process');
        expect(evaluateExpression(p.expr, {})).toBeNull();
      } else {
        expect(p.error).toEqual(expect.any(String));
      }
    }
  });

  it('caps length and nesting', () => {
    expect(parseExpression('1+'.repeat(300) + '1').ok).toBe(false);
    expect(parseExpression('('.repeat(40) + '1' + ')'.repeat(40)).ok).toBe(false);
  });

  it('applyComputedFields resolves chains in dependency order and coerces to the field type', () => {
    const def = {
      fields: [
        { key: 'total', type: 'money', label: 'Total', compute: 'iva + subtotal' },
        { key: 'iva', type: 'money', label: 'IVA', compute: 'subtotal * 0.19' },
        { key: 'subtotal', type: 'money', label: 'Subtotal' },
        { key: 'vence', type: 'date', label: 'Vence', compute: 'add_days(fecha, 30)' },
        { key: 'fecha', type: 'date', label: 'Fecha' },
      ],
    } as unknown as WorkflowDefinitionV1;
    expect(
      applyComputedFields(def, { subtotal: 100.555, fecha: '2026-11-01', total: 1 }),
    ).toEqual({
      subtotal: 100.555,
      fecha: '2026-11-01',
      iva: 19.11,
      total: 119.67,
      vence: '2026-12-01',
    });
  });

  it('validateFormValues ignores a computed field sent by the client', () => {
    const def = {
      fields: [
        { key: 'subtotal', type: 'money', label: 'Subtotal', required: true },
        { key: 'total', type: 'money', label: 'Total', compute: 'subtotal * 2', required: true },
      ],
      stages: [],
    } as unknown as WorkflowDefinitionV1;
    const stage = { key: 's', name: 'S', type: 'form', form: { fields: ['subtotal', 'total'] } } as never;
    const r = validateFormValues(def, stage, { subtotal: 10, total: 999 });
    expect(r).toEqual({ ok: true, errors: [], values: { subtotal: 10 } });
  });
});

describe('P2.10 cron', () => {
  it('parses lists, ranges, steps and names; rejects bad shapes', () => {
    const p = parseCron('*/15 8-10 * * mon-fri');
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.cron.minute).toEqual([0, 15, 30, 45]);
      expect(p.cron.hour).toEqual([8, 9, 10]);
      expect(p.cron.dow).toEqual([1, 2, 3, 4, 5]);
    }
    expect(parseCron('0 8 * *').ok).toBe(false);
    expect(parseCron('60 8 * * *').ok).toBe(false);
    expect(parseCron('0 8 * * 1/0').ok).toBe(false);
    expect(parseCron('0 8 * * 7').ok).toBe(true);
  });

  it('"Cada lunes 8 a. m." matches Monday 08:00 in the store time zone only', () => {
    const p = parseCron('0 8 * * 1');
    if (!p.ok) throw new Error(p.error);
    // 2026-11-09 is a Monday; 08:00 Bogotá = 13:00 UTC.
    expect(cronMatches(p.cron, zonedParts(new Date('2026-11-09T13:00:00Z'), 'America/Bogota'))).toBe(true);
    expect(cronMatches(p.cron, zonedParts(new Date('2026-11-09T08:00:00Z'), 'America/Bogota'))).toBe(false);
    expect(describeCron('0 8 * * 1')).toBe('Cada lunes a las 08:00 (hora de la tienda)');
  });

  it('day-of-month OR day-of-week when both are restricted', () => {
    const p = parseCron('0 0 1 * 5');
    if (!p.ok) throw new Error(p.error);
    const at = (iso: string) => cronMatches(p.cron, zonedParts(new Date(iso), 'UTC'));
    expect(at('2026-12-01T00:00:00Z')).toBe(true); // the 1st (Tuesday)
    expect(at('2026-12-04T00:00:00Z')).toBe(true); // a Friday
    expect(at('2026-12-02T00:00:00Z')).toBe(false);
  });
});

describe('P2.3 Colombian calendar and waits', () => {
  it('2026 holidays include Emiliani Mondays and Easter-based days', () => {
    const h = colombianHolidays(2026);
    for (const d of [
      '2026-01-01',
      '2026-01-12', // Reyes (6 Jan → Monday)
      '2026-03-23', // San José
      '2026-04-02', // Jueves Santo
      '2026-04-03', // Viernes Santo
      '2026-05-18', // Ascensión
      '2026-06-08', // Corpus Christi
      '2026-06-15', // Sagrado Corazón
      '2026-07-20',
      '2026-08-07',
      '2026-11-16', // Independencia de Cartagena
      '2026-12-08',
      '2026-12-25',
    ]) {
      expect(h.has(d)).toBe(true);
    }
    expect(h.has('2026-11-11')).toBe(false);
    expect(h.size).toBe(18);
  });

  it('business days skip weekends and holidays', () => {
    // Fri 2026-11-13 + 1 → Mon 16 is a holiday → Tue 17.
    expect(addColombianBusinessDays('2026-11-13', 1)).toBe('2026-11-17');
    expect(addColombianBusinessDays('2026-11-09', 3)).toBe('2026-11-12');
  });

  const now = new Date('2026-11-07T15:30:00Z'); // 10:30 in Bogotá, Saturday
  const tz = 'America/Bogota';

  it('duration, date, field (+3 days after the invoice) and business days', () => {
    expect(computeWaitUntil({ kind: 'duration', days: 3 }, { now, timeZone: tz, data: {} }).toISOString()).toBe(
      '2026-11-10T15:30:00.000Z',
    );
    expect(
      computeWaitUntil({ kind: 'date', date: '2026-12-01', time: '08:00' }, { now, timeZone: tz, data: {} }).toISOString(),
    ).toBe('2026-12-01T13:00:00.000Z');
    expect(
      computeWaitUntil(
        { kind: 'field', field: 'fecha_factura', offset_days: 3 },
        { now, timeZone: tz, data: { fecha_factura: '2026-11-07' } },
      ).toISOString(),
    ).toBe('2026-11-10T05:00:00.000Z');
    expect(
      computeWaitUntil({ kind: 'business_days', days: 1 }, { now, timeZone: tz, data: {} }).toISOString(),
    ).toBe('2026-11-09T15:30:00.000Z');
  });

  it('"hasta el día 5 del mes" picks the next 5th; past dates or empty fields resume now', () => {
    expect(
      computeWaitUntil({ kind: 'day_of_month', day: 5 }, { now, timeZone: tz, data: {} }).toISOString(),
    ).toBe('2026-12-05T05:00:00.000Z');
    expect(
      computeWaitUntil({ kind: 'day_of_month', day: 9 }, { now, timeZone: tz, data: {} }).toISOString(),
    ).toBe('2026-11-09T05:00:00.000Z');
    expect(computeWaitUntil({ kind: 'date', date: '2020-01-01' }, { now, timeZone: tz, data: {} })).toEqual(now);
    expect(computeWaitUntil({ kind: 'field', field: 'x' }, { now, timeZone: tz, data: {} })).toEqual(now);
  });
});
