/**
 * Tuning constants for the pipeline voice mode.
 *
 * Every number here is a latency decision, and every one is an estimate until
 * the timing marks say otherwise. They live in one file so tuning them is a
 * single diff rather than a hunt.
 */

/** Application keys that govern the two ends of the pipeline. */
export const VOICE_STT_APP_KEY = 'vexi_voice_stt';
export const VOICE_TTS_APP_KEY = 'vexi_voice_tts';

/**
 * Character budget per segment, in emission order; the last value repeats.
 *
 * Asymmetric on purpose. The first segment is optimized for *starting* — the
 * only thing that matters is that sound begins, and "Tenés 47 ventas hoy,"
 * is enough. Later segments are optimized for *prosody*: cutting every 40
 * characters sounds clipped and multiplies provider calls, and by then there is
 * buffered audio hiding their latency. One target cannot serve both ends.
 *
 * Safe without speculation: a text stream only ever appends, so the first 40
 * characters never change once seen. There is nothing to roll back.
 */
export const SEGMENT_TARGETS = [40, 120, 250, 400] as const;

/**
 * How far past the target a *complete sentence* is still allowed to travel
 * whole. Cutting mid-sentence to honour a character budget costs more in
 * prosody than the budget buys in latency.
 */
export const SENTENCE_TOLERANCE = 1.4;

/**
 * A cut is only worth taking if it lands past this fraction of the target.
 * Below it, a clause or space boundary would produce a segment so short that
 * the seam is more audible than the wait it saved.
 */
export const MIN_CUT_FRACTION = 0.5;

/** How many synthesis jobs may be in flight at once for one turn. */
export const SYNTHESIS_PREFETCH_DEPTH = 3;

/**
 * Human filler, spoken while the real answer is still being produced.
 *
 * This is a latency mechanism first and a personality choice second. Synthesized
 * once and served from cache, it starts at ~0 ms and covers the whole
 * STT + LLM + first-TTS window — which is the only way the pipeline can beat
 * speech-to-speech on *perceived* latency, since even S2S has to think before
 * it emits its first phoneme.
 *
 * It is also the answer to a turn that produces nothing speakable. A turn that
 * only ran tools must not say "no hay nada para leer": it says "listo, ya lo
 * tengo" like a person would.
 *
 * Short on purpose: a filler longer than the wait it covers becomes the wait.
 *
 * Colombian register, not neutral Spanish. This is the one thing Vexi says that
 * carries no information at all, so its only job is to sound like a person from
 * the same place as the listener — "dame un momentico" and "ya mismo te digo"
 * do that, "aguarda un instante" does not. The bank had `dejame`, a voseo form
 * that reads as Rioplatense; corrected to `déjame`.
 *
 * Fourteen rather than eight because the rotation only forbids the *immediate*
 * repeat: with eight, a person who asks six things in a row hears most of the
 * bank and starts recognising it. Each phrase costs one synthesis, once, on the
 * first warm pass.
 */
export const VOICE_FILLERS = [
  'Mmm, dame un segundo.',
  'A ver…',
  'Déjame revisar.',
  'Ya voy con eso.',
  'Un momento.',
  'Listo, ya lo tengo.',
  'Ajá, déjame ver.',
  'Voy a mirarlo.',
  'Ok, te entiendo.',
  'Ok, vamos a revisar esto.',
  'Claro, dame un momentico.',
  'Bueno, veamos.',
  'Ya mismo te digo.',
  'Listo, dame un segundito.',
] as const;

/**
 * Grace period before a filler is played. If the first real segment arrives
 * inside this window the filler is skipped entirely — playing it anyway would
 * delay the actual answer to say something that carries no information.
 */
export const FILLER_GRACE_MS = 250;

/**
 * Spoken name of a currency, by ISO code.
 *
 * A synthesizer handed "$1.500.000" reads a symbol, and handed "COP" reads three
 * letters: "ce-o-pe". Neither is what a shopkeeper says. The listener needs the
 * word, and the word depends on the store — the same amount is "pesos" in Bogotá
 * and "soles" in Lima.
 *
 * Plural because the amount is what precedes it and amounts are almost never
 * one. An unmapped code falls back to the code itself: the synthesizer will
 * spell it out, which is wrong but honest, and far better than guessing "pesos"
 * for a currency that is not.
 */
