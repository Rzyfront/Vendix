import { buildSmoothLinePath, buildSmoothAreaPath } from './chart-path';

describe('buildSmoothLinePath', () => {
  it('devuelve string vacío si no hay puntos', () => {
    expect(buildSmoothLinePath([])).toBe('');
  });

  it('usa solo M para un único punto', () => {
    expect(buildSmoothLinePath([{ x: 10, y: 20 }])).toBe('M 10 20');
  });

  it('conecta dos puntos con un segmento C', () => {
    const path = buildSmoothLinePath([
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ]);
    expect(path).toMatch(/^M 0 0 C/);
    expect(path).toContain('100 50');
    // No debe caer al comando lineal L.
    expect(path).not.toMatch(/L 100 50/);
  });

  it('encadena N puntos con M + N-1 segmentos C y sin L', () => {
    const path = buildSmoothLinePath([
      { x: 0, y: 0 },
      { x: 50, y: 30 },
      { x: 100, y: 10 },
      { x: 150, y: 60 },
    ]);
    expect(path.startsWith('M 0 0')).toBe(true);
    const cMatches = path.match(/ C /g) ?? [];
    expect(cMatches.length).toBe(3);
    expect(path.includes(' L ')).toBe(false);
  });

  it('cae a L si las coordenadas no son finitas (defensivo)', () => {
    const path = buildSmoothLinePath([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 50 },
    ]);
    expect(path).toContain('L ');
  });
});

describe('buildSmoothAreaPath', () => {
  it('devuelve string vacío si hay 0 o 1 punto', () => {
    expect(buildSmoothAreaPath([], 100)).toBe('');
    expect(buildSmoothAreaPath([{ x: 5, y: 5 }], 100)).toBe('');
  });

  it('concatena la línea con un cierre inferior en chartBottom', () => {
    const path = buildSmoothAreaPath(
      [
        { x: 0, y: 0 },
        { x: 50, y: 30 },
        { x: 100, y: 10 },
      ],
      120,
    );
    expect(path).toMatch(/^M 0 0 C/);
    expect(path).toContain('100 10');
    expect(path).toContain('L 100 120');
    expect(path).toContain('L 0 120');
    expect(path.endsWith('Z')).toBe(true);
  });
});
