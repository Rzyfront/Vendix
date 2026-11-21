/**
 * F4 T31 (S4): vocabulary of the store memory key `learning.format`.
 *
 * Vex asks «¿Video o paso a paso?» and stores exactly `video` or `post`
 * (paso a paso = the help article). The help tools, the memory tools and
 * `AgentMemoryService` all read this module, so the key has one vocabulary.
 */
export const LEARNING_FORMAT_KEY = 'learning.format';
export const LEARNING_FORMATS = ['video', 'post'] as const;
export type LearningFormat = (typeof LEARNING_FORMATS)[number];

/** What to store, quoted verbatim by every tool text that cites the key. */
export const LEARNING_FORMAT_VALUES_TEXT =
  'guarda exactamente `video` (prefiere video) o `post` (prefiere paso a paso: el artículo)';

/** What each stored value delivers. */
export const LEARNING_FORMAT_DELIVERY_TEXT =
  '`video` → entrega el video; `post` → entrega el artículo';

/**
 * Words a person or an earlier prompt used for each value. The earlier help
 * prompt asked to store `paso a paso`, so those rows still read as `post`.
 */
const ALIASES: Readonly<Record<string, LearningFormat>> = {
  video: 'video',
  videos: 'video',
  post: 'post',
  posts: 'post',
  'paso a paso': 'post',
  articulo: 'post',
  artículo: 'post',
};

/** Canonical value for a stored or typed text, or null when it is not a format. */
export function normalizeLearningFormat(value: string): LearningFormat | null {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[`"'«».!¡¿?]/g, '')
    .replace(/[-_\s]+/g, ' ')
    .trim();
  return ALIASES[text] ?? null;
}
