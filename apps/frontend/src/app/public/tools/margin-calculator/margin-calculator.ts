/**
 * SEO-TECH-19 — Calculadora de margen y precio de venta (módulo de cálculo).
 *
 * Herramienta NO publicada hasta revisión del contador: este archivo no está
 * conectado a ninguna ruta, componente ni enlace. Son funciones puras, sin
 * dependencias de Angular, DOM ni red. Moneda COP, sin decimales en el precio.
 *
 * Fórmulas (B = base sin impuesto, C = costo, t = tarifa):
 *   margen sobre venta m = (B - C) / B        B = C / (1 - m)
 *   markup sobre costo k = (B - C) / C        B = C * (1 + k)
 *   P = B * (1 + t);  desglose con impuesto incluido: B = P / (1 + t)
 *
 * Redondeo: P al peso más cercano (mitad hacia arriba); con `redondearA` > 1 se
 * sube hacia arriba al múltiplo. Luego B = round(P / (1 + t)) e impuesto = P - B,
 * de modo que base + impuesto = precio final siempre.
 */

export type CodigoImpuesto = 'IVA_19' | 'IVA_5' | 'IVA_0' | 'INC_8' | 'NINGUNO';

/** Tarifa en puntos porcentuales (enteros) por código de catálogo. */
export const TARIFAS_IMPUESTO: Readonly<Record<CodigoImpuesto, number>> = {
  IVA_19: 19,
  IVA_5: 5,
  IVA_0: 0,
  INC_8: 8,
  NINGUNO: 0,
};

/** Límite superior de cualquier valor monetario aceptado (evita pérdida de precisión). */
export const VALOR_MAXIMO = 1e12;

export type CodigoErrorCalculadora =
  | 'ENTRADA_NEGATIVA'
  | 'ENTRADA_INVALIDA'
  | 'MARGEN_IMPOSIBLE'
  | 'MODO_AMBIGUO'
  | 'IMPUESTO_DESCONOCIDO';

export class ErrorCalculadora extends Error {
  constructor(
    public readonly codigo: CodigoErrorCalculadora,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorCalculadora';
  }
}

export interface EntradaPrecioVenta {
  /** Costo unitario no recuperable, en pesos. */
  costo: number;
  /** Margen deseado sobre el precio de venta, en %. Excluyente con `markupPct`. */
  margenPct?: number | null;
  /** Markup deseado sobre el costo, en %. Excluyente con `margenPct`. */
  markupPct?: number | null;
  impuesto: CodigoImpuesto;
  /** Múltiplo (entero > 1, p. ej. 50 o 100) al que se sube el precio final. */
  redondearA?: number;
}

export interface EntradaDesglose {
  costo: number;
  precioVenta: number;
  /** true si `precioVenta` ya incluye el impuesto. */
  impuestoIncluido: boolean;
  impuesto: CodigoImpuesto;
}

export interface ResultadoPrecio {
  costo: number;
  tarifaPct: number;
  /** Precio sin impuesto. */
  base: number;
  /** Monto del impuesto (precioFinal - base). */
  impuesto: number;
  precioFinal: number;
  utilidad: number;
  /** Margen real resultante sobre la base (2 decimales); null si no es calculable. */
  margenRealPct: number | null;
  /** Markup real resultante sobre el costo (2 decimales); null si el costo es 0. */
  markupRealPct: number | null;
}

function redondearPeso(valor: number): number {
  return Math.floor(valor + 0.5);
}

function redondear2(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100;
}

function validarNumero(valor: unknown, nombre: string): number {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) {
    throw new ErrorCalculadora('ENTRADA_INVALIDA', `${nombre} debe ser un número válido.`);
  }
  if (valor < 0) {
    throw new ErrorCalculadora('ENTRADA_NEGATIVA', `${nombre} no puede ser negativo.`);
  }
  return valor;
}

function validarMonto(valor: unknown, nombre: string): number {
  const n = validarNumero(valor, nombre);
  if (n > VALOR_MAXIMO) {
    throw new ErrorCalculadora('ENTRADA_INVALIDA', `${nombre} supera el máximo permitido.`);
  }
  return n;
}

