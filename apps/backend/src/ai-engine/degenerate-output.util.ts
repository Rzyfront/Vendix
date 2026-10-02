/**
 * Detector de salida degenerada de un modelo (p. ej. «ellsellsells…» hasta el
 * tope de tokens). Función pura: no conoce proveedores ni streams.
 *
 * Dos señales, ambas conservadoras para no tocar texto legítimo (tablas
 * markdown, listas numeradas, separadores):
 *
 *  1. Un mismo fragmento de 2–40 caracteres repetido ≥ 30 veces seguidas. Un
 *     solo carácter repetido solo cuenta desde 200 (hay separadores `-----`).
 *  2. Una ventana de 600 caracteres con menos de 12 n-gramas (4) distintos:
 *     compresión trivial aunque el periodo sea irregular.
 */

export const DEGENERATE_MIN_PERIOD = 2;
export const DEGENERATE_MAX_PERIOD = 40;
export const DEGENERATE_MIN_REPEATS = 30;
export const DEGENERATE_SINGLE_CHAR_RUN = 200;
export const DEGENERATE_WINDOW = 600;
export const DEGENERATE_NGRAM = 4;
export const DEGENERATE_MIN_DISTINCT_NGRAMS = 12;

export interface DegenerateRepetitionResult {
  degenerate: boolean;
  /** Índice donde empieza la repetición: lo anterior es texto utilizable. */
  cutAt?: number;
}

export const DEGENERATE_OUTPUT_MESSAGE =
  'El modelo generó una respuesta inválida y se detuvo. Intenta de nuevo.';

export function detectDegenerateRepetition(
  text: string,
): DegenerateRepetitionResult {
  if (!text || text.length < DEGENERATE_MIN_PERIOD * DEGENERATE_MIN_REPEATS) {
    return { degenerate: false };
  }

  let earliest: number | null = null;

  // Señal 1: periodo exacto repetido. Una racha de `p * (reps - 1)` posiciones
  // consecutivas con text[i] === text[i + p] equivale a `reps` copias seguidas.
  for (
    let period = 1;
    period <= DEGENERATE_MAX_PERIOD && period < text.length;
    period++
  ) {
    const needed =
      period === 1
        ? DEGENERATE_SINGLE_CHAR_RUN - 1
        : period * (DEGENERATE_MIN_REPEATS - 1);
    let run = 0;
    for (let i = 0; i + period < text.length; i++) {
      if (text[i] === text[i + period]) {
        run++;
        if (run >= needed) {
          const start = i - run + 1;
          // `--` / `----` repetidos son el caso de un solo carácter (separadores):
          // los gobierna su umbral propio, no el de periodo.
          if (period > 1 && isSingleChar(text.slice(start, start + period))) {
            break;
          }
          if (earliest === null || start < earliest) earliest = start;
          break;
        }
      } else {
        run = 0;
      }
    }
  }

  // Señal 2: ventanas de baja entropía de n-gramas.
  if (text.length >= DEGENERATE_WINDOW) {
    const step = 100;
    const lastStart = text.length - DEGENERATE_WINDOW;
    for (let start = 0; ; start += step) {
      const from = Math.min(start, lastStart);
      if (windowIsTrivial(text, from)) {
        if (earliest === null || from < earliest) earliest = from;
        break;
      }
      if (from >= lastStart) break;
    }
  }

  return earliest === null
    ? { degenerate: false }
    : { degenerate: true, cutAt: earliest };
}

function windowIsTrivial(text: string, from: number): boolean {
  const grams = new Set<string>();
  const end = from + DEGENERATE_WINDOW - DEGENERATE_NGRAM;
  for (let i = from; i <= end; i++) {
    grams.add(text.slice(i, i + DEGENERATE_NGRAM));
    if (grams.size >= DEGENERATE_MIN_DISTINCT_NGRAMS) return false;
  }
  return true;
}

function isSingleChar(fragment: string): boolean {
  for (let i = 1; i < fragment.length; i++) {
    if (fragment[i] !== fragment[0]) return false;
  }
  return true;
}
