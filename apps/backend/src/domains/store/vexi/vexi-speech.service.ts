import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { SettingsService } from '../settings/settings.service';
import { VexiSpeechCache, CachedAudio } from './vexi-speech.cache';
import { VexiSpeechSegmenter, hasWordCharacter } from './vexi-speech.segmenter';
import {
  VexiSpeechTurn,
  type LostSegment,
  type SynthesisLoss,
  type VexiAudioFrame,
  type VoiceMeter,
} from './vexi-speech.pipeline';
import { stripMarkdownForSpeech } from './vexi-speech.markdown';
import type { SpeechCacheParams } from './vexi-speech.cache';
import { estimateSpeechSeconds } from './vexi-speech.duration';
import { agentVoiceFromSpeechMetadata } from '../../../ai-engine/agent-runtime-config.service';
import {
  CURRENCY_SPOKEN_WORDS,
  DEFAULT_SPOKEN_CURRENCY,
  DEFAULT_SYNTHESIS_CONCURRENCY,
  MAX_RETRY_AFTER_MS,
  MAX_SYNTHESIS_CONCURRENCY,
  MIN_GROUPED_DIGITS,
  SYNTHESIS_RETRY_DELAYS_MS,
  VOICE_FILLERS,
  VOICE_TTS_APP_KEY,
} from './vexi-speech.constants';

/**
 * Defaults matching the seeded `vexi_voice_tts` metadata, used when the row is
 * missing or an operator cleared a field. Kept here rather than inlined so the
 * cache key is stable across both paths — a key built from `undefined` would
 * miss every entry the warm pass created.
 */
const DEFAULT_SPEECH_PARAMS: SpeechCacheParams = {
  model: 'gpt-4o-mini-tts',
  voice: 'shimmer',
  format: 'mp3',
  speed: 1,
  // 1 es «sin cambio», el default del proveedor. El 1.5 que pidió producción
  // vive en la metadata sembrada de `vexi_voice_tts`, no acá: este objeto es el
  // respaldo para cuando la fila falta, y un respaldo que sube el volumen
  // escondería que la configuración real no se pudo leer.
  vol: 1,
};

/**
 * One synthesized segment plus what the voice quota needs (T14).
 *
 * `generated` is true only when the provider was actually called: a cache hit
 * costs nothing and does not count. `seconds` is the duration of the audio,
 * read from its bytes (see `estimateSpeechSeconds`).
 */
export interface SynthesizedAudio extends CachedAudio {
  generated: boolean;
  seconds: number;
}

/** Options of a spoken turn (T14). */
export interface SpeechTurnOptions {
  /** Agent whose voice reads the answer (`metadata.speech.agent_voices`). */
  agentKey?: string | null;
  /** Called once per generated segment, for the per-agent voice quota. */
  meter?: VoiceMeter;
}

export { stripMarkdownForSpeech };

/**
 * Failure messages that mean "try again shortly" when the provider gave no
 * HTTP status: network errors, timeouts, rate limits worded in the body, and
 * a 200 that carried no audio (an empty body is not a verdict on the text).
 * Anything else (bad voice, bad key, unknown model) fails the same on retry.
 */
const TRANSIENT_SPEECH_MESSAGE =
  /returned no audio|rate.?limit|too many requests|\b429\b|\b5\d\d\b|timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|fetch failed|overloaded|temporarily|unavailable/i;

/**
 * Whether a failed synthesis is worth retrying. The HTTP status decides when
 * there is one (408, 425, 429, 5xx); otherwise the message does.
 */
export function isTransientSpeechError(
  message: string,
  statusCode?: number,
): boolean {
  if (statusCode !== undefined) {
    return (
      statusCode === 408 ||
      statusCode === 425 ||
      statusCode === 429 ||
      statusCode >= 500
    );
  }
  return TRANSIENT_SPEECH_MESSAGE.test(message);
}

/** Result of synthesizing a whole message on demand («Escuchar»). */
export interface SynthesizedText {
  frames: VexiAudioFrame[];
  /** False when a segment was lost: the frames are a fragment of the text. */
  complete: boolean;
  lost: LostSegment[];
}

