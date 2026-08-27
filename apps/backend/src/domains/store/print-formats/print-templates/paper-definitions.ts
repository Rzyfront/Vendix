import { PrintFormat } from '../../settings/interfaces/store-settings.interface';

/**
 * E.11 slice 2 — definiciones semilla de los 5 papeles del PDF fiscal.
 *
 * Esta tabla es la versión en DATOS del bloque `GEOMETRY` privado del builder
 * pdfkit (`apps/backend/src/domains/store/invoicing/services/
 * invoice-pdf.builder.ts:178-233`). Mide en MILÍMETROS, no en puntos
 * PostScript, porque (a) las hojas físicas se describen en mm — un pliego
 * carta es 215.9 × 279.4 mm, no 612 × 792 pt — y (b) las decisiones del
 * builder que la usan (sello QR §11.7, doble pasada de rollo, banda
 * multipágina) son DIMENSIONES FÍSICAS que el motor convierte a pt por su
 * cuenta al pintar.
 *
 * Decisiones explícitas que el slice 3 (cableado del consumer) debe respetar
 * — y por las que este archivo existe separado del builder:
 *
 * 1. `qr_min_side_mm = 20` constante, no por papel. Anexo Técnico 1.9 §11.7:
 *    es un MÍNIMO LEGAL, no estético. Por debajo un QR con las once líneas
 *    del anexo deja de leerse sobre térmico y el adquiriente pierde la única
 *    vía de verificación sin conexión.
 * 2. `qr_stamp_band_mm = qr_min_side_mm + 16/MM ≈ 25.64`. La banda al pie
 *    reservada para repetir el QR en multipágina — el mínimo del anexo MÁS
 *    16 pt de rótulo y aire (lo que el builder suma como `QR_STAMP_BAND`).
 *    Vale 0 salvo cuando el documento puede tener más de una página.
 * 3. `double_pass_required = true` SÓLO para los térmicos. El builder
 *    renderiza dos veces: una sonda de 20000 pt para MEDIR el alto real, y
 *    otra sobre la página cortada a esa altura. En hoja, el alto es fijo y
 *    la sonda sobra; sólo se estampa un segundo pase cuando hay multipágina
 *    real (es lo que `generate` decide en `invoice-pdf.builder.ts:260-279`).
 * 4. `requires_multipage_qr_band = true` para letter, a4, half_letter; false
 *    para térmicos. Una página de rollo no es «multipágina» — es UNA página
 *    de alto medido. Reservar banda en rollo gastaría papel.
 * 5. El `font_scale` sale del builder tal cual: 1.0 en letter/a4, 0.66 en
 *    half_letter, 0.82/0.74 en térmicos. NO se redefine: si se cambia
 *    aquí, el builder y las definiciones discreparían y la paridad numérica
 *    del paso E.11 (spec `print-gateway.engine-pdf.spec.ts`) deja de ser
 *    garantía.
 *
 * Esta tabla es SÓLO DATOS. La clase `InvoicePdfBuilder` sigue siendo el
 * MOTOR y se consume desde `FiscalInvoicePdfRenderService`. Slice 3 debe
 * cablear `FiscalInvoicePdfRenderService` (o quien resuelva el formato del
 * PDF fiscal) para que, ANTES de llamar al builder, lea aquí la geometría
 * del papel y la pase al builder por su contrato nativo — NO para que el
 * builder lea este archivo: eso invierte la dependencia builder→plantillas,
 * que es la decisión E.11 («builder pdfkit como motor, no como esclavo»).
 */

/** Anexo Técnico 1.9 §11.7 — lado mínimo del QR en la impresión. */
export const QR_MIN_SIDE_MM = 20;

/**
 * Puntos de rótulo y aire sumados al mínimo del QR en la banda multipágina.
 * Espejo de `QR_STAMP_BAND = QR_MIN_SIDE + 16` en el builder (`pt`); aquí
 * convertido a mm para mantener una sola unidad en este archivo.
 */
const QR_STAMP_BAND_AIR_PT = 16;
const PT_PER_MM = 2.834645669;
const QR_STAMP_BAND_MM = QR_MIN_SIDE_MM + QR_STAMP_BAND_AIR_PT / PT_PER_MM;

/**
 * Definición geométrica de un papel — los cinco campos que el motor de
 * dibujo NECESITA para distinguir un papel de otro. Datos puros, sin
 * comportamiento: el builder pdfkit es el único que sabe qué HACER con
 * ellos.
 */