export const CURRENCY_SPOKEN_WORDS: Record<string, string> = {
  COP: 'pesos',
  USD: 'dólares',
  EUR: 'euros',
  MXN: 'pesos',
  ARS: 'pesos',
  CLP: 'pesos',
  UYU: 'pesos',
  DOP: 'pesos',
  PEN: 'soles',
  BRL: 'reales',
  BOB: 'bolivianos',
  GTQ: 'quetzales',
  CRC: 'colones',
  PAB: 'balboas',
  PYG: 'guaraníes',
  VES: 'bolívares',
};

/** Currency assumed when the store has none resolved. Vendix is CO-first. */
export const DEFAULT_SPOKEN_CURRENCY = 'COP';

/**
 * Prompt block injected only when the turn is going to be dictated.
 *
 * A conditional block rather than a second `system_prompt` for voice, so there
 * stays exactly one Vexi. Two prompts would diverge — the persona, the tool
 * rules and the tenant guardrails would have to be maintained twice, and the
 * copy that gets edited less would quietly become a different assistant.
 *
 * The first rule is the one that is not about style. The first audio segment is
 * cut at ~40 characters (see `SEGMENT_TARGETS`), so an answer that opens with
 * "Según los datos de tu tienda…" spends its entire opening segment on a
 * preamble and the listener waits a full extra synthesis round trip to hear the
 * number. Leading with the datum is worth hundreds of milliseconds of perceived
 * latency, which is why it sits at the top rather than among the niceties.
 *
 * Reaches the model only if the application's stored `system_prompt` contains
 * the matching `{{speech_register}}` placeholder — `interpolate()` leaves an
 * unmatched placeholder verbatim, so the key must exist on every snapshot even
 * when it is empty, or the template syntax leaks into the prompt.
 */
export const SPEECH_REGISTER_BLOCK = `## Registro hablado (este turno se dicta en voz alta)

La persona te está ESCUCHANDO, no leyendo. Eso cambia cómo respondes:

- Empieza por el dato, nunca por el preámbulo. "Tienes 47 ventas hoy" arranca antes que "Según los datos de tu tienda, hoy registras…". Esto es latencia, no estilo: el primer trozo de audio se corta a unos 40 caracteres, así que el dato tiene que caber ahí.
- Sin markdown de ningún tipo: nada de asteriscos, listas numeradas o con guiones, tablas, encabezados, bloques de código ni emojis. Nada de eso se oye, solo estorba.
- Frases cortas, una idea por frase. Tres frases como máximo, salvo que te pidan detalle explícitamente.
- Nunca digas "como ves en la tabla", "en la lista", "arriba" ni "abajo": quien te escucha no está viendo nada.
- Si hay muchos ítems, di el total y los dos o tres que importan, y ofrece el resto. No dictes catálogos.
- Los montos en lenguaje natural, con la moneda de la tienda.
- Si vas a pedir una confirmación, dila en una sola frase y termina preguntando.`;

/**
 * Digits below which an unseparated integer is left alone.
 *
 * Four is the threshold because that is where a synthesizer stops reading a
 * number as a quantity: "1500" often comes out as "mil quinientos" but "1500000"
 * comes out as a digit stream. Grouping it into "1.500.000" is what makes it a
 * number again. Below four there is nothing to group.
 */
export const MIN_GROUPED_DIGITS = 4;

/** Upper bound on one uploaded audio turn, before base64 expansion. */
export const MAX_TURN_AUDIO_BYTES = 8 * 1024 * 1024;

/** Upper bound on one streamed chunk of a turn still being recorded. */
export const MAX_CHUNK_BYTES = 1 * 1024 * 1024;

/**
 * How long a partially-uploaded turn survives without new chunks. A turn the
 * user abandoned mid-recording must not hold memory until the process restarts.
 */
export const CHUNK_BUFFER_TTL_MS = 60_000;

/** Containers the transcription endpoint accepts, by upload MIME type. */
export const ALLOWED_AUDIO_MIME_TYPES: Record<string, string> = {
  'audio/webm': 'webm',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'mp4',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

/** Language handed to the transcription model. Explicit beats inferred. */
export const TRANSCRIPTION_LANGUAGE = 'es';

/** Entry and byte ceilings for the synthesis cache. */
export const SPEECH_CACHE_MAX_ENTRIES = 200;
export const SPEECH_CACHE_MAX_BYTES = 64 * 1024 * 1024;