/** Outcome of one provider call, after its retries. */
type ProviderResult =
  | { ok: true; audio: CachedAudio }
  | { ok: false; reason: string };

/** One failed attempt, classified. */
interface FailedAttempt {
  reason: string;
  transient: boolean;
  retryAfterMs?: number;
}

/** Inserts thousands separators into a bare digit run: 1500000 → 1.500.000 */
function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Rewrites amounts and long numbers the way a person would say them.
 *
 * Audio branch only, like the markdown strip: the reader wants "$1.500.000"
 * because it is scannable, and the listener needs "1.500.000 pesos" because a
 * synthesizer handed a dollar sign reads a symbol and handed "1500000" reads a
 * digit stream — "uno cinco cero cero cero cero cero". Same answer, two renderings.
 *
 * The currency word comes from the store, resolved once per turn, because "$" is
 * not a currency: it is pesos in Bogotá and dollars in Miami, and the store is
 * the only thing that knows which.
 *
 * Deliberately conservative on three fronts, because a wrong rewrite is worse
 * than none:
 *
 * - Only integers of 4+ digits are grouped, and only when nothing word-like,
 *   dotted, comma'd or hyphenated touches them. That guard is what keeps a SKU
 *   like QA-1234567, a NIT, an order id or a phone number from being read out as
 *   a quantity.
 * - A number that already carries a decimal separator is left completely alone.
 *   Grouping its integer part would produce "1.500.50", which is neither a
 *   number nor an amount in any locale.
 * - Percent becomes the word because "%" next to a grouped number is where
 *   synthesizers most often lose the thread.
 */
