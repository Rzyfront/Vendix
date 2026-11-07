import {
  MissingTokenError,
  TokenScope,
  TokenSyntaxError,
  TokenValueError,
  buildTokenSchema,
  missingPaths,
  numberToSpanishWords,
  renderText,
} from './template-tokens';

const scope = (values: Record<string, unknown>, row?: Record<string, unknown>): TokenScope => ({
  values,
  timezone: 'America/Bogota',
  currency: 'COP',
  row,
});

describe('template tokens', () => {
  it('replaces a path and keeps the literal text around it', () => {
    expect(renderText('Hola {{ fields.nombre }}, bienvenida.', scope({ 'fields.nombre': 'Ana' }))).toBe(
      'Hola Ana, bienvenida.',
    );
  });

  it('walks into an object value by prefix', () => {
    expect(renderText('{{fields.cliente.ciudad}}', scope({ 'fields.cliente': { ciudad: 'Cali' } }))).toBe('Cali');
  });

  it('formats money in Colombian pesos without ICU dependence', () => {
    expect(renderText('{{ fields.salario | money }}', scope({ 'fields.salario': 2500000 }))).toBe('$2.500.000');
    expect(renderText('{{ fields.v | money }}', scope({ 'fields.v': '1234.5' }))).toBe('$1.234,5');
  });

  it('writes numbers in Spanish words', () => {
    const w = (n: number) => numberToSpanishWords('x', n);
    expect(w(2500000)).toBe('dos millones quinientos mil');
    expect(w(0)).toBe('cero');
    expect(w(21)).toBe('veintiuno');
    expect(w(21000)).toBe('veintiún mil');
    expect(w(1000000)).toBe('un millón');
    expect(w(101)).toBe('ciento uno');
    expect(w(100)).toBe('cien');
    expect(w(1350000)).toBe('un millón trescientos cincuenta mil');
    expect(w(45)).toBe('cuarenta y cinco');
    expect(w(1250.5)).toBe('mil doscientos cincuenta con 50/100');
    expect(renderText('{{ fields.s | words }}', scope({ 'fields.s': '2500000' }))).toBe(
      'dos millones quinientos mil',
    );
  });

  it("formats dates short and 'largo' in the store time zone", () => {
    // 2026-11-08 02:30 UTC is still 7 November in Bogota (UTC-5).
    const s = scope({ now: '2026-11-08T02:30:00.000Z', 'fields.inicio': '2026-03-01' });
    expect(renderText("{{ now | date:'largo' }}", s)).toBe('7 de noviembre de 2026');
    expect(renderText('{{ now | date }}', s)).toBe('07/11/2026');
    expect(renderText("{{ fields.inicio | date:'largo' }}", s)).toBe('1 de marzo de 2026');
  });

  it('upper, lower and number filters chain', () => {
    const s = scope({ 'fields.n': 'Ana María', 'fields.q': 1234567.891 });
    expect(renderText('{{ fields.n | upper }} {{ fields.n | lower }}', s)).toBe('ANA MARÍA ana maría');
    expect(renderText('{{ fields.q | number }}', s)).toBe('1.234.567,89');
  });

  it('default only fills a missing value', () => {
    expect(renderText("{{ fields.x | default:'—' }}", scope({}))).toBe('—');
    expect(renderText("{{ fields.x | default:'—' }}", scope({ 'fields.x': 'ok' }))).toBe('ok');
    expect(renderText("{{ fields.x | default:'—' }}", scope({ 'fields.x': 0 }))).toBe('0');
  });

  it('a missing required token throws instead of leaving a gap', () => {
    expect(() => renderText('{{ fields.salario | money }}', scope({}))).toThrow(MissingTokenError);
  });

  it('a value the filter cannot format is reported', () => {
    expect(() => renderText('{{ fields.s | money }}', scope({ 'fields.s': 'abc' }))).toThrow(TokenValueError);
  });

  it('resolves row.* from the table row', () => {
    expect(renderText('{{ row.name }}', scope({}, { name: 'Tornillo' }))).toBe('Tornillo');
  });

  it('never interprets markup or braces inside values', () => {
    expect(renderText('{{ fields.a }}', scope({ 'fields.a': '<b>{{ x }}</b>' }))).toBe('<b>{{ x }}</b>');
  });

  it.each([
    ['{{ nope.x }}', 'origen'],
    ['{{ fields.x | evil }}', 'filtro'],
    ['{{ fields.x', 'sin cerrar'],
    ["{{ fields.x | default:'a }}", 'Comilla'],
    ['{{ fields..x }}', 'no es válida'],
    ['{{ constructor.x }}', 'origen'],
  ])('rejects %s', (text, hint) => {
    expect(() => renderText(text, scope({}))).toThrow(TokenSyntaxError);
    expect(() => renderText(text, scope({}))).toThrow(new RegExp(hint));
  });

  it('builds the schema: required unless defaulted, row.* excluded, deduplicated', () => {
    const schema = buildTokenSchema([
      '{{ fields.a }} {{ fields.a | upper }}',
      "{{ fields.b | default:'-' }} {{ row.x }}",
      "{{ fields.c | default:'-' }} {{ fields.c }}",
    ]);
    expect(schema).toEqual([
      { path: 'fields.a', required: true },
      { path: 'fields.b', required: false },
      { path: 'fields.c', required: true },
    ]);
  });

  it('lists the required paths with no value', () => {
    const schema = buildTokenSchema(['{{ fields.a }}', "{{ fields.b | default:'-' }}", '{{ fields.c }}']);
    expect(missingPaths(schema, scope({ 'fields.a': 'x' }))).toEqual(['fields.c']);
  });
});
