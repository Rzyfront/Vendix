import { SelectorOption } from '../selector/selector.component';
import type { TaxOption } from '../tax-selector';

/**
 * CATÁLOGOS DIAN COMPARTIDOS POR LAS DOS SUPERFICIES DE EMISIÓN.
 *
 * Vive aquí, junto a las secciones compartidas, y no dentro del riel de
 * tienda, porque lo consumen DOS pantallas que no se importan entre sí: la
 * factura de tienda (`store/invoicing`) y la factura de plataforma
 * (`super-admin/fiscal/invoicing`). Cuando `UNIT_CODE_OPTIONS` vivía sólo en
 * el catálogo del riel de tienda, la plataforma no tenía de dónde tomarlo y
 * acabó con un `unit_code` por defecto de `'EA'` —un código que NO está en la
 * rec. 20 y que ningún selector podía siquiera pintar—.
 *
 * `store/invoicing/components/invoice-create/invoice-dian-catalogs.ts`
 * re-exporta `UNIT_CODE_OPTIONS` desde aquí para no romper a sus consumidores.
 */

// ─────────────────────────────────────────────────────────────
// Unidad de medida — UN/ECE rec. 20 (`cbc:InvoicedQuantity/@unitCode`)
// ─────────────────────────────────────────────────────────────

export const UNIT_CODE_OPTIONS: SelectorOption[] = [
  { value: 'NIU', label: 'Unidad (NIU)' },
  { value: 'KGM', label: 'Kilogramo (KGM)' },
  { value: 'GRM', label: 'Gramo (GRM)' },
  { value: 'LTR', label: 'Litro (LTR)' },
  { value: 'MLT', label: 'Mililitro (MLT)' },
  { value: 'MTR', label: 'Metro (MTR)' },
  { value: 'CMT', label: 'Centímetro (CMT)' },
  { value: 'MTK', label: 'Metro cuadrado (MTK)' },
  { value: 'MTQ', label: 'Metro cúbico (MTQ)' },
  { value: 'HUR', label: 'Hora (HUR)' },
  { value: 'DAY', label: 'Día (DAY)' },
  { value: 'MON', label: 'Mes (MON)' },
  { value: 'PR', label: 'Par (PR)' },
  { value: 'SET', label: 'Juego (SET)' },
  { value: 'BX', label: 'Caja (BX)' },
  { value: 'PK', label: 'Paquete (PK)' },
];

/** Unidad por defecto de una línea nueva. `NIU` es «unidad» en la rec. 20. */
export const DEFAULT_UNIT_CODE = 'NIU';

// ─────────────────────────────────────────────────────────────
// Divisa extranjera (ISO 4217)
// ─────────────────────────────────────────────────────────────

/**
 * LA FACTURA SE EMITE SIEMPRE EN PESOS: esto sólo DECLARA la conversión
 * (`cac:PaymentAlternativeExchangeRate`), y la moneda del documento se queda
 * en COP porque así lo exige la Res. DIAN 000042/2020 art. 73.
 *
 * ## Por qué la plataforma sólo ofrece USD
 *
 * `MvpV1CurrencyDto.iso_4217` valida `@IsIn(['COP','USD'])` — multi-moneda es
 * V2. Ofrecer las trece divisas que lista el riel de tienda sería ofrecer doce
 * opciones cuyo único desenlace posible es un `400` después de que el operador
 * llenó el formulario entero.
 */
export const PLATFORM_FOREIGN_CURRENCY_OPTIONS: SelectorOption[] = [
  { value: 'USD', label: 'USD — Dólar estadounidense' },
];

// ─────────────────────────────────────────────────────────────
// Impuestos de la plataforma
// ─────────────────────────────────────────────────────────────

/**
 * Catálogo de impuestos de la CONSOLA DE PLATAFORMA.
 *
 * ## Por qué es una constante y no una lectura de `tax_rates`
 *
 * `tax_rates` está acotada por `store_id` y la plataforma NO tiene tienda: su
 * emisor es la organización de plataforma con su propia entidad contable. Una
 * lectura scoped devolvería vacío, y darle una tienda ficticia para poder
 * leerla acoplaría la facturación de la plataforma al inventario de un
 * comercio cualquiera.
 *
 * Las cuatro tarifas son las que la plataforma factura de verdad y no cambian
 * con el tiempo; una migración, un CRUD y una pantalla de administración para
 * cuatro filas fijas es coste sin retorno.
 *
 * ## Formas y unidades — leer antes de tocar
 *
 * - `rate` va en PORCENTAJE (19), no en fracción. Es lo que
 *   `TaxOption`/`TaxSelection` esperan y lo que `vendix-invoice-line-taxes`
 *   pinta. La conversión a la fracción 0–1 que exige el DTO ocurre UNA sola
 *   vez, en el armado del payload de la página.
 * - `id` es sintético: no hay fila de `tax_rates` detrás. Se usa sólo como
 *   clave de la selección en el formulario y se descarta al emitir.
 * - `tax_type` va en MAYÚSCULA porque es el valor que el DTO valida
 *   (`MvpV1_TAX_TYPES`). El componente sólo lo minuscula para buscar.
 *
 * Códigos DIAN del tributo (Anexo técnico): IVA = `01`, INC = `04`.
 */
export const PLATFORM_TAX_CATALOG: TaxOption[] = [
  {
    id: -1901,
    name: 'IVA 19%',
    rate: 19,
    tax_type: 'IVA',
    default_is_inclusive: false,
  },
  {
    id: -1905,
    name: 'IVA 5%',
    rate: 5,
    tax_type: 'IVA',
    default_is_inclusive: false,
  },
  {
    id: -1900,
    name: 'Exento / 0%',
    rate: 0,
    tax_type: 'IVA',
    default_is_inclusive: false,
  },
  {
    id: -4008,
    name: 'INC 8%',
    rate: 8,
    tax_type: 'INC',
    default_is_inclusive: false,
  },
];