export function localizeNumbersForSpeech(
  text: string,
  currency: string = DEFAULT_SPOKEN_CURRENCY,
): string {
  const code = (currency || DEFAULT_SPOKEN_CURRENCY).toUpperCase();
  const word = CURRENCY_SPOKEN_WORDS[code] ?? code;

  // Codes are ISO letters, so they need no escaping in the patterns below.
  const before = new RegExp(`(?:\\$|\\b${code}\\b)\\s*(\\d[\\d.,]*)`, 'gi');
  const after = new RegExp(`(\\d[\\d.,]*)\\s*\\b${code}\\b`, 'gi');

  return (
    text
      // "$1.500.000" / "COP 1.500.000" → the amount, then the word. Spanish puts
      // the currency after the number when spoken, whatever the writing did.
      .replace(before, `$1 ${word}`)
      // "1.500.000 COP" → same, without duplicating the word.
      .replace(after, `$1 ${word}`)
      // A symbol with no amount attached still must not be dictated as a symbol.
      .replace(/\$/g, word)
      .replace(
        new RegExp(`(?<![\\w.,-])(\\d{${MIN_GROUPED_DIGITS},})(?![\\w.,-])`, 'g'),
        (_match, digits: string) => groupThousands(digits),
      )
      .replace(/(\d)\s*%/g, '$1 por ciento')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

@Injectable()
export class VexiSpeechService {
  private readonly logger = new Logger(VexiSpeechService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly cache: VexiSpeechCache,
    private readonly settings: SettingsService,
  ) {}

  /** One segmenter per turn — the budget grows with the segments emitted. */
  createSegmenter(): VexiSpeechSegmenter {
    return new VexiSpeechSegmenter();
  }

  /**
   * Opens a spoken turn: a segmenter, the operator's voice params, and the
   * bounded synthesis queue that runs alongside the text stream.
   *
   * The params query happens here, once, rather than per segment — they only
   * change when somebody edits the application in Super Admin, and a round trip
   * on the critical path of every segment would cost more than the cache saves.
   */
  async openTurn(
    startedAt: number = Date.now(),
    options: SpeechTurnOptions = {},
  ): Promise<VexiSpeechTurn> {
    // Both resolved here and once: the voice params and the store's currency
    // change only when somebody edits a setting, and either query on the
    // critical path of every segment would cost more than the cache saves.
    // Concurrent because they hit different tables and neither needs the other.
    const [params, currency, concurrency] = await Promise.all([
      this.resolveParams(options.agentKey),
      this.resolveCurrency(),
      this.resolveSynthesisConcurrency(),
    ]);
    return new VexiSpeechTurn(
      this,
      params,
      startedAt,
      currency,
      options.meter,
      concurrency,
    );
  }

  /**
   * How many segments of one turn may be synthesizing at once, read from
   * `vexi_voice_tts.metadata.speech.max_concurrency` (integer 1–8). That app is
   * the one every spoken turn runs through — also when a catalog voice (Gemini
   * via OpenRouter, MiniMax…) does the synthesis — so the knob is the same for
   * every provider. A missing, invalid or unreadable value means 1.
   */
  async resolveSynthesisConcurrency(): Promise<number> {
    let limit = DEFAULT_SYNTHESIS_CONCURRENCY;
    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: VOICE_TTS_APP_KEY },
        select: { metadata: true },
      });
      const raw = (
        (app?.metadata as Record<string, any> | null)?.speech as
          | Record<string, any>
          | undefined
      )?.max_concurrency;
      const parsed = Number(raw);
      if (
        raw !== null &&
        raw !== undefined &&
        raw !== '' &&
        Number.isInteger(parsed) &&
        parsed >= 1
      ) {
        limit = Math.min(parsed, MAX_SYNTHESIS_CONCURRENCY);
      }
    } catch (error) {
      this.logger.warn(
        `Synthesis concurrency unreadable; using ${DEFAULT_SYNTHESIS_CONCURRENCY}: ${(error as Error).message}`,
      );
    }
    return limit;
  }

  /**
   * The store's currency code, for the spoken rendering of amounts.
   *
   * Falls back to the CO default rather than throwing: a turn must not lose its
   * voice because a settings lookup failed, and the fallback only ever changes
   * which *word* follows an amount, never the amount itself.
   */
  async resolveCurrency(): Promise<string> {
    try {
      return (await this.settings.getStoreCurrency()) || DEFAULT_SPOKEN_CURRENCY;
    } catch (error) {
      this.logger.warn(
        `Falling back to ${DEFAULT_SPOKEN_CURRENCY} for spoken amounts: ${(error as Error).message}`,
      );
      return DEFAULT_SPOKEN_CURRENCY;
    }
  }

  /**
   * Reads the voice, format and speed an operator configured.
   *
   * Called once per turn, not once per segment: the values only change when
   * somebody edits the application in Super Admin, and a query on the critical
   * path of every segment would spend more time than the cache saves.
   *
   * With `agentKey` (T15), the agent's own voice in
   * `metadata.speech.agent_voices[agentKey]` wins over the shared one; an
   * invalid override value falls back to the shared value, field by field.
   */
  async resolveParams(agentKey?: string | null): Promise<SpeechCacheParams> {
    try {
      const profile = agentKey ? await this.resolveVoiceProfile(agentKey) : null;

      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: VOICE_TTS_APP_KEY },
        select: {
          metadata: true,
          config: { select: { model_id: true, provider: true } },
        },
      });

      const speech =
        ((app?.metadata as Record<string, any> | null)?.speech as
          | Record<string, any>
          | undefined) ?? {};

      // F8 T49 — single source: the catalog voice assigned to the agent wins
      // whole (voice, provider, model). `metadata.speech` below is only the
      // read-only fallback for an agent with no profile, plus the format,
      // which is a property of the playback path and not of a voice.
      if (profile) {
        return {
          model: profile.model,
          voice: profile.voice,
          format:
            this.text(speech.response_format) ?? DEFAULT_SPEECH_PARAMS.format,
          speed:
            profile.speed ??
            this.positive(speech.speed) ??
            DEFAULT_SPEECH_PARAMS.speed,
          vol:
            profile.vol ??
            this.positive(speech.vol) ??
            DEFAULT_SPEECH_PARAMS.vol,
          configId: profile.configId,
          ...(profile.provider ? { provider: profile.provider } : {}),
        };
      }

      const own = agentKey ? agentVoiceFromSpeechMetadata(speech, agentKey) : {};

      return {
        model: app?.config?.model_id || DEFAULT_SPEECH_PARAMS.model,
        voice:
          this.text(own.voice) ??
          this.text(speech.voice) ??
          DEFAULT_SPEECH_PARAMS.voice,
        format:
          this.text(speech.response_format) ?? DEFAULT_SPEECH_PARAMS.format,
        speed:
          this.positive(own.speed) ??
          this.positive(speech.speed) ??
          DEFAULT_SPEECH_PARAMS.speed,
        vol:
          this.positive(own.vol) ??
          this.positive(speech.vol) ??
          DEFAULT_SPEECH_PARAMS.vol,
        ...(this.text(app?.config?.provider)
          ? { provider: this.text(app?.config?.provider)! }
          : {}),
      };
    } catch (error) {
      // A voice turn must not die because the config lookup failed; the
      // defaults match the seed and the synthesis itself will report a real
      // misconfiguration.
      this.logger.warn(
        `Falling back to default speech params: ${(error as Error).message}`,
      );
      return DEFAULT_SPEECH_PARAMS;
    }
  }

  /**
   * F8 T49 — the catalog voice a super admin assigned to this agent, or null.
   *
   * Null on every doubt (no profile, profile or provider turned off, lookup
   * failed): the caller then reads with the fallback voice instead of going
   * silent. Vex and Vexi each read their own row, so assigning one never
   * moves the other.
   */
  private async resolveVoiceProfile(agentKey: string): Promise<{
    configId: number;
    model: string;
    provider?: string;
    voice: string;
    speed: number | null;
    vol: number | null;
  } | null> {
    try {
      const agent = await this.prisma.ai_agents.findUnique({
        where: { key: agentKey },
        select: {
          voice_profile: {
            select: {
              voice_id: true,
              speed: true,
              vol: true,
              is_active: true,
              config: {
                select: {
                  id: true,
                  model_id: true,
                  is_active: true,
                  provider: true,
                },
              },
            },
          },
        },
      });
      const profile = agent?.voice_profile;
      const voice = this.text(profile?.voice_id);
      if (!profile || !profile.is_active || !profile.config?.is_active || !voice) {
        return null;
      }
      return {
        configId: profile.config.id,
        model: profile.config.model_id,
        provider: this.text(profile.config.provider) ?? undefined,
        voice,
        speed: this.positive(profile.speed),
        vol: this.positive(profile.vol),
      };
    } catch (error) {
      this.logger.warn(
        `Voice profile lookup failed for ${agentKey}; using the fallback voice: ${(error as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Synthesizes one segment, serving a cache hit when there is one.
   *
   * Never throws. Returns null when the text has nothing speakable in it, and
   * a `SynthesisLoss` (with the reason) when the provider still failed after
   * its retries, so the turn can record the lost segment and keep reading the
   * rest; throwing here would take the whole SSE turn down, captions included.
   */
  async synthesize(
    rawText: string,
    params: SpeechCacheParams,
    currency?: string,
  ): Promise<SynthesizedAudio | SynthesisLoss | null> {
    // Order matters: the markdown strip has to run first because it is what
    // removes the list marker "1. ", and the number pass would otherwise see the
    // "1" as a quantity. The strip's own comment already flags that the trailing
    // space is what tells "1. " apart from the amount "1.500".
    const spoken = localizeNumbersForSpeech(
      stripMarkdownForSpeech(rawText),
      currency,
    );

    // A segment that was only markers cleans down to nothing. Sending it would
    // either error or synthesize a noise.
    if (!spoken || !hasWordCharacter(spoken)) return null;

    const key = this.cache.key(spoken, params);
    const hit = this.cache.get(key);
    if (hit) return { ...hit, generated: false, seconds: 0 };

    const result = await this.callProvider(spoken, params);
    if (!result.ok) return { lost: true, reason: result.reason };
    const audio = result.audio;
    this.cache.set(key, audio);
    // Measured here, at synthesis (§3.7): the only place that knows a provider
    // call produced audio. Cache hits above are free and never counted.
    return {
      ...audio,
      generated: true,
      seconds: estimateSpeechSeconds(
        audio.audioBase64,
        audio.contentType,
        spoken,
        params.speed,
      ),
    };
  }

  /**
   * Synthesizes a full message on demand into ordered audio segments, reusing
   * the exact same segmenter and synthesis cache as streaming voice turns.
   *
   * Because `VexiSpeechCache` keys on `(spokenText, params)` — never on turn
   * index — clicking «Escuchar» on a message already spoken in voice mode (or
   * previously listened to) hits the cache for every segment with zero provider
   * calls.
   *
   * `options` carries the agent voice and the quota meter, exactly as a
   * streaming turn does; without them the turn uses the shared voice and is
   * not metered.
   */
  async synthesizeText(
    rawText: string,
    options?: SpeechTurnOptions,
  ): Promise<SynthesizedText> {
    const trimmed = (rawText ?? '').trim();
    if (!trimmed) return { frames: [], complete: true, lost: [] };

    const turn = await this.openTurn(Date.now(), options);
    // The whole text is pushed at once, so the markdown filter sees every
    // construct complete before anything is cut.
    turn.push(trimmed);
    turn.flush();

    const frames: VexiAudioFrame[] = [];
    for await (const frame of turn.settleOrdered()) {
      frames.push(frame);
    }
    return {
      frames,
      complete: turn.isComplete(),
      lost: turn.lostSegments(),
    };
  }

  /**
   * Synthesizes the filler bank once and pins it.
   *
   * Idempotent: a second call is free because every phrase is already pinned.
   * Worth calling when a voice session opens rather than lazily on first use —
   * the first turn is the one the user judges, and a filler that has to be
   * synthesized on demand defeats its entire purpose.
   */
  async warmFillers(): Promise<{ synthesized: number; alreadyWarm: number }> {
    const params = await this.resolveParams();
    let synthesized = 0;
    let alreadyWarm = 0;

    for (const phrase of VOICE_FILLERS) {
      const key = this.cache.key(phrase, params);
      if (this.cache.hasPinned(key)) {
        alreadyWarm++;
        continue;
      }

      const result = await this.callProvider(phrase, params);
      if (result.ok) {
        this.cache.pin(key, result.audio);
        synthesized++;
      }
    }

    return { synthesized, alreadyWarm };
  }

  /**
   * Picks a filler at random, never the one just used.
   *
   * Repetition is what makes filler read as a tic instead of as a person
   * thinking, so excluding the immediate repeat is the requirement. It used to
   * walk the bank in order from the previous index, which was reproducible but
   * produced a fixed cycle: hear it four times and you know what comes fifth.
   * Random-excluding-previous is what makes the bank feel like a person with
   * fourteen ways of stalling instead of a carousel.
   *
   * Tests assert the properties, not a sequence — no consecutive repeat over N
   * calls, and enough distinct phrases to prove the pool is really being used.
   */
  pickFiller(previous?: string | null): string {
    const bank = VOICE_FILLERS;
    const pool = previous ? bank.filter((phrase) => phrase !== previous) : bank;
    // A bank of one, or a `previous` that is no longer in the bank, must still
    // answer with something speakable.
    const candidates = pool.length ? pool : bank;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /**
   * The filler each conversation heard last, so the next turn can avoid it.
   *
   * In-process and bounded rather than in Redis on purpose. This value is read
   * on the one path whose entire reason to exist is being instant — the filler
   * covers the STT + LLM window precisely because it costs zero — and spending a
   * network round trip there to protect against a *cosmetic* repeat would trade
   * the mechanism for the thing it prevents. With several backend instances the
   * worst case is one repeated phrase, which is exactly the state before this
   * existed.
   */
  private readonly lastFillerByConversation = new Map<number, string>();

  /** Bound on the map above. Each entry is one short string keyed by an int. */
  private static readonly FILLER_MEMORY_LIMIT = 500;

  lastFiller(conversationId: number): string | null {
    return this.lastFillerByConversation.get(conversationId) ?? null;
  }

  rememberFiller(conversationId: number, phrase: string | null): void {
    if (!phrase) return;

    // Oldest-first eviction: `Map` iterates in insertion order, so the first key
    // is the least recently *added*. Re-setting an existing key does not refresh
    // that order, which is fine — this is a repeat guard, not a cache, and losing
    // an old conversation's last phrase costs at most one audible repeat.
    if (
      this.lastFillerByConversation.size >=
        VexiSpeechService.FILLER_MEMORY_LIMIT &&
      !this.lastFillerByConversation.has(conversationId)
    ) {
      const oldest = this.lastFillerByConversation.keys().next().value;
      if (oldest !== undefined) this.lastFillerByConversation.delete(oldest);
    }

    this.lastFillerByConversation.set(conversationId, phrase);
  }

  /** Cached audio for a filler, or null when the bank was never warmed. */
  async fillerAudio(
    phrase: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null> {
    const key = this.cache.key(phrase, params);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const result = await this.callProvider(phrase, params);
    if (!result.ok) return null;
    this.cache.pin(key, result.audio);
    return result.audio;
  }

  /** Overridable in specs so retries do not wait real time. */
  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * One provider call, retried with a short backoff when the failure is
   * transient (see `isTransientSpeechError`); a provider `Retry-After` is
   * honoured up to `MAX_RETRY_AFTER_MS`. Never throws: the reason of the last
   * failure comes back so the caller records the lost segment instead of
   * dropping it silently.
   */
  private async callProvider(
    text: string,
    params: SpeechCacheParams,
  ): Promise<ProviderResult> {
    for (let attempt = 0; ; attempt++) {
      const outcome = await this.attemptProvider(text, params);
      if ('audio' in outcome) return { ok: true, audio: outcome.audio };
      const failure = outcome;

      const backoff = SYNTHESIS_RETRY_DELAYS_MS[attempt];
      if (!failure.transient || backoff === undefined) {
        this.logger.warn(
          `Speech synthesis failed after ${attempt + 1} attempt(s): ${failure.reason}`,
        );
        return { ok: false, reason: failure.reason };
      }
      const delay = Math.max(
        backoff,
        Math.min(failure.retryAfterMs ?? 0, MAX_RETRY_AFTER_MS),
      );
      this.logger.warn(
        `Speech synthesis transient failure (attempt ${attempt + 1}), retrying in ${delay} ms: ${failure.reason}`,
      );
      await this.wait(delay);
    }
  }

  private async attemptProvider(
    text: string,
    params: SpeechCacheParams,
  ): Promise<FailedAttempt | { audio: CachedAudio }> {
    try {
      const response = await this.aiEngine.runSpeech(
        VOICE_TTS_APP_KEY,
        // The application's whole template is `{{text}}`, so this variable is
        // the entire utterance. See the seed comment on why `system_prompt`
        // must stay null: anything there would be read aloud first.
        { text },
        {
          voice: params.voice,
          responseFormat: params.format,
          speed: params.speed,
          // Se manda explícito en vez de dejar que el proveedor lo lea de su
          // config: así el valor que viaja es EL MISMO que entró en la clave de
          // caché, y una entrada nunca puede describir un volumen distinto del
          // que realmente se sintetizó.
          vol: params.vol,
          // Only with a catalog voice: its model belongs to its provider. The
          // fallback path keeps letting the app decide the model, as before.
          ...(params.configId ? { model: params.model } : {}),
        },
        ...(params.configId ? [{ configId: params.configId }] : []),
      );

      if (response.success && response.audioBase64) {
        return {
          audio: {
            audioBase64: response.audioBase64,
            contentType: response.contentType || `audio/${params.format}`,
          },
        };
      }
      const reason =
        response.error ??
        (response.success ? 'provider returned no audio' : 'no audio returned');
      return {
        reason: response.statusCode
          ? `${response.statusCode}: ${reason}`
          : reason,
        transient: isTransientSpeechError(reason, response.statusCode),
        retryAfterMs: response.retryAfterMs,
      };
    } catch (error) {
      // `runSpeech` throws its own gates (app rate limit = 429, inactive app);
      // a VendixHttpException carries the status, a network error does not.
      const status = (error as { getStatus?: () => number }).getStatus?.();
      const reason = (error as Error).message || 'synthesis threw';
      return {
        reason: status ? `${status}: ${reason}` : reason,
        transient: isTransientSpeechError(reason, status),
      };
    }
  }

  private text(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private positive(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
}
