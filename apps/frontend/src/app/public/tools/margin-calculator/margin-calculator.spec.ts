/**
 * SEO-TECH-19 — pruebas del módulo de cálculo de la calculadora de margen.
 * Herramienta no publicada hasta revisión del contador.
 */
import {
  CodigoImpuesto,
  ErrorCalculadora,
  TARIFAS_IMPUESTO,
  VALOR_MAXIMO,
  calcularPrecioVenta,
  desglosarPrecio,
  margenAMarkupPct,
  markupAMargenPct,
} from './margin-calculator';

function codigoDeError(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof ErrorCalculadora ? e.codigo : 'OTRO';
  }
}

describe('Calculadora de margen (SEO-TECH-19)', () => {
  it('calcula el precio desde un margen del 30 % sin impuesto', () => {
    const r = calcularPrecioVenta({ costo: 10000, margenPct: 30, impuesto: 'IVA_0' });
    expect(r.precioFinal).toBe(14286);
    expect(r.margenRealPct).toBe(30);
    expect(r.markupRealPct).toBe(42.86);
  });

  it('suma el IVA 19 % sobre la base y mantiene base + impuesto = final', () => {
    const r = calcularPrecioVenta({ costo: 10000, margenPct: 30, impuesto: 'IVA_19' });
    expect(r.precioFinal).toBe(17000);
    expect(r.base).toBe(14286);
    expect(r.impuesto).toBe(2714);
    expect(r.base + r.impuesto).toBe(r.precioFinal);
  });

  it('calcula el precio desde markup (30 % sobre 10.000 = 13.000)', () => {
    const r = calcularPrecioVenta({ costo: 10000, markupPct: 30, impuesto: 'NINGUNO' });
    expect(r.precioFinal).toBe(13000);
    expect(r.markupRealPct).toBe(30);
  });

  it('acepta markup de 100 % o más (150 % = 2,5 x costo, margen 60 %)', () => {
    const r = calcularPrecioVenta({ costo: 10000, markupPct: 150, impuesto: 'NINGUNO' });
    expect(r.precioFinal).toBe(25000);
    expect(r.margenRealPct).toBe(60);
  });

  it('margen 0 %: el precio es el costo más el impuesto, margen y markup 0', () => {
    const r = calcularPrecioVenta({ costo: 10000, margenPct: 0, impuesto: 'IVA_19' });
    expect(r.precioFinal).toBe(11900);
    expect(r.margenRealPct).toBe(0);
    expect(r.markupRealPct).toBe(0);
  });

  it('margen de 100 % o más lanza MARGEN_IMPOSIBLE', () => {
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, margenPct: 100, impuesto: 'IVA_0' }))).toBe(
      'MARGEN_IMPOSIBLE',
    );
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, margenPct: 120, impuesto: 'IVA_0' }))).toBe(
      'MARGEN_IMPOSIBLE',
    );
  });

  it('costo 0: precio 0 y margen/markup null (no se inventa 100 %)', () => {
    const r = calcularPrecioVenta({ costo: 0, margenPct: 30, impuesto: 'IVA_19' });
    expect(r.precioFinal).toBe(0);
    expect(r.margenRealPct).toBeNull();
    expect(r.markupRealPct).toBeNull();
  });

  it('rechaza costo, margen y markup negativos con ENTRADA_NEGATIVA', () => {
    expect(codigoDeError(() => calcularPrecioVenta({ costo: -1, margenPct: 30, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_NEGATIVA',
    );
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, margenPct: -5, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_NEGATIVA',
    );
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, markupPct: -5, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_NEGATIVA',
    );
  });

  it('rechaza NaN, Infinity, texto y valores sobre el máximo con ENTRADA_INVALIDA', () => {
    const texto = 'abc' as unknown as number;
    expect(codigoDeError(() => calcularPrecioVenta({ costo: NaN, margenPct: 30, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_INVALIDA',
    );
    expect(codigoDeError(() => calcularPrecioVenta({ costo: texto, margenPct: 30, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_INVALIDA',
    );
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, margenPct: Infinity, impuesto: 'IVA_0' }))).toBe(
      'ENTRADA_INVALIDA',
    );
    expect(
      codigoDeError(() => calcularPrecioVenta({ costo: VALOR_MAXIMO + 1, margenPct: 30, impuesto: 'IVA_0' })),
    ).toBe('ENTRADA_INVALIDA');
  });

  it('exige exactamente un modo: margen y markup a la vez, o ninguno, lanza MODO_AMBIGUO', () => {
    expect(
      codigoDeError(() => calcularPrecioVenta({ costo: 100, margenPct: 30, markupPct: 30, impuesto: 'IVA_0' })),
    ).toBe('MODO_AMBIGUO');
    expect(codigoDeError(() => calcularPrecioVenta({ costo: 100, impuesto: 'IVA_0' }))).toBe('MODO_AMBIGUO');
  });

  it('rechaza un impuesto fuera del catálogo con IMPUESTO_DESCONOCIDO', () => {
    expect(
      codigoDeError(() =>
        calcularPrecioVenta({ costo: 100, margenPct: 30, impuesto: 'IVA_16' as unknown as CodigoImpuesto }),
      ),
    ).toBe('IMPUESTO_DESCONOCIDO');
  });

  it('el catálogo tiene las tarifas esperadas (IVA 19/5/0, INC 8, ninguno)', () => {
    expect(TARIFAS_IMPUESTO).toEqual({ IVA_19: 19, IVA_5: 5, IVA_0: 0, INC_8: 8, NINGUNO: 0 });
    const inc = calcularPrecioVenta({ costo: 5000, margenPct: 40, impuesto: 'INC_8' });
    expect(inc.precioFinal).toBe(9000);
    expect(inc.impuesto).toBe(667);
  });

  it('redondea al peso más cercano con la mitad hacia arriba', () => {
    // 10 * 1,05 = 10,5 -> 11
    const r = calcularPrecioVenta({ costo: 10, margenPct: 0, impuesto: 'IVA_5' });
    expect(r.precioFinal).toBe(11);
    expect(r.base).toBe(10);
    expect(r.impuesto).toBe(1);
  });

  it('con redondearA sube hacia arriba al múltiplo y no pierde margen', () => {
    const r = calcularPrecioVenta({ costo: 12345, margenPct: 30, impuesto: 'IVA_19', redondearA: 100 });
    expect(r.precioFinal).toBe(21000);
    expect(r.precioFinal % 100).toBe(0);
    expect(r.margenRealPct as number).toBeGreaterThanOrEqual(30);
    // un precio ya múltiplo no se mueve
    expect(calcularPrecioVenta({ costo: 10000, margenPct: 30, impuesto: 'IVA_19', redondearA: 100 }).precioFinal).toBe(
      17000,
    );
  });

  it('convierte entre margen y markup (30 % margen = 42,86 % markup; 150 % markup = 60 % margen)', () => {
    expect(margenAMarkupPct(30)).toBe(42.86);
    expect(markupAMargenPct(150)).toBe(60);
    expect(codigoDeError(() => margenAMarkupPct(100))).toBe('MARGEN_IMPOSIBLE');
  });

  it('desglosa un precio con impuesto incluido', () => {
    const r = desglosarPrecio({ costo: 5000, precioVenta: 11900, impuestoIncluido: true, impuesto: 'IVA_19' });
    expect(r.base).toBe(10000);
    expect(r.impuesto).toBe(1900);
    expect(r.precioFinal).toBe(11900);
    expect(r.margenRealPct).toBe(50);
    expect(r.markupRealPct).toBe(100);
  });

  it('desglosa un precio sin impuesto y le suma el impuesto', () => {
    const r = desglosarPrecio({ costo: 5000, precioVenta: 10000, impuestoIncluido: false, impuesto: 'IVA_19' });
    expect(r.base).toBe(10000);
    expect(r.impuesto).toBe(1900);
    expect(r.precioFinal).toBe(11900);
  });

  it('venta a pérdida: el desglose muestra margen negativo', () => {
    const r = desglosarPrecio({ costo: 10000, precioVenta: 8000, impuestoIncluido: true, impuesto: 'IVA_0' });
    expect(r.utilidad).toBe(-2000);
    expect(r.margenRealPct).toBe(-25);
    expect(r.markupRealPct).toBe(-20);
  });

  it('propiedad (2.000 casos deterministas): base + impuesto = final, entero, impuesto >= 0 y margen a <= 0,05 puntos', () => {
    const codigos: CodigoImpuesto[] = ['IVA_19', 'IVA_5', 'IVA_0', 'INC_8', 'NINGUNO'];
    let semilla = 20261027;
    const siguiente = (): number => {
      semilla = (Math.imul(semilla, 1664525) + 1013904223) >>> 0;
      return semilla / 4294967296;
    };
    for (let i = 0; i < 2000; i++) {
      const costo = 1000 + Math.floor(siguiente() * 9_999_000);
      const margen = Math.floor(siguiente() * 9000) / 100; // 0 a 89,99
      const impuesto = codigos[Math.floor(siguiente() * codigos.length)];
      const r = calcularPrecioVenta({ costo, margenPct: margen, impuesto });
      expect(r.base + r.impuesto).toBe(r.precioFinal);
      expect(Number.isInteger(r.precioFinal)).toBeTrue();
      expect(r.impuesto).toBeGreaterThanOrEqual(0);
      expect(Math.abs((r.margenRealPct as number) - margen)).toBeLessThanOrEqual(0.05);
    }
  });
});
