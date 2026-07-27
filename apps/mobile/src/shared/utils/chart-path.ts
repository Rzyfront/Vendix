/**
 * Construcción pura del path SVG (comando `M` + curvas cúbicas `C`) para
 * `TrendChartFallback`. La curva se suaviza con dos puntos de control por
 * segmento (`C cp1 cp2 end`) calculados para mantener la tangente horizontal
 * en el punto medio entre vecinos — eso da el aspecto "más curvado" que
 * pide QUI-520 sin perder los datos originales ni los ejes.
 *
 * Casos cubiertos:
 *  - 0 puntos → string vacío (el llamador debe manejar el estado vacío).
 *  - 1 punto → comando `M` simple.
 *  - 2 puntos → segmento `C` entre los dos.
 *  - N puntos → cadena `M` + N-1 segmentos `C` con puntos de control
 *    horizontales en cada unión.
 */
export function buildSmoothLinePath(
  points: readonly { x: number; y: number }[],
): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y}`;
  }
  const segments: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const deltaX = (next.x - current.x) / 2;
    // Control points placed at the midpoint on the X axis to keep a soft
    // horizontal tangent at each joint. Falls back to a linear `L` only if
    // the caller passes non-finite coordinates (defensive).
    const cp1 = { x: current.x + deltaX, y: current.y };
    const cp2 = { x: next.x - deltaX, y: next.y };
    if (!isFinite(cp1.x) || !isFinite(cp1.y) || !isFinite(cp2.x) || !isFinite(cp2.y)) {
      segments.push(`L ${next.x} ${next.y}`);
    } else {
      segments.push(`C ${cp1.x} ${cp1.y} ${cp2.x} ${cp2.y} ${next.x} ${next.y}`);
    }
  }
  return segments.join(' ');
}

/**
 * Construye el path del área rellenada bajo la curva. Devuelve string vacío
 * si hay menos de 2 puntos. La línea base es `chartBottom` (eje X del
 * chart) para que el path pueda cerrarse en `Z`.
 */
export function buildSmoothAreaPath(
  points: readonly { x: number; y: number }[],
  chartBottom: number,
): string {
  if (points.length < 2) return '';
  const line = buildSmoothLinePath(points);
  return `${line} L ${points[points.length - 1].x} ${chartBottom} L ${points[0].x} ${chartBottom} Z`;
}
