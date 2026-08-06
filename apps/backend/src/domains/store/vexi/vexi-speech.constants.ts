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
 */
export const VOICE_FILLERS = [
  'Mmm, dame un segundo.',
  'A ver…',
  'Déjame revisar.',
  'Ya voy con eso.',
  'Un momento.',
  'Listo, ya lo tengo.',
  'Ajá, dejame ver.',
  'Voy a mirarlo.',
] as const;

/**
 * Grace period before a filler is played. If the first real segment arrives
 * inside this window the filler is skipped entirely — playing it anyway would
 * delay the actual answer to say something that carries no information.
 */
export const FILLER_GRACE_MS = 250;

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
