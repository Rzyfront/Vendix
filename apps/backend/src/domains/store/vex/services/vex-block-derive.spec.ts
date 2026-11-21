import {
  VexBlockDeriveError,
  applyCompare,
  applyDerive,
  applyJoin,
  normalizeColumnName,
} from './vex-block-derive';
import {
  computeGrowth,
  round2,
} from '../../analytics/analytics-metrics.contract';

describe('applyDerive', () => {
  it('añade columnas derivadas por fila y encadena', () => {
    const out = applyDerive(
      [{ Ventas: 200, costo: '150', nombre: 'A' }],
      [
        { name: 'margen', expression: 'margin(ventas, costo)' },
        { name: 'doble', expression: 'margen * 2' },
      ],
    );
    expect(out[0]).toMatchObject({ margen: '25', doble: '50', nombre: 'A' });
  });

  it('normaliza nombres de columna a snake_case ASCII', () => {
    expect(normalizeColumnName('Ventas del Mes')).toBe('ventas_del_mes');
    expect(normalizeColumnName('Cantidad Ñandú')).toBe('cantidad_nandu');
    const out = applyDerive(
      [{ 'Ventas Mes': 10 }],
      [{ name: 'x', expression: 'ventas_mes + 1' }],
    );
    expect(out[0].x).toBe('11');
  });

  it('división por cero da null en la fila', () => {
    const out = applyDerive(
      [{ a: 1, b: 0 }],
      [{ name: 'r', expression: 'a / b' }],
    );
    expect(out[0].r).toBeNull();
  });

  it('máximo 10 columnas y errores tipados', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      name: `c${i}`,
      expression: '1',
    }));
    expect(() => applyDerive([{ a: 1 }], many)).toThrow(VexBlockDeriveError);
    expect(() =>
      applyDerive([{ a: 1 }], [{ name: 'x', expression: 'zz' }]),
    ).toThrow(/Variable desconocida/);
  });
});

describe('applyCompare', () => {
  const rows = [
    { prod: 'A', mes: '2026-10', v: 150 },
    { prod: 'A', mes: '2026-09', v: 100 },
    { prod: 'B', mes: '2026-10', v: 30 },
    { prod: 'B', mes: '2026-09', v: 0 },
    { prod: 'C', mes: '2026-10', v: 5 },
  ];
  const spec = {
    key: 'prod',
    period_field: 'mes',
    current: '2026-10',
    previous: '2026-09',
    value_field: 'v',
  };

  it('una fila por key con current, previous, delta y pct_change', () => {
    const out = applyCompare(rows, spec);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      prod: 'A',
      current: '150',
      previous: '100',
      delta: '50',
      pct_change: '50',
    });
    expect(Number(out[0].pct_change)).toBe(round2(computeGrowth(150, 100)!));
  });

  it('pct_change null si la base es 0 o falta', () => {
    const out = applyCompare(rows, spec);
    expect(out[1].pct_change).toBeNull();
    expect(out[2]).toMatchObject({
      current: '5',
      previous: null,
      delta: null,
      pct_change: null,
    });
  });
});

describe('applyJoin', () => {
  const left = [
    { id: 1, n: 'a' },
    { id: 2, n: 'b' },
  ];
  const right = [{ pid: 1, n: 'x', z: 9 }];

  it('inner une y prefija columnas en conflicto', () => {
    expect(applyJoin(left, right, { on: 'id', right_on: 'pid' })).toEqual([
      { id: 1, n: 'a', pid: 1, right_n: 'x', z: 9 },
    ]);
  });

  it('left conserva filas sin pareja con nulos; prefijo configurable', () => {
    const out = applyJoin(left, right, {
      on: 'id',
      right_on: 'pid',
      type: 'left',
      right_prefix: 'r_',
    });
    expect(out).toHaveLength(2);
    expect(out[0].r_n).toBe('x');
    expect(out[1]).toMatchObject({ id: 2, z: null, r_n: null });
  });

  it('lanza error tipado sobre 5000 filas', () => {
    const big = Array.from({ length: 3000 }, (_, i) => ({ id: 1, i }));
    expect(() => applyJoin(big, [{ id: 1 }, { id: 1 }], { on: 'id' })).toThrow(
      VexBlockDeriveError,
    );
  });
});

describe('magnitud acotada en celdas (sin DoS por exponente)', () => {
  it('derive rechaza una celda con exponente cuando la expresión la usa', () => {
    const started = Date.now();
    expect(() =>
      applyDerive(
        [{ a: '1e20000000', b: 2 }],
        [{ name: 'x', expression: 'a * 2' }],
      ),
    ).toThrow(VexBlockDeriveError);
    expect(() =>
      applyDerive([{ a: 1e300 }], [{ name: 'x', expression: 'a * 2' }]),
    ).toThrow(/no es un decimal admitido/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('derive ignora una celda con exponente que la expresión no usa', () => {
    const out = applyDerive(
      [{ a: '1e20000000', b: 2 }],
      [{ name: 'x', expression: 'b * 2' }],
    );
    expect(out[0].x).toBe('4');
  });

  it('derive da null, no Infinity, cuando una fila se desborda', () => {
    const big = Number('9'.repeat(15));
    const out = applyDerive(
      [{ a: big }],
      [{ name: 'x', expression: 'a * a * a' }],
    );
    expect(out[0].x).toBeNull();
  });

  it('compare rechaza una celda con exponente en value_field', () => {
    const started = Date.now();
    expect(() =>
      applyCompare(
        [
          { prod: 'A', mes: '2026-10', v: '1e20000000' },
          { prod: 'A', mes: '2026-09', v: 100 },
        ],
        {
          key: 'prod',
          period_field: 'mes',
          current: '2026-10',
          previous: '2026-09',
          value_field: 'v',
        },
      ),
    ).toThrow(/celda "v" de la fila 1/);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('compare mantiene salidas cortas con valores al límite del rango', () => {
    const out = applyCompare(
      [
        { prod: 'A', mes: '2026-10', v: '9'.repeat(30) },
        { prod: 'A', mes: '2026-09', v: `0.${'0'.repeat(25)}1` },
      ],
      {
        key: 'prod',
        period_field: 'mes',
        current: '2026-10',
        previous: '2026-09',
        value_field: 'v',
      },
    );
    for (const v of Object.values(out[0])) {
      expect(String(v).length).toBeLessThanOrEqual(128);
    }
  });
});
