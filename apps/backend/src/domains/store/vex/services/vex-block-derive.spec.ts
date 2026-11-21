import {
  VexBlockDeriveError,
  applyAggregate,
  applyCompare,
  applyDerive,
  applyFilters,
  applyJoin,
  applySort,
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

describe('filter / sort / aggregate sobre decimales en texto', () => {
  const rows = [
    { cat: 'a', margen: '9' },
    { cat: 'b', margen: '45.2' },
    { cat: 'c', margen: '100' },
    { cat: 'd', margen: null },
  ];

  it('ordena numéricamente, con nulos al final en ambos sentidos', () => {
    const desc = applySort(rows, [{ field: 'margen', direction: 'desc' }]);
    expect(desc.map((r) => r.margen)).toEqual(['100', '45.2', '9', null]);
    const asc = applySort(rows, [{ field: 'margen' }]);
    expect(asc.map((r) => r.margen)).toEqual(['9', '45.2', '100', null]);
    // No muta la entrada.
    expect(rows[0].margen).toBe('9');
  });

  it('mezcla números y decimales en texto en la misma columna', () => {
    const out = applySort([{ v: '10' }, { v: 9 }, { v: '-2.5' }, { v: 100 }], [
      { field: 'v' },
    ]);
    expect(out.map((r) => r.v)).toEqual(['-2.5', 9, '10', 100]);
  });

  it('una columna de texto sigue ordenándose como texto', () => {
    const out = applySort(
      [{ n: 'pera' }, { n: 'café' }, { n: '10 cajas' }, { n: '9 cajas' }],
      [{ field: 'n' }],
    );
    expect(out.map((r) => r.n)).toEqual(['10 cajas', '9 cajas', 'café', 'pera']);
  });

  it('desempata por el segundo criterio cuando el decimal es igual', () => {
    const out = applySort(
      [
        { m: '5.0', n: 'b' },
        { m: '5', n: 'a' },
        { m: '7', n: 'c' },
      ],
      [{ field: 'm', direction: 'desc' }, { field: 'n' }],
    );
    expect(out.map((r) => r.n)).toEqual(['c', 'a', 'b']);
  });

  it.each([
    ['gt', 9, ['45.2', '100']],
    ['gte', 9, ['9', '45.2', '100']],
    ['lt', '45.2', ['9']],
    ['lte', 45.2, ['9', '45.2']],
  ])('filtra %s %s con decimales exactos', (op, value, expected) => {
    const out = applyFilters(rows, [{ field: 'margen', op, value }]);
    expect(out.map((r) => r.margen)).toEqual(expected);
  });

  it('un filtro de rango sobre texto es un error claro, no 0 filas', () => {
    expect(() =>
      applyFilters([{ n: 'café' }], [{ field: 'n', op: 'gt', value: 5 }]),
    ).toThrow(/no aplica a "n".*fila 1.*café/);
    expect(() =>
      applyFilters(rows, [{ field: 'margen', op: 'gt', value: 'alto' }]),
    ).toThrow(/necesita un valor numérico/);
    expect(() =>
      applyFilters(rows, [{ field: 'marjen', op: 'gt', value: 5 }]),
    ).toThrow(/no existe/);
    expect(() =>
      applyFilters([{ v: '1e20000000' }], [{ field: 'v', op: 'gt', value: 5 }]),
    ).toThrow(VexBlockDeriveError);
  });

  it('eq, neq e in igualan un decimal en texto con su número', () => {
    expect(applyFilters(rows, [{ field: 'margen', op: 'eq', value: 9 }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'margen', op: 'neq', value: 9 }])).toHaveLength(3);
    expect(
      applyFilters(rows, [{ field: 'margen', op: 'in', value: [100, 45.2] }]),
    ).toHaveLength(2);
    // El texto sigue siendo estricto.
    expect(applyFilters(rows, [{ field: 'cat', op: 'eq', value: 'a' }])).toHaveLength(1);
    expect(applyFilters(rows, [{ field: 'cat', op: 'contains', value: 'B' }])).toHaveLength(1);
  });

  it.each([
    ['sum', '154.2'],
    ['avg', '51.4'],
    ['min', '9'],
    ['max', '100'],
  ] as const)('agrega %s sobre decimales en texto', (fn, expected) => {
    const out = applyAggregate(rows, undefined, { field: 'margen', function: fn });
    expect(out).toEqual([{ [`${fn}_margen`]: expected }]);
  });

  it('la suma decimal es exacta (0.1 + 0.2 = 0.3) y agrupa', () => {
    const out = applyAggregate(
      [
        { g: 'x', v: '0.1' },
        { g: 'x', v: '0.2' },
        { g: 'y', v: '5' },
      ],
      'g',
      { field: 'v', function: 'sum' },
    );
    expect(out).toEqual([
      { g: 'x', sum_v: '0.3' },
      { g: 'y', sum_v: '5' },
    ]);
  });

  it('una columna solo de números JS conserva el resultado numérico de siempre', () => {
    const nums = [{ v: 2 }, { v: 9 }, { v: 5 }, { v: 'n/d' }];
    expect(applyAggregate(nums, undefined, { field: 'v', function: 'sum' })).toEqual([{ sum_v: 16 }]);
    expect(applyAggregate(nums, undefined, { field: 'v', function: 'max' })).toEqual([{ max_v: 9 }]);
    expect(applyAggregate(nums, undefined, { field: 'v', function: 'count' })).toEqual([{ count_v: 4 }]);
    expect(applyAggregate([{ v: 'x' }], undefined, { field: 'v', function: 'avg' })).toEqual([{ avg_v: 0 }]);
  });

  it('agregar una celda fuera de rango es un error, no una cifra parcial', () => {
    expect(() =>
      applyAggregate([{ v: '1e20000000' }, { v: '2' }], undefined, {
        field: 'v',
        function: 'sum',
      }),
    ).toThrow(VexBlockDeriveError);
  });
});
