/**
 * Ticket de calibración: regla local (sin backend) para que la tienda compruebe
 * cuántos milímetros imprime realmente su cabezal térmico.
 *
 * El cuerpo se imprime por `DocumentPrintService.print()` con el ancho
 * imprimible máximo permitido; el contenido queda centrado en el rollo. Por eso
 * cada línea se dibuja como una barra CENTRADA de ancho exacto: si se ve
 * completa (ambos bordes), la impresora imprime al menos ese ancho.
 */

export type CalibrationRollFormat = 'thermal_80' | 'thermal_58';

/** Anchos (mm) de las líneas de prueba por formato de rollo. */
export const CALIBRATION_LINES_MM: Record<CalibrationRollFormat, readonly number[]> = {
  thermal_80: [64, 72, 76],
  thermal_58: [48, 52],
};

/** Ancho imprimible máximo por formato (papel − 4 mm), para el override. */
export const CALIBRATION_MAX_PRINTABLE_MM: Record<CalibrationRollFormat, number> = {
  thermal_80: 76,
  thermal_58: 54,
};

const TICK_STEP_MM = 4;

/** Construye el cuerpo HTML de la regla (solo lo que va dentro de `<body>`). */
export function buildCalibrationBodyHtml(format: CalibrationRollFormat): string {
  const lines = CALIBRATION_LINES_MM[format];
  const maxMm = CALIBRATION_MAX_PRINTABLE_MM[format];
  const paperMm = format === 'thermal_58' ? 58 : 80;

  const tickCells = Math.floor(maxMm / TICK_STEP_MM);
  const ticks = Array.from({ length: tickCells }, () =>
    `<span style="display:block;width:${TICK_STEP_MM}mm;height:3mm;border-left:0.2mm solid #000;box-sizing:border-box;"></span>`,
  ).join('');
  const ticksRow =
    `<div style="display:flex;width:${tickCells * TICK_STEP_MM}mm;margin:0 auto;border-right:0.2mm solid #000;box-sizing:border-box;">${ticks}</div>`;

  const bars = lines
    .map(
      (mm) => `
      <div style="margin:2mm 0;">
        <div style="width:${mm}mm;margin:0 auto;border:0.4mm solid #000;box-sizing:border-box;text-align:center;font:bold 9pt monospace;padding:1mm 0;">
          ${mm} mm
        </div>
        <div style="text-align:center;font:7pt sans-serif;margin-top:0.5mm;">
          Si ves completa la línea de ${mm} mm, tu impresora imprime ${mm} mm
        </div>
      </div>`,
    )
    .join('');

  return `
    <div style="text-align:center;font:bold 10pt sans-serif;margin-bottom:1mm;">TICKET DE CALIBRACIÓN</div>
    <div style="text-align:center;font:7pt sans-serif;margin-bottom:2mm;">Papel ${paperMm} mm · marcas cada ${TICK_STEP_MM} mm desde el centro</div>
    ${ticksRow}
    ${bars}
    ${ticksRow}
    <div style="text-align:center;font:7pt sans-serif;margin-top:2mm;">
      La línea más ancha que veas COMPLETA (bordes izquierdo y derecho) es el
      ancho imprimible de tu impresora. Elígelo en "Ancho imprimible".
    </div>`;
}
