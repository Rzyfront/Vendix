/**
 * «sigue con lo de ayer»: la persona retoma un tema anterior sin nombrarlo.
 *
 * Sin ayuda el modelo lee «ayer» al pie de la letra, no encuentra nada «de
 * ayer» en la ventana y pide que se lo repitan, aunque el hilo tenga un único
 * tema evidente. Este bloque le pone delante los últimos pedidos de la persona
 * y la regla: un solo tema plausible se retoma con datos frescos; varios, se
 * pregunta cuál.
 */

// `\b` is ASCII-only in JS: «íbamos» would never match. Letter lookarounds.
const word = (alternatives: string) =>
  new RegExp(`(?<!\\p{L})(?:${alternatives})(?!\\p{L})`, 'iu');
const RESUME_VERB = word(
  'sigue|segu[ií]|seguir|sigamos|contin[uú]a|continuar|continuemos|retoma|retomar|retomemos',
);
const VAGUE_TARGET = word(
  'ayer|antes|anterior|pendiente|quedamos|[ií]bamos|est[aá]bamos|eso|lo\\s+mismo',
);
const MAX_REFERENCE_LENGTH = 60;
const MAX_TOPICS = 3;
const MAX_TOPIC_LENGTH = 200;

/** True when the message only points back, without saying at what. */
export function isVagueBackReference(message: string): boolean {
  const text = message.trim();
  if (!text || text.length > MAX_REFERENCE_LENGTH) return false;
  if (!RESUME_VERB.test(text)) return false;
  const rest = text
    .replace(RESUME_VERB, '')
    .replace(/[^\p{L}\s]/gu, '')
    .trim();
  return !rest || VAGUE_TARGET.test(text);
}

export function resumeReferenceBlock(
  history: ReadonlyArray<{ role: string; content: string | null }>,
  goal: string,
): string | null {
  if (!isVagueBackReference(goal)) return null;
  const asked = history
    .filter((m) => m.role === 'user' && (m.content ?? '').trim())
    .map((m) => (m.content ?? '').trim());
  while (asked.length && asked[asked.length - 1] === goal.trim()) asked.pop();
  const topics = [...new Set(asked.reverse())]
    .filter((topic) => !isVagueBackReference(topic))
    .slice(0, MAX_TOPICS)
    .map((topic) => `«${topic.slice(0, MAX_TOPIC_LENGTH)}»`);
  if (!topics.length) return null;
  return [
    `(interno) La persona retoma algo anterior sin decir qué («${goal.trim()}»).`,
    `Lo último que pidió en este hilo, del más reciente al más antiguo: ${topics.join('; ')}.`,
    'Si hay un solo tema plausible, retómalo sin preguntar: vuelve a consultar con tus herramientas los datos actuales de ese tema y responde. No digas que no recuerdas ni le pidas que te lo repita: el hilo es la memoria.',
    'Solo si hay varios temas distintos e igual de plausibles, pregúntale en una frase cuál retomas.',
  ].join(' ');
}
