import {
  VexiSpeechTurn,
  SpeechSource,
  type SynthesisLoss,
} from './vexi-speech.pipeline';
import type { CachedAudio, SpeechCacheParams } from './vexi-speech.cache';
import {
  DEFAULT_SYNTHESIS_CONCURRENCY,
  VOICE_FILLERS,
} from './vexi-speech.constants';

const PARAMS: SpeechCacheParams = {
  model: 'gpt-4o-mini-tts',
  voice: 'shimmer',
  format: 'mp3',
  speed: 1,
  // Obligatorio desde que el volumen entró a la clave de caché.
  vol: 1,
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
  /** Texts the provider fails for good on (after its retries): a loss. */
  failOn = new Set<string>();

  private pending: Array<() => void> = [];

  constructor(private readonly mode: 'immediate' | 'manual' = 'immediate') {}

  async synthesize(text: string): Promise<CachedAudio | SynthesisLoss | null> {
    this.calls.push(text);
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    try {
      if (this.mode === 'manual') {
        await new Promise<void>((resolve) => this.pending.push(resolve));
      }
      if (this.failOn.has(text)) {
        return {
          lost: true,
          reason: '429: Provider returned error',
        };
      }
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

/** Parallel depth for the tests about ordering under concurrent synthesis. */
const PARALLEL = 3;

/** A turn configured to allow `PARALLEL` jobs in flight (not the default). */
function parallelTurn(source: SpeechSource): VexiSpeechTurn {
  return new VexiSpeechTurn(
    source,
    PARAMS,
    Date.now(),
    undefined,
    undefined,
    PARALLEL,
  );
}

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
      const turn = parallelTurn(source);

      turn.push('Uno. Dos. Tres. ');
      // Three cut, three in flight (exactly the configured depth).
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

  describe('provider concurrency', () => {
    it('defaults to one call at a time: never two syntheses in flight', async () => {
      expect(DEFAULT_SYNTHESIS_CONCURRENCY).toBe(1);
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push(SIX_SENTENCES);
      expect(source.calls).toEqual(['Uno.']);
      expect(source.waiting).toBe(1);

      await source.runToCompletion();
      await turn.settle();

      // All six run, strictly one after another.
      expect(source.calls).toHaveLength(6);
      expect(source.maxInFlight).toBe(1);
    });

    it('honours a higher configured concurrency without exceeding it', async () => {
      const source = new StubSource('manual');
      const turn = parallelTurn(source);

      turn.push(SIX_SENTENCES);
      expect(source.calls).toHaveLength(PARALLEL);

      await source.runToCompletion();
      await turn.settle();

      expect(source.calls).toHaveLength(6);
      expect(source.maxInFlight).toBe(PARALLEL);
    });

    it('starts the next segment as soon as the previous one finishes', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push(SIX_SENTENCES);
      expect(source.calls).toHaveLength(1);

      source.releaseLast();
      await tick();

      expect(source.calls).toEqual(['Uno.', 'Dos.']);
      expect(source.maxInFlight).toBe(1);

      await source.runToCompletion();
      await turn.settle();
    });

    it('treats an invalid concurrency as one', async () => {
      const source = new StubSource('manual');
      const turn = new VexiSpeechTurn(
        source,
        PARAMS,
        Date.now(),
        undefined,
        undefined,
        0,
      );

      turn.push(SIX_SENTENCES);
      expect(source.calls).toHaveLength(1);

      await source.runToCompletion();
      await turn.settle();
      expect(source.maxInFlight).toBe(1);
    });
  });

  describe('abort', () => {
    it('stops spending on segments that were only queued', async () => {
      const source = new StubSource('manual');
      const turn = parallelTurn(source);

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

    it('records the lost segment with its index and reason, and marks the turn incomplete', async () => {
      const source = new StubSource();
      source.failOn.add('Dos.');
      source.failOn.add('Cuatro.');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. Tres. Cuatro. Cinco. ');
      turn.flush();
      await turn.settle();

      // The rest of the turn is still read.
      expect(turn.drain().map((f) => f.audio_base64)).toEqual([
        'b64:Uno.',
        'b64:Tres.',
        'b64:Cinco.',
      ]);
      expect(turn.lostSegments()).toEqual([
        { index: 1, reason: '429: Provider returned error' },
        { index: 3, reason: '429: Provider returned error' },
      ]);
      expect(turn.isComplete()).toBe(false);
      expect(turn.status()).toEqual({
        type: 'voice_status',
        complete: false,
        lost_segments: 2,
      });
    });

    it('reports a turn with every segment synthesized as complete', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.flush();
      await turn.settle();

      expect(turn.lostSegments()).toEqual([]);
      expect(turn.status()).toEqual({
        type: 'voice_status',
        complete: true,
        lost_segments: 0,
      });
    });

    it('does not count a segment with nothing speakable as lost', async () => {
      const source = new StubSource();
      jest.spyOn(source, 'synthesize').mockResolvedValueOnce(null);
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.flush();
      await turn.settle();

      expect(turn.isComplete()).toBe(true);
    });

    it('an aborted turn is never complete', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. ');
      turn.abort();
      await turn.settle();

      expect(turn.isComplete()).toBe(false);
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
      expect(turn.lostSegments()).toEqual([{ index: 0, reason: 'threw: boom' }]);
      expect(turn.isComplete()).toBe(false);
    });
  });

  describe('markdown over the whole answer', () => {
    async function spokenFrom(chunks: string[]): Promise<string> {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);
      for (const chunk of chunks) turn.push(chunk);
      turn.flush();
      await turn.settle();
      return source.calls.join(' | ');
    }

    it('never reads a fenced JSON block split across chunks and segments', async () => {
      const spoken = await spokenFrom([
        'Te dejo el resumen de la venta. ',
        'Aquí está el detalle:\n```json\n{"order_id": 4512, ',
        '"total": 150000, "items": [{"sku": "QA-1"}]',
        '}\n``',
        '`\nListo, eso es todo por ahora.',
      ]);

      expect(spoken).not.toMatch(/order_id|sku|QA-1|[{}"`]/);
      expect(spoken).toContain('Te dejo el resumen de la venta.');
      expect(spoken).toContain('Listo, eso es todo por ahora.');
    });

    it('never reads a code block longer than a segment budget', async () => {
      const code = Array.from(
        { length: 20 },
        (_, i) => `const variable${i} = calcular(${i});`,
      ).join('\n');
      const spoken = await spokenFrom([
        'Este es el script.\n```ts\n',
        code.slice(0, 200),
        code.slice(200),
        '\n```\nFin.',
      ]);

      expect(spoken).not.toMatch(/const|variable|calcular/);
      expect(spoken).toContain('Este es el script.');
      expect(spoken).toContain('Fin.');
    });

    it('reads a link label, never its URL, when the link arrives in pieces', async () => {
      const spoken = await spokenFrom([
        'Revisa el [reporte de ',
        'ventas](https://vendix.com/re',
        'portes/123) cuando puedas.',
      ]);

      expect(spoken).toContain('reporte de ventas');
      expect(spoken).not.toMatch(/https|vendix\.com|\(|\)|\[|\]/);
    });

    it('drops list and heading markers even when a line arrives split', async () => {
      const spoken = await spokenFrom([
        '## Ven',
        'tas de hoy\n',
        '1',
        '. Arepas: 12 unidades.\n- ',
        '**Café**: 8 unidades.\n',
      ]);

      expect(spoken).not.toMatch(/[#*]|^1\. |\| 1\. /);
      expect(spoken).toContain('Ventas de hoy');
      expect(spoken).toContain('Arepas: 12 unidades.');
      expect(spoken).toContain('Café: 8 unidades.');
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

  describe('settleOrdered', () => {
    async function collect(
      gen: AsyncGenerator<{ index: number; audio_base64: string }>,
    ) {
      const frames: Array<{ index: number; audio_base64: string }> = [];
      for await (const frame of gen) frames.push(frame);
      return frames;
    }

    it('emits every segment in strict ascending index order even when synthesis finishes backwards', async () => {
      const source = new StubSource('manual');
      const turn = parallelTurn(source);

      turn.push('Uno. Dos. Tres. Cuatro. ');
      turn.flush();

      const collecting = collect(turn.settleOrdered());
      // Invert completion order of the first 3 jobs in flight.
      source.releaseLast();
      source.releaseLast();
      source.releaseLast();
      await tick();
      await source.runToCompletion();

      const frames = await collecting;
      expect(frames.map((f) => f.index)).toEqual([0, 1, 2, 3]);
      expect(frames.map((f) => f.audio_base64)).toEqual([
        'b64:Uno.',
        'b64:Dos.',
        'b64:Tres.',
        'b64:Cuatro.',
      ]);
    });

    it('starts at index 1 when a filler claimed index 0', async () => {
      const source = new StubSource();
      const turn = new VexiSpeechTurn(source, PARAMS);

      const filler = await turn.filler();
      expect(filler?.index).toBe(0);

      turn.push('Primero. Segundo. ');
      turn.flush();

      const frames = await collect(turn.settleOrdered());
      expect(frames.map((f) => f.index)).toEqual([1, 2]);
      expect(frames.map((f) => f.audio_base64)).toEqual([
        'b64:Primero.',
        'b64:Segundo.',
      ]);
    });

    it('advances past a failed segment without stalling the remaining audio', async () => {
      const source = new StubSource();
      source.failOn.add('Dos.');
      const turn = new VexiSpeechTurn(source, PARAMS);

      turn.push('Uno. Dos. Tres. ');
      turn.flush();

      const frames = await collect(turn.settleOrdered());
      expect(frames.map((f) => f.index)).toEqual([0, 2]);
      expect(frames.map((f) => f.audio_base64)).toEqual([
        'b64:Uno.',
        'b64:Tres.',
      ]);
    });
  });
});

describe('VexiSpeechTurn — medición de voz (T14)', () => {
  /** Source whose segments report whether the provider generated them. */
  class MeteredSource extends StubSource {
    cached = new Set<string>();
    async synthesize(text: string): Promise<any> {
      const audio = await super.synthesize(text);
      if (!audio) return null;
      return this.cached.has(text)
        ? { ...audio, generated: false, seconds: 0 }
        : { ...audio, generated: true, seconds: text.length / 10 };
    }
  }

  it('mide solo los segmentos generados, con su índice, y nunca la muletilla', async () => {
    const source = new MeteredSource();
    source.cached.add('Dos.');
    const meter = jest.fn();
    const turn = new VexiSpeechTurn(source, PARAMS, Date.now(), 'COP', meter);

    await turn.filler(null);
    turn.push('Uno. Dos. Tres. ');
    turn.flush();
    await turn.settle();

    // La muletilla ocupa el índice 0 y no se mide; los segmentos siguen en 1.
    expect(meter.mock.calls).toEqual([
      [0.4, 1],
      [0.5, 3],
    ]);
  });

  it('el audio ya generado se mide aunque la persona corte la lectura', async () => {
    const source = new MeteredSource('manual');
    const meter = jest.fn();
    const turn = new VexiSpeechTurn(source, PARAMS, Date.now(), 'COP', meter);

    turn.push('Uno. ');
    turn.flush();
    turn.abort();
    await source.runToCompletion();
    await turn.settle();

    expect(meter).toHaveBeenCalledWith(0.4, 0);
    expect(turn.drain()).toEqual([]);
  });

  it('un medidor que lanza no rompe la lectura', async () => {
    const source = new MeteredSource();
    const turn = new VexiSpeechTurn(source, PARAMS, Date.now(), 'COP', () => {
      throw new Error('meter down');
    });

    turn.push('Uno. ');
    turn.flush();
    await turn.settle();

    expect(turn.drain()).toHaveLength(1);
  });
});