function tarifaDe(codigo: CodigoImpuesto): number {
  if (!Object.prototype.hasOwnProperty.call(TARIFAS_IMPUESTO, codigo)) {
    throw new ErrorCalculadora('IMPUESTO_DESCONOCIDO', 'Tipo de impuesto no soportado.');
  }
  return TARIFAS_IMPUESTO[codigo];
}

function construirResultado(
  costo: number,
  tarifaPct: number,
  base: number,
  precioFinal: number,
): ResultadoPrecio {
  const utilidad = base - costo;
  return {
    costo,
    tarifaPct,
    base,
    impuesto: precioFinal - base,
    precioFinal,
    utilidad,
    margenRealPct: base === 0 ? null : redondear2((utilidad / base) * 100),
    markupRealPct: costo === 0 ? null : redondear2((utilidad / costo) * 100),
  };
}

/** Convierte margen sobre venta (%) en markup sobre costo (%): k = m / (1 - m). */
export function margenAMarkupPct(margenPct: number): number {
  const m = validarNumero(margenPct, 'El margen');
  if (m >= 100) {
    throw new ErrorCalculadora(
      'MARGEN_IMPOSIBLE',
      'Un margen de 100 % o más es imposible; usa markup sobre el costo.',
    );
  }
  return redondear2((m / (100 - m)) * 100);
}

/** Convierte markup sobre costo (%) en margen sobre venta (%): m = k / (1 + k). */
export function markupAMargenPct(markupPct: number): number {
  const k = validarNumero(markupPct, 'El markup');
  return redondear2((k / (100 + k)) * 100);
}

/** «Me cuesta C y quiero ganar X %: ¿a cuánto lo vendo?» */
export function calcularPrecioVenta(entrada: EntradaPrecioVenta): ResultadoPrecio {
  const tieneMargen = entrada.margenPct !== undefined && entrada.margenPct !== null;
  const tieneMarkup = entrada.markupPct !== undefined && entrada.markupPct !== null;
  if (tieneMargen === tieneMarkup) {
    throw new ErrorCalculadora('MODO_AMBIGUO', 'Indica margen o markup, pero no ambos ni ninguno.');
  }

  const costo = validarMonto(entrada.costo, 'El costo');
  const tarifaPct = tarifaDe(entrada.impuesto);

  let baseSinRedondear: number;
  if (tieneMargen) {
    const m = validarNumero(entrada.margenPct, 'El margen');
    if (m >= 100) {
      throw new ErrorCalculadora(
        'MARGEN_IMPOSIBLE',
        'Un margen de 100 % o más es imposible: no existe precio. Usa markup sobre el costo.',
      );
    }
    baseSinRedondear = (costo * 100) / (100 - m);
  } else {
    const k = validarNumero(entrada.markupPct, 'El markup');
    baseSinRedondear = (costo * (100 + k)) / 100;
  }

  const paso = entrada.redondearA;
  if (paso !== undefined && (!Number.isInteger(paso) || paso < 1)) {
    throw new ErrorCalculadora('ENTRADA_INVALIDA', 'El redondeo debe ser un entero mayor o igual a 1.');
  }

  let precioFinal = redondearPeso((baseSinRedondear * (100 + tarifaPct)) / 100);
  if (paso !== undefined && paso > 1) {
    precioFinal = Math.ceil(precioFinal / paso) * paso;
  }
  const base = redondearPeso((precioFinal * 100) / (100 + tarifaPct));
  return construirResultado(costo, tarifaPct, base, precioFinal);
}

/** «Lo vendo a P y me cuesta C: ¿cuánto gano de verdad?» Admite venta a pérdida. */
export function desglosarPrecio(entrada: EntradaDesglose): ResultadoPrecio {
  const costo = validarMonto(entrada.costo, 'El costo');
  const precio = validarMonto(entrada.precioVenta, 'El precio de venta');
  const tarifaPct = tarifaDe(entrada.impuesto);

  const precioEntero = redondearPeso(precio);
  if (entrada.impuestoIncluido) {
    const base = redondearPeso((precioEntero * 100) / (100 + tarifaPct));
    return construirResultado(costo, tarifaPct, base, precioEntero);
  }
  const impuesto = redondearPeso((precioEntero * tarifaPct) / 100);
  return construirResultado(costo, tarifaPct, precioEntero, precioEntero + impuesto);
}
