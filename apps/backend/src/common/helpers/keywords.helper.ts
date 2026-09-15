/**
 * Palabras comunes en español que no aportan discriminación en una búsqueda.
 * Descartarlas permite que "cómo cambiarle el cliente a una orden" busque
 * eficazmente por "cambiar", "cliente" y "orden".
 */
export const SPANISH_STOPWORDS = new Set([
  'a',
  'al',
  'como',
  'cómo',
  'con',
  'cual',
  'cuál',
  'cuales',
  'cuáles',
  'de',
  'del',
  'debo',
  'donde',
  'dónde',
  'el',
  'ella',
  'ellas',
  'ellos',
  'en',
  'es',
  'esta',
  'estas',
  'este',
  'esto',
  'estos',
  'hago',
  'hacer',
  'la',
  'las',
  'le',
  'les',
  'lo',
  'los',
  'mi',
  'mis',
  'necesito',
  'para',
  'pero',
  'por',
  'puedo',
  'poder',
  'que',
  'qué',
  'quiero',
  'saber',
  'se',
  'si',
  'sí',
  'sin',
  'sobre',
  'su',
  'sus',
  'tu',
  'tus',
  'un',
  'una',
  'unas',
  'uno',
  'unos',
  'ver',
  'y',
]);

/**
 * Normaliza y remueve tildes de un texto para búsquedas insensibles a acentos.
 */
export function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Descompone una frase en tokens útiles de búsqueda.
 */
export function tokenizeQuery(input: string): string[] {
  if (!input || !input.trim()) return [];
  const normalized = stripAccents(input.toLowerCase().trim());
  const words = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !SPANISH_STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, 10);
}

/**
 * Normaliza las palabras clave ingresadas por un administrador.
 * Guarda tanto las frases completas como los términos individuales indexables.
 *
 * Ejemplo:
 *   Input: ["cambiar cliente orden", "borrar producto"]
 *   Output: ["cambiar cliente orden", "borrar producto", "cambiar", "cliente", "orden", "borrar", "producto"]
 */
export function normalizeKeywords(
  input: string[] | string | undefined | null,
): string[] {
  if (!input) return [];

  const rawList: string[] = Array.isArray(input)
    ? input
    : input.split(',').map((s) => s.trim());

  const resultSet = new Set<string>();

  for (const item of rawList) {
    const phrase = item.toLowerCase().trim();
    if (!phrase) continue;

    // 1. Frase completa original
    resultSet.add(phrase);

    // 2. Frase sin tildes si es diferente
    const unaccented = stripAccents(phrase);
    if (unaccented !== phrase) {
      resultSet.add(unaccented);
    }

    // 3. Palabras individuales que no sean stopwords
    const tokens = unaccented
      .split(/[^\p{L}\p{N}]+/u)
      .filter((t) => t.length >= 2 && !SPANISH_STOPWORDS.has(t));

    for (const token of tokens) {
      resultSet.add(token);
    }
  }

  return Array.from(resultSet);
}

/**
 * Calcula la relevancia de un elemento en base a los tokens buscados.
 * Las palabras clave (keywords) reciben la ponderación más alta (+4 puntos),
 * asegurando que el contenido con palabras clave específicas aparezca de primero.
 */
export function calculateRelevance(
  item: {
    title: string;
    summary?: string | null;
    keywords?: string[] | null;
    tags?: string[] | null;
    content?: string | null;
  },
  tokens: string[],
): number {
  if (!tokens.length) return 0;

  const title = stripAccents((item.title || '').toLowerCase());
  const summary = stripAccents((item.summary || '').toLowerCase());
  const content = stripAccents((item.content || '').toLowerCase());
  const keywords = (item.keywords || []).map((k) => stripAccents(k.toLowerCase()));
  const tags = (item.tags || []).map((t) => stripAccents(t.toLowerCase()));

  return tokens.reduce((score, token) => {
    let tokenScore = 0;

    // Coincidencia en Keywords: peso 4 (prioridad máxima)
    if (keywords.some((kw) => kw === token || kw.includes(token) || token.includes(kw))) {
      tokenScore += 4;
    }

    // Coincidencia en Título: peso 3
    if (title.includes(token)) {
      tokenScore += 3;
    }

    // Coincidencia en Tags: peso 3
    if (tags.some((tag) => tag === token || tag.includes(token))) {
      tokenScore += 3;
    }

    // Coincidencia en Resumen: peso 2
    if (summary.includes(token)) {
      tokenScore += 2;
    }

    // Coincidencia en Contenido: peso 1
    if (content.includes(token)) {
      tokenScore += 1;
    }

    return score + tokenScore;
  }, 0);
}
