/**
 * Puntaje de parecido 0-100 entre la descripción que leyó un escáner OCR y el
 * nombre de un producto del catálogo.
 *
 * Extraído tal cual de `InvoiceScannerService.fuzzyScore` (escáner de compras)
 * para que el escáner de borrador de factura de venta empareje con EXACTAMENTE
 * la misma regla — dos copias de la heurística derivan en dos umbrales que
 * significan cosas distintas. Puro: sin Prisma, sin contexto.
 *
 * - 100: iguales (sin distinguir mayúsculas).
 * - 85: uno contiene al otro.
 * - 0-80: proporción de palabras (> 2 letras) de la consulta que aparecen en el
 *   nombre, escalada a 80.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = (query ?? '').toLowerCase().trim();
  const t = (target ?? '').toLowerCase().trim();

  if (q === t) return 100;
  if (t.includes(q) || q.includes(t)) return 85;

  const qWords = q.split(/\s+/).filter((w) => w.length > 2);
  const tWords = t.split(/\s+/).filter((w) => w.length > 2);

  if (qWords.length === 0 || tWords.length === 0) return 0;

  let matches = 0;
  for (const qw of qWords) {
    for (const tw of tWords) {
      if (tw.includes(qw) || qw.includes(tw)) {
        matches++;
        break;
      }
    }
  }

  return Math.round((matches / qWords.length) * 80);
}
