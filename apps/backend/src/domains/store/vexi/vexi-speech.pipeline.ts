import { Logger } from '@nestjs/common';
import { SYNTHESIS_PREFETCH_DEPTH } from './vexi-speech.constants';
import { VexiSpeechSegmenter } from './vexi-speech.segmenter';
import type { CachedAudio, SpeechCacheParams } from './vexi-speech.cache';

/**
 * One synthesized piece of the answer.
 *
 * `index` is the playback order, claimed when the segment is cut — not when its
 * audio arrives. Synthesis completes out of order (a four-word segment beats a
 * forty-word one), so without an index assigned at cut time the listener would
 * hear the answer shuffled.
 */
export interface VexiAudioFrame {
  type: 'audio';
  index: number;
  audio_base64: string;
  content_type: string;
  /**
   * True for the human filler that covers the thinking window. The client needs
   * to tell them apart: a filler may be dropped if real content somehow beat it,
   * and it must never be written into the captions as part of the answer.
   */
  filler?: boolean;
}

/**
 * A latency measurement, in milliseconds from the moment the stream opened.
 *
 * Only the marks the server can actually observe. `release→text` and
 * `audio_playing` are deliberately absent: the server does not know when the mic
 * button came up, nor when a buffer reached the speaker. The client owns those
 * two and joins them to these by turn.
 */
export interface VexiTimingFrame {
  type: 'timing';
  mark: TimingMark;
  ms: number;
}

export type TimingMark =
  | 'first_token'
  | 'first_segment'
  | 'first_audio'
  | 'last_audio';

export type VexiVoiceFrame = VexiAudioFrame | VexiTimingFrame;

/**
 * The subset of `VexiSpeechService` a turn needs.
 *
 * Declared as an interface rather than importing the service so the orchestration
 * can be tested against a stub, and so there is no import cycle between the
 * service that creates turns and the turn that calls back into it.
 */
export interface SpeechSource {
  synthesize(
    text: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null>;
  pickFiller(previous?: string | null): string;
  fillerAudio(
    phrase: string,
    params: SpeechCacheParams,
  ): Promise<CachedAudio | null>;
}

interface QueuedSegment {
  index: number;
  text: string;
}

/**
 * Synthesizes one spoken turn *alongside* the text stream instead of inside it.
 *
 * The shape matters. Synthesizing in line — `await` a segment's audio before
 * emitting the next token — would make the voice mode slower than the chat: the
 * captions would arrive behind the audio they describe. So the jobs run loose and
 * drop their results into a tray, and the text loop empties that tray without
 * ever blocking on it (`drain()`). What yields to the event loop is the `await`
 * the text loop already performs on the model, so no timer is involved.
 *
 * One instance per turn: the segmenter's budget grows with the segments emitted
 * and the timing marks are relative to this turn's start.
 */
export class VexiSpeechTurn {
  private readonly logger = new Logger(VexiSpeechTurn.name);
  private readonly segmenter = new VexiSpeechSegmenter();

  /** Cut, indexed, waiting for a prefetch slot. */
  private readonly queue: QueuedSegment[] = [];
  /** In flight, keyed by index so `settle()` can race them. */
  private readonly active = new Map<number, Promise<void>>();
  /** Synthesized, waiting for the text loop to pass by and pick them up. */
  private readonly ready: VexiAudioFrame[] = [];

  private nextIndex = 0;
  private aborted = false;
  private fillerPhrase: string | null = null;
  private readonly marks = new Map<TimingMark, number>();

  constructor(
    private readonly source: SpeechSource,
    private readonly params: SpeechCacheParams,
    private readonly startedAt: number = Date.now(),
  ) {}

  /**
   * The filler that covers the thinking window.
   *
   * Emitted first and unconditionally rather than gated by `FILLER_GRACE_MS`,
   * because a gate needs to know the future and latency hiding needs the present:
   * by the time the server could prove the answer was fast, the moment the filler
   * was meant to cover has already passed. So the server offers it and the
   * **client** decides whether to play it — the client is the only side that knows
   * what is actually audible right now.
   *
   * Must be called before the first `push()`. Index 0 is what puts it ahead of
   * every content segment in the playback order, and after content has been cut
   * that index is already spent.
   */
  async filler(previous?: string | null): Promise<VexiAudioFrame | null> {
    if (this.nextIndex !== 0) {
      // Loud rather than silently out of order: a filler that plays after the
      // answer is worse than no filler at all.
      this.logger.warn(
        'Filler requested after content was already segmented; skipping it.',
      );
      return null;
    }

    const phrase = this.source.pickFiller(previous);
    const audio = await this.source.fillerAudio(phrase, this.params);
    if (!audio) return null;

    this.fillerPhrase = phrase;
    return this.frame(this.nextIndex++, audio, true);
  }

