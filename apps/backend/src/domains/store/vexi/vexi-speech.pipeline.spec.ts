import { VexiSpeechTurn, SpeechSource } from './vexi-speech.pipeline';
import type { CachedAudio, SpeechCacheParams } from './vexi-speech.cache';
import { SYNTHESIS_PREFETCH_DEPTH, VOICE_FILLERS } from './vexi-speech.constants';

const PARAMS: SpeechCacheParams = {
  model: 'gpt-4o-mini-tts',
  voice: 'shimmer',
  format: 'mp3',
  speed: 1,
};

/**
 * Stands in for `VexiSpeechService` with controllable timing.
 *
 * `manual` mode is what makes the concurrency and ordering claims testable: real
 * synthesis resolves in whatever order the provider feels like, and the whole
 * point of the index is that the design does not depend on that order.
 */
class StubSource implements SpeechSource {
  calls: string[] = [];
  fillerCalls: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  /** Texts that should come back with no audio, simulating a provider failure. */
  failOn = new Set<string>();

  private pending: Array<() => void> = [];

  constructor(private readonly mode: 'immediate' | 'manual' = 'immediate') {}

  async synthesize(text: string): Promise<CachedAudio | null> {
    this.calls.push(text);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    try {
      if (this.mode === 'manual') {
        await new Promise<void>((resolve) => this.pending.push(resolve));
      }
      if (this.failOn.has(text)) return null;
      return { audioBase64: `b64:${text}`, contentType: 'audio/mp3' };
    } finally {
      this.inFlight--;
    }
  }

  pickFiller(previous?: string | null): string {
    const index = previous ? VOICE_FILLERS.indexOf(previous as any) : -1;
    return index < 0 ? VOICE_FILLERS[0] : VOICE_FILLERS[index + 1];
  }

  async fillerAudio(phrase: string): Promise<CachedAudio | null> {
    this.fillerCalls.push(phrase);
    if (this.failOn.has(phrase)) return null;
    return { audioBase64: `b64:${phrase}`, contentType: 'audio/mp3' };
  }

  releaseAll(): void {
    const waiting = this.pending;
    this.pending = [];
    waiting.forEach((resolve) => resolve());
  }

  /**
   * Releases repeatedly until nothing is waiting.
   *
   * One `releaseAll()` is not enough: freeing a slot makes the turn start the
   * next queued segment, which registers a *new* resolver. Releasing once and
   * then awaiting `settle()` deadlocks on the jobs that only just started.
   */
  async runToCompletion(): Promise<void> {
    while (this.pending.length) {
      this.releaseAll();
      await tick();
    }
  }

  /** Releases the most recently started job first, inverting completion order. */
  releaseLast(): void {
    this.pending.pop()?.();
  }

  get waiting(): number {
    return this.pending.length;
  }
}

/** Six short sentences, so the segmenter cuts one per sentence. */
const SIX_SENTENCES = 'Uno. Dos. Tres. Cuatro. Cinco. Seis. ';