export interface PaperDefinition {
  /** Código del papel — la misma clave que `PRINT_FORMATS`. */
  code: PrintFormat;
  /** Etiqueta humana (sólo para logs y la spec de paridad). */
  label: string;
  /** Ancho físico en mm. Para rollo, el ancho del rollo. */
  width_mm: number;
  /**
   * Alto físico en mm. Para rollo, `null` — el alto se MIDE en cada
   * documento. Para hoja, el alto fijo del pliego.
   */
  height_mm: number | null;
  /** Margen físico en mm. Ignorado en rollo (no hay margen de página). */
  margin_mm: number;
  /** Multiplica cada font size para mantener legibilidad en papel estrecho. */
  font_scale: number;
  /** El papel se alimenta por rollo continuo (sin alto fijo). */
  is_roll: boolean;
  /** Lado mínimo del QR (mm) — constante legal §11.7, no estética. */
  qr_min_side_mm: number;
  /**
   * Reserva al pie (mm) para repetir el QR en cada página de un documento
   * de varias páginas. `0` cuando el papel no tiene multipágina real
   * (rollo = una página de alto medido).
   */
  qr_stamp_band_mm: number;
  /**
   * El builder debe reservar la banda multipágina al volver a componer el
   * documento. `true` para letter, a4 y half_letter.
   */
  requires_multipage_qr_band: boolean;
  /**
   * El builder debe renderizar dos veces: sonda sobre 20000 pt para
   * MEDIR el alto real y segunda pasada sobre la página cortada. `true`
   * SÓLO para térmicos — en hoja el alto es fijo y la sonda sobra.
   */
  double_pass_required: boolean;
  /**
   * `page-size` para `@page` CSS (hoja) o `<width>mm auto` (rollo). El
   * compositor HTML lo lee; el builder pdfkit lo ignora porque opera en
   * pt y deriva `width/height` de `width_mm`/`height_mm` arriba.
   */
  css_page_size: string;
}

/**
 * Registry — la fuente de verdad de los 5 papeles. Cualquier consumidor
 * (composer, gateway, builder) debe leerla vía `getPaperDefinition` para
 * tener el mismo `fallback` y la misma validación que el resto del dominio.
 */
export const PAPER_DEFINITIONS: Record<PrintFormat, PaperDefinition> = {
  letter: {
    code: 'letter',
    label: 'Carta (8.5 × 11 in)',
    width_mm: 215.9,
    height_mm: 279.4,
    margin_mm: 14.11, // 40 pt del builder
    font_scale: 1,
    is_roll: false,
    qr_min_side_mm: QR_MIN_SIDE_MM,
    qr_stamp_band_mm: QR_STAMP_BAND_MM,
    requires_multipage_qr_band: true,
    double_pass_required: false,
    css_page_size: 'letter',
  },
  a4: {
    code: 'a4',
    label: 'A4 (210 × 297 mm)',
    width_mm: 210,
    height_mm: 297,
    margin_mm: 14.11, // 40 pt del builder
    font_scale: 1,
    is_roll: false,
    qr_min_side_mm: QR_MIN_SIDE_MM,
    qr_stamp_band_mm: QR_STAMP_BAND_MM,
    requires_multipage_qr_band: true,
    double_pass_required: false,
    css_page_size: 'A4',
  },
  half_letter: {
    code: 'half_letter',
    label: 'Media carta (5.5 × 8.5 in)',
    width_mm: 215.9,
    height_mm: 139.7,
    margin_mm: 4.94, // 14 pt del builder — más estrecho a propósito
    font_scale: 0.66,
    is_roll: false,
    qr_min_side_mm: QR_MIN_SIDE_MM,
    qr_stamp_band_mm: QR_STAMP_BAND_MM,
    requires_multipage_qr_band: true,
    double_pass_required: false,
    css_page_size: '216mm 140mm',
  },
  thermal_80: {
    code: 'thermal_80',
    label: 'Térmico 80 mm',
    width_mm: 80,
    height_mm: null, // se mide por documento
    margin_mm: 3.53, // 10 pt del builder
    font_scale: 0.82,
    is_roll: true,
    qr_min_side_mm: QR_MIN_SIDE_MM,
    qr_stamp_band_mm: 0, // rollo = una página, sin banda
    requires_multipage_qr_band: false,
    double_pass_required: true,
    css_page_size: '80mm auto',
  },
  thermal_58: {
    code: 'thermal_58',
    label: 'Térmico 58 mm',
    width_mm: 58,
    height_mm: null,
    margin_mm: 2.47, // 7 pt del builder
    font_scale: 0.74,
    is_roll: true,
    qr_min_side_mm: QR_MIN_SIDE_MM,
    qr_stamp_band_mm: 0,
    requires_multipage_qr_band: false,
    double_pass_required: true,
    css_page_size: '58mm auto',
  },
};
