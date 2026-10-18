import {
  replayEventSource,
  isPersistedStreamReply,
  replayStreamUrl,
  VexiReplayCursor,
  VexiStreamTransportError,
} from './vexi-stream-transport';

class Source {
  onerror: (() => void) | null = null;
  close = jest.fn();
  private listener?: (event: MessageEvent) => void;
  addEventListener(_type: string, listener: (event: MessageEvent) => void) {
    this.listener = listener;
  }
  frame(frame: unknown) {
    this.listener?.({ data: JSON.stringify(frame) } as MessageEvent);
  }
}
type Frame = { type: string; content?: string; replay?: VexiReplayCursor };
const replay = (sequence: number): VexiReplayCursor => ({
  stream_id: 'opaque',
  sequence,
  objective_id: 'objective',
  checkpoint: 4,
});
describe('H frontend SSE replay/cancellation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  function fixture(supported = false) {
    const sources: Source[] = [];
    const urls: string[] = [];
    const frames: Frame[] = [];
    const errors: unknown[] = [];
    const subscription = replayEventSource<Frame>(
      'opaque',
      (cursor) => replayStreamUrl('/stream?stream_id=opaque', cursor),
      supported,
      (url) => {
        urls.push(url);
        const source = new Source();
        sources.push(source);
        return source as unknown as EventSource;
      },
    ).subscribe({
      next: (frame) => frames.push(frame),
      error: (error) => errors.push(error),
    });
    return { sources, urls, frames, errors, subscription };
  }
  it('reconnects only the same opaque stream with objective/checkpoint/sequence and drops duplicate frames', () => {
    const test = fixture();
    test.sources[0].frame({ type: 'progress', replay: replay(1) });
    test.sources[0].frame({ type: 'tool_call', replay: replay(2) });
    test.sources[0].onerror?.();
    expect(test.sources[0].close).toHaveBeenCalled();
    jest.advanceTimersByTime(150);
    expect(test.urls[1]).toContain(
      'stream_id=opaque&after_sequence=2&objective_id=objective&checkpoint=4',
    );
    test.sources[1].frame({ type: 'tool_call', replay: replay(2) });
    test.sources[1].frame({
      type: 'text',
      content: 'Verificado.',
      replay: replay(3),
    });
    test.sources[1].frame({ type: 'done', replay: replay(4) });
    expect(test.frames.map((frame) => frame.type)).toEqual([
      'progress',
      'tool_call',
      'text',
      'done',
    ]);
    expect(test.subscription.closed).toBe(true);
    expect(test.sources[1].close).toHaveBeenCalled();
  });
  it('knows H from handshake even when the initial socket dies before its first frame', () => {
    const test = fixture(true);
    for (let attempt = 0; attempt < 3; attempt++) {
      test.sources[attempt].onerror?.();
      jest.advanceTimersByTime(150);
    }
    expect(test.sources).toHaveLength(3);
    expect(test.urls.slice(1)).toEqual([
      '/stream?stream_id=opaque&after_sequence=0',
      '/stream?stream_id=opaque&after_sequence=0',
    ]);
    expect(test.errors[0]).toBeInstanceOf(VexiStreamTransportError);
    expect((test.errors[0] as VexiStreamTransportError).replaySupported).toBe(
      true,
    );
  });
  it('leaves OFF legacy drops to reconciliation, never implicit EventSource retries', () => {
    const test = fixture();
    test.sources[0].onerror?.();
    jest.runAllTimers();
    expect(test.sources).toHaveLength(1);
    expect((test.errors[0] as VexiStreamTransportError).replaySupported).toBe(
      false,
    );
    expect(test.sources[0].close).toHaveBeenCalled();
  });
  it('unsubscribe closes the source, cancels reconnect timers and suppresses late frames', () => {
    const test = fixture(true);
    test.sources[0].onerror?.();
    test.subscription.unsubscribe();
    jest.runAllTimers();
    test.sources[0].frame({ type: 'tool_call', replay: replay(1) });
    expect(test.sources).toHaveLength(1);
    expect(test.frames).toEqual([]);
    expect(test.sources[0].close).toHaveBeenCalled();
  });
  it.each([
    { ...replay(1), stream_id: 'other' },
    replay(3),
    { ...replay(1), sequence: 0.5 },
  ])(
    'rejects alien/gapped/invalid cursor without rendering or dispatching',
    (cursor) => {
      const test = fixture(true);
      test.sources[0].frame({ type: 'tool_call', replay: cursor });
      expect(test.frames).toEqual([]);
      expect(test.errors).toHaveLength(1);
      expect(test.sources[0].close).toHaveBeenCalled();
    },
  );
  it('tolerates a scoped replay reconciliation error without retrying inference', () => {
    const test = fixture(true);
    test.sources[0].frame({
      type: 'error',
      error: 'AI_STREAM_RECONCILE_REQUIRED',
    });
    expect(test.subscription.closed).toBe(true);
    expect(test.errors).toEqual([]);
    expect(test.frames).toHaveLength(1);
    expect(test.sources).toHaveLength(1);
  });
  it('never adds prompts, tool args or tokens from cursor metadata to stream URLs', () => {
    expect(
      replayStreamUrl('/stream?stream_id=opaque', {
        ...replay(2),
        content: 'private prompt',
        arguments: { password: 'secret' },
      } as VexiReplayCursor),
    ).toBe(
      '/stream?stream_id=opaque&after_sequence=2&objective_id=objective&checkpoint=4',
    );
  });
  it('reconciles only the exact H turn, never an older assistant message', () => {
    expect(
      isPersistedStreamReply(
        { role: 'assistant', metadata: { stream_id: 'old' } },
        'current',
      ),
    ).toBe(false);
    expect(isPersistedStreamReply({ role: 'assistant' }, 'current')).toBe(
      false,
    );
    expect(
      isPersistedStreamReply(
        { role: 'user', metadata: { stream_id: 'current' } },
        'current',
      ),
    ).toBe(false);
    expect(
      isPersistedStreamReply(
        { role: 'assistant', metadata: { stream_id: 'current' } },
        'current',
      ),
    ).toBe(true);
    expect(isPersistedStreamReply({ role: 'assistant' })).toBe(true);
  });
});