/**
 * Drains the microtask queue.
 *
 * `await Promise.resolve()` is not enough here: a released job travels through
 * the stub's own resumption, `run()`'s await, the `finally` that frees the slot,
 * and only then `pump()`. Counting ticks by hand makes the test depend on the
 * number of awaits in the implementation; `setImmediate` does not.
 */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('VexiSpeechTurn', () => {
  describe('filler', () => {
    it('claims index 0 and is flagged so the client can tell it apart', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      const frame = await turn.filler();

      expect(frame).toEqual({
        type: 'audio',
        index: 0,
        audio_base64: `b64:${VOICE_FILLERS[0]}`,
        content_type: 'audio/mp3',
        filler: true,
      });
      expect(turn.usedFiller()).toBe(VOICE_FILLERS[0]);
    });

    it('pushes content to index 1 onward so the filler always plays first', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      await turn.filler();
      turn.push('Hola. ');
      turn.flush();
      await turn.settle();

      expect(turn.drain().map((f) => f.index)).toEqual([1]);
    });

    it('refuses to issue a filler once content has been segmented', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Ya hay contenido. ');
      const frame = await turn.filler();

      // Silently emitting it would give it an index above the answer, so it
      // would play *after* the thing it was supposed to cover.
      expect(frame).toBeNull();
      expect(source.fillerCalls).toEqual([]);
    });

    it('degrades to no filler when the bank could not be synthesized', async () => {
      const source = new StubSource();
      source.failOn.add(VOICE_FILLERS[0]);
      const turn = new VexiSpeechTurn(source, PARAMS);

      expect(await turn.filler()).toBeNull();
      expect(turn.usedFiller()).toBeNull();
    });

    it('never repeats the phrase the previous turn used', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      const frame = await turn.filler(VOICE_FILLERS[0]);

      expect(frame?.audio_base64).toBe(`b64:${VOICE_FILLERS[1]}`);
    });
  });

  describe('playback order', () => {
    it('indexes by segmentation order even when synthesis finishes backwards', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. Tres. ');
      // Three cut, three in flight (exactly the prefetch depth).
      expect(source.calls).toEqual(['Uno.', 'Dos.', 'Tres.']);

      // Invert completion: the last job started resolves first.
      source.releaseLast();
      source.releaseLast();
      source.releaseLast();
      await turn.settle();

      const frames = turn.drain();

      // Arrival order is reversed...
      expect(frames.map((f) => f.audio_base64)).toEqual([
        'b64:Tres.',
        'b64:Dos.',
        'b64:Uno.',
      ]);
      // ...but each frame still carries the index of the segment it belongs to,
      // which is what lets the client reassemble the answer in speaking order.
      expect(frames.map((f) => f.index)).toEqual([2, 1, 0]);
    });

    it('drain hands over each frame exactly once', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.flush();
      await turn.settle();

      expect(turn.drain()).toHaveLength(2);
      expect(turn.drain()).toEqual([]);
    });
  });

  describe('prefetch bound', () => {
    it('never exceeds the configured depth', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push(SIX_SENTENCES);

      expect(source.calls).toHaveLength(SYNTHESIS_PREFETCH_DEPTH);
      expect(source.maxInFlight).toBe(SYNTHESIS_PREFETCH_DEPTH);

      await source.runToCompletion();
      await turn.settle();

      // All six eventually run — the depth bounds concurrency, not throughput.
      expect(source.calls).toHaveLength(6);
      expect(source.maxInFlight).toBe(SYNTHESIS_PREFETCH_DEPTH);
    });

    it('refills a slot as soon as one job finishes', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push(SIX_SENTENCES);
      expect(source.calls).toHaveLength(3);

      source.releaseLast();
      await tick();

      expect(source.calls).toHaveLength(4);
      expect(source.maxInFlight).toBe(SYNTHESIS_PREFETCH_DEPTH);

      await source.runToCompletion();
      await turn.settle();
    });
  });

  describe('abort', () => {
    it('stops spending on segments that were only queued', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push(SIX_SENTENCES);
      expect(source.calls).toHaveLength(3);

      turn.abort();
      source.releaseAll();
      await turn.settle();

      // The three queued behind the depth limit are the saving. The three already
      // in flight cannot be recalled — `runSpeech` takes no AbortSignal.
      expect(source.calls).toHaveLength(3);
    });

    it('drops the audio of the jobs that were in flight', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.abort();
      source.releaseAll();
      await turn.settle();

      // Paid for, but never played: a barge-in means the listener already moved
      // on, and emitting this would put stale audio ahead of the new turn.
      expect(turn.drain()).toEqual([]);
    });

    it('ignores text pushed after the abort', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.abort();
      turn.push('Uno. Dos. ');
      turn.flush();
      await turn.settle();

      expect(source.calls).toEqual([]);
    });
  });

  describe('degradation', () => {
    it('skips a failed segment and still delivers the rest', async () => {
      const source = new StubSource();
      source.failOn.add('Dos.');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. Tres. ');
      turn.flush();
      await turn.settle();

      const frames = turn.drain();

      // Text-only for the gap rather than a dead turn: the captions and the
      // stored message are unaffected by a provider hiccup on one segment.
      expect(frames.map((f) => f.audio_base64)).toEqual([
        'b64:Uno.',
        'b64:Tres.',
      ]);
      // The index of the failed segment is simply absent — the client must not
      // block waiting for an index that will never arrive.
      expect(frames.map((f) => f.index)).toEqual([0, 2]);
    });

    it('survives a synthesizer that throws', async () => {
      const source = new StubSource();
      jest
        .spyOn(source, 'synthesize')
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({
          audioBase64: 'b64:Dos.',
          contentType: 'audio/mp3',
        });
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.flush();

      // An unhandled rejection here would reach `settle()` and take the whole
      // SSE turn down over a piece of audio.
      await expect(turn.settle()).resolves.toBeUndefined();
      expect(turn.drain().map((f) => f.audio_base64)).toEqual(['b64:Dos.']);
    });
  });

  describe('timing marks', () => {
    it('records the four marks the server can observe', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS, Date.now() - 500);

      turn.push('Hola mundo. ');
      turn.flush();
      await turn.settle();

      const marks = turn.timings();

      expect(marks.map((m) => m.mark)).toEqual([
        'first_token',
        'first_segment',
        'first_audio',
        'last_audio',
      ]);
      expect(marks.every((m) => m.type === 'timing')).toBe(true);
      // Relative to the turn's start, which was backdated 500ms above.
      expect(marks[0].ms).toBeGreaterThanOrEqual(500);
    });

    it('keeps the first occurrence of each mark, not the last', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. ');
      const firstToken = turn.timings().find((m) => m.mark === 'first_token')!;
      turn.push('Dos. ');

      expect(
        turn.timings().find((m) => m.mark === 'first_token')!.ms,
      ).toBe(firstToken.ms);
    });

    it('reports no marks for a turn that never produced text', () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('');
      turn.flush();

      // An empty chunk is not a token. Marking it would report a first-token
      // latency for a token that never came.
      expect(turn.timings()).toEqual([]);
    });
  });

  describe('settle', () => {
    it('resolves immediately when there was nothing to speak', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      await expect(turn.settle()).resolves.toBeUndefined();
      expect(source.calls).toEqual([]);
    });

    it('speaks a tail that never closed a sentence', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('y ya está');
      // Mid-stream the segmenter correctly holds an unterminated tail back.
      expect(source.calls).toEqual([]);

      turn.flush();
      await turn.settle();

      expect(source.calls).toEqual(['y ya está']);
    });
  });
});
