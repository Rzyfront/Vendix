import { createComputeTools, COMPUTE_MAX_EXPRESSIONS } from './compute.tools';

const tool = createComputeTools()[0];
const run = async (args: Record<string, unknown>) =>
  JSON.parse(await tool.handler!(args, {}));

describe('compute tool', () => {
  it('es de solo lectura y pública', () => {
    expect(tool.name).toBe('compute');
    expect(tool.readOnly).toBe(true);
    expect(tool.access).toBe('public');
  });

  it('encadena resultados por name', async () => {
    const r = await run({
      variables: { ventas: 1200, anterior: 1000, costo: 900 },
      expressions: [
        { name: 'var', expression: 'pct_change(ventas, anterior)' },
        { name: 'mg', expression: 'margin(ventas, costo)' },
        { name: 'doble', expression: 'var * 2' },
      ],
    });
    expect(r.data.results).toEqual([
      { name: 'var', value: '20.00' },
      { name: 'mg', value: '25.00' },
      { name: 'doble', value: '40.00' },
    ]);
  });

  it('respeta decimals (por defecto 2)', async () => {
    const r = await run({
      decimals: 0,
      expressions: [{ name: 'a', expression: '10 / 3' }],
    });
    expect(r.data.results[0].value).toBe('3');
    const d = await run({ expressions: [{ name: 'a', expression: '10 / 3' }] });
    expect(d.data.results[0].value).toBe('3.33');
  });

  it('base 0 devuelve null con motivo, no un número', async () => {
    const r = await run({
      expressions: [{ name: 'v', expression: 'pct_change(5, 0)' }],
    });
    expect(r.data.results[0].value).toBeNull();
    expect(r.data.results[0].reason).toBeTruthy();
  });

  it('limita a 20 expresiones', async () => {
    const expressions = Array.from(
      { length: COMPUTE_MAX_EXPRESSIONS + 1 },
      (_, i) => ({
        name: `e${i}`,
        expression: '1',
      }),
    );
    const r = await run({ expressions });
    expect(r.error).toMatch(/Máximo 20/);
  });

  it('decimals fuera de rango, name repetido y sintaxis dan error con sugerencia', async () => {
    expect(
      (
        await run({
          decimals: 9,
          expressions: [{ name: 'a', expression: '1' }],
        })
      ).error,
    ).toMatch(/decimals/);
    expect(
      (
        await run({
          expressions: [
            { name: 'a', expression: '1' },
            { name: 'a', expression: '2' },
          ],
        })
      ).error,
    ).toMatch(/repetido/);
    const bad = await run({
      expressions: [{ name: 'a', expression: 'zz + 1' }],
    });
    expect(bad.error).toMatch(/Variable desconocida/);
    expect(bad.next_step ?? bad.nextStep).toBeTruthy();
  });

  it('rechaza inyección', async () => {
    const r = await run({
      expressions: [{ name: 'a', expression: 'process.exit()' }],
    });
    expect(r.error).toBeTruthy();
  });

  it('rechaza exponentes: ni DoS ni salida gigante', async () => {
    const started = Date.now();
    const literal = await run({
      expressions: [{ name: 'a', expression: '1e9999999' }],
    });
    expect(literal.error).toMatch(/Notación científica/);
    const variable = await run({
      variables: { x: '1e30000000' },
      expressions: [{ name: 'a', expression: 'x + 1' }],
    });
    expect(variable.error).toMatch(/fuera del rango/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('un resultado no finito es null con motivo y no se encadena como número', async () => {
    const big = '9'.repeat(30);
    const r = await run({
      expressions: [
        { name: 'a', expression: `${big} * ${big}` },
        { name: 'b', expression: `${big} * ${big} - ${big} * ${big}` },
      ],
    });
    expect(r.data.results[0].value).toBeNull();
    expect(r.data.results[0].reason).toMatch(/Fuera de rango/);
    expect(r.data.results[1].value).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/Infinity|NaN/);
  });

  it('20 expresiones al límite del rango devuelven una salida corta', async () => {
    const big = '9'.repeat(30);
    const out = await tool.handler!(
      {
        decimals: 6,
        expressions: Array.from({ length: COMPUTE_MAX_EXPRESSIONS }, (_, i) => ({
          name: `e${i}`,
          expression: `${big} / 7`,
        })),
      },
      {},
    );
    expect(out.length).toBeLessThan(4000);
  });
});
