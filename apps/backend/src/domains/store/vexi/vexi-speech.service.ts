import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { VexiSpeechCache, CachedAudio } from './vexi-speech.cache';
import { VexiSpeechSegmenter, hasWordCharacter } from './vexi-speech.segmenter';
import { VexiSpeechTurn } from './vexi-speech.pipeline';
import type { SpeechCacheParams } from './vexi-speech.cache';
import {
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
 * Strips markdown so the synthesizer receives prose.
 *
 * Runs on the audio branch only, and per emitted segment rather than over the
 * buffer: fenced blocks and links need their full pattern, and a half-arrived
 * one would be mangled. Captions and history keep whatever the chat produced —
 * the reader wants the formatting, the listener cannot hear it.
 *
 * Deletion rather than pairing for the emphasis markers: an unclosed `**` at a
 * segment boundary is normal, and no asterisk is ever spoken, so removing them
 * unconditionally is both simpler and more robust than tracking pairs.
 */
export function stripMarkdownForSpeech(text: string): string {
  return (
    text
      // Code is not prose. Reading it aloud is never what the listener wanted.
      .replace(/```[\s\S]*?```/g, ' ')
      // Keep the label, drop the target — nobody wants a URL dictated.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      // A table separator row is pure layout.
      .replace(/^\s*\|[-:\s|]*\|\s*$/gm, ' ')
      // Remaining pipes separate cells; a space reads as the pause they imply.
      .replace(/\|/g, ' ')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      // The trailing space is load-bearing in both list patterns: it is what
      // distinguishes the marker "1. " from the amount "1.500".
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '')
      .replace(/[*_`~]/g, '')
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
  async openTurn(startedAt: number = Date.now()): Promise<VexiSpeechTurn> {
    const params = await this.resolveParams();
    return new VexiSpeechTurn(this, params, startedAt);
  }

  /**
   * Reads the voice, format and speed an operator configured.
   *
   * Called once per turn, not once per segment: the values only change when
   * somebody edits the application in Super Admin, and a query on the critical
   * path of every segment would spend more time than the cache saves.
   */
  async resolveParams(): Promise<SpeechCacheParams> {
    try {
      const app = await this.prisma.ai_engine_applications.findUnique({
        where: { key: VOICE_TTS_APP_KEY },
        select: { metadata: true, config: { select: { model_id: true } } },
      });

      const speech =
        ((app?.metadata as Record<string, any> | null)?.speech as
          | Record<string, any>
          | undefined) ?? {};

      return {
        model: app?.config?.model_id || DEFAULT_SPEECH_PARAMS.model,
        voice: this.text(speech.voice) ?? DEFAULT_SPEECH_PARAMS.voice,
        format:
          this.text(speech.response_format) ?? DEFAULT_SPEECH_PARAMS.format,
        speed: this.positive(speech.speed) ?? DEFAULT_SPEECH_PARAMS.speed,
        vol: this.positive(speech.vol) ?? DEFAULT_SPEECH_PARAMS.vol,
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
   * Synthesizes one segment, serving a cache hit when there is one.
   *
   * Returns null — never throws — when the text has nothing speakable in it or
   * the provider failed. A failed synthesis degrades the turn to text-only,
   * which is a worse voice experience but still a correct answer; throwing here
   * would take the whole SSE turn down with it, captions included.
   */
  async synthesize(
    rawText: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null> {
    const spoken = stripMarkdownForSpeech(rawText);

    // A segment that was only markers cleans down to nothing. Sending it would
    // either error or synthesize a noise.
    if (!spoken || !hasWordCharacter(spoken)) return null;

    const key = this.cache.key(spoken, params);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const audio = await this.callProvider(spoken, params);
    if (audio) this.cache.set(key, audio);
    return audio;
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

      const audio = await this.callProvider(phrase, params);
      if (audio) {
        this.cache.pin(key, audio);
        synthesized++;
      }
    }

    return { synthesized, alreadyWarm };
  }

  /**
   * Picks a filler, never the one just used.
   *
   * Repetition is what makes filler read as a tic instead of as a person
   * thinking, so avoiding the immediate repeat matters more than true
   * randomness. The rotation is derived from the previous phrase rather than
   * from a random source so the choice is reproducible in tests.
   */
  pickFiller(previous?: string | null): string {
    const bank = VOICE_FILLERS;
    const previousIndex = previous ? bank.indexOf(previous as any) : -1;
    if (previousIndex < 0) return bank[0];
    return bank[(previousIndex + 1) % bank.length];
  }

  /** Cached audio for a filler, or null when the bank was never warmed. */
  async fillerAudio(
    phrase: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null> {
    const key = this.cache.key(phrase, params);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const audio = await this.callProvider(phrase, params);
    if (audio) this.cache.pin(key, audio);
    return audio;
  }

  private async callProvider(
    text: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null> {
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
        },
      );

      if (!response.success || !response.audioBase64) {
        this.logger.warn(
          `Speech synthesis failed: ${response.error ?? 'no audio returned'}`,
        );
        return null;
      }

      return {
        audioBase64: response.audioBase64,
        contentType: response.contentType || `audio/${params.format}`,
      };
    } catch (error) {
      this.logger.warn(`Speech synthesis threw: ${(error as Error).message}`);
      return null;
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