  /** The filler actually used, so the next turn can avoid repeating it. */
  usedFiller(): string | null {
    return this.fillerPhrase;
  }

  /** Feeds streamed text; cuts and enqueues whatever became speakable. */
  push(text: string): void {
    if (!text) return;
    // Marked even when aborted: the token did arrive, and the measurement is
    // about the model's latency, not about whether anyone was still listening.
    this.mark('first_token');
    if (this.aborted) return;

    for (const segment of this.segmenter.push(text)) this.enqueue(segment);
    this.pump();
  }

  /** End of turn: the remainder is spoken even if it never closed a sentence. */
  flush(): void {
    if (this.aborted) return;

    for (const segment of this.segmenter.flush()) this.enqueue(segment);
    this.pump();
  }

  /**
   * Hands over every frame finished since the last call. Never blocks — that is
   * the whole point: the text loop passes through here between tokens and must
   * not wait on a provider round trip.
   */
  drain(): VexiAudioFrame[] {
    return this.ready.splice(0, this.ready.length);
  }

  /** Waits for the queue and everything in flight, so `drain()` returns it all. */
  async settle(): Promise<void> {
    while (this.active.size || (!this.aborted && this.queue.length)) {
      this.pump();
      // Aborted with a queue that will never start: nothing left to await.
      if (!this.active.size) break;
      await Promise.race(this.active.values());
    }
  }

  /**
   * Stops spending on a turn nobody is listening to.
   *
   * Drops the queue and refuses new work. Calls already in flight are **not**
   * interrupted — `AIEngineService.runSpeech()` takes no `AbortSignal`, so there
   * is nothing to signal. The saving is still most of the cost: a six-segment
   * answer cut after the first stops five provider calls.
   */
  abort(): void {
    this.aborted = true;
    this.queue.length = 0;
  }

  /** The marks observed on this turn, in the order they were reached. */
  timings(): VexiTimingFrame[] {
    return [...this.marks].map(([mark, ms]) => ({
      type: 'timing' as const,
      mark,
      ms,
    }));
  }

  private enqueue(text: string): void {
    this.mark('first_segment');
    // Index claimed here, at cut time, for the reason on `VexiAudioFrame.index`.
    this.queue.push({ index: this.nextIndex++, text });
  }

  /**
   * Starts jobs up to the prefetch depth.
   *
   * Bounded rather than unbounded so a long answer does not fire twenty calls
   * that a barge-in then throws away. Three is enough to keep the speaker fed:
   * while segment N plays, N+1 and N+2 are already audio.
   */
  private pump(): void {
    while (
      !this.aborted &&
      this.active.size < SYNTHESIS_PREFETCH_DEPTH &&
      this.queue.length
    ) {
      const job = this.queue.shift()!;
      const promise = this.run(job).finally(() => {
        this.active.delete(job.index);
        // Refill the slot this job just freed.
        this.pump();
      });
      this.active.set(job.index, promise);
    }
  }

  private async run(job: QueuedSegment): Promise<void> {
    try {
      const audio = await this.source.synthesize(job.text, this.params);
      // No audio means the provider failed or the segment cleaned down to
      // nothing. Either way the turn degrades to text-only — captions and
      // history are unaffected, which is the correct direction to fail.
      if (!audio || this.aborted) return;

      this.mark('first_audio');
      this.marks.set('last_audio', this.since());
      this.ready.push(this.frame(job.index, audio, false));
    } catch (error) {
      // `synthesize` is documented not to throw, but a throw here would reach
      // `settle()` as an unhandled rejection and take the whole SSE turn down
      // over a piece of audio.
      this.logger.warn(
        `Segment ${job.index} synthesis threw: ${(error as Error).message}`,
      );
    }
  }

  private frame(
    index: number,
    audio: CachedAudio,
    filler: boolean,
  ): VexiAudioFrame {
    return {
      type: 'audio',
      index,
      audio_base64: audio.audioBase64,
      content_type: audio.contentType,
      ...(filler ? { filler: true } : {}),
    };
  }

  /** First write wins: these mark when something *first* happened. */
  private mark(mark: TimingMark): void {
    if (!this.marks.has(mark)) this.marks.set(mark, this.since());
  }

  private since(): number {
    return Date.now() - this.startedAt;
  }
}
