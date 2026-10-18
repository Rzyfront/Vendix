import { ChatStreamReplay, ChatReplayCursor } from './chat-stream-replay';

type Frame = { type: string; content?: string; replay?: ChatReplayCursor };
const scope = {
  store_id: 1,
  organization_id: 2,
  user_id: 3,
  conversation_id: 7,
};
async function collect(stream: AsyncGenerator<Frame>): Promise<Frame[]> {
  const frames: Frame[] = [];
  for await (const frame of stream) frames.push(frame);
  return frames;
}
const run = () =>
  jest.fn(async function* () {
    yield { type: 'text', content: 'Consulté el registro.' };
    yield { type: 'done' };
  });

describe('H SSE replay is bounded transport, never an execution authority', () => {
  it('reattaches by sequence without running/consuming the original intent again', async () => {
    const replay = new ChatStreamReplay<Frame>();
    const execute = run();
    const first = await collect(replay.open('opaque', scope, {}, execute));
    const resumed = await collect(
      replay.open('opaque', scope, { after_sequence: 1 }, execute),
    );
    expect(first.map((frame) => frame.replay?.sequence)).toEqual([1, 2, 3]);
    expect(resumed.map((frame) => frame.replay?.sequence)).toEqual([2, 3]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('rejects implicit retries without an explicit cursor', async () => {
    const replay = new ChatStreamReplay<Frame>();
    const execute = run();
    await collect(replay.open('opaque', scope, {}, execute));
    await expect(
      collect(replay.open('opaque', scope, {}, execute)),
    ).rejects.toThrow('AI_STREAM_CURSOR_REQUIRED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    'store_id',
    'organization_id',
    'user_id',
    'conversation_id',
  ] as const)('never leaks cached frames across %s', async (key) => {
    const replay = new ChatStreamReplay<Frame>();
    const execute = run();
    await collect(replay.open('opaque', scope, {}, execute));
    await expect(
      collect(
        replay.open(
          'opaque',
          { ...scope, [key]: 99 },
          { after_sequence: 0 },
          execute,
        ),
      ),
    ).rejects.toThrow('AI_STREAM_NOT_FOUND');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('binds objective and checkpoint to the live D1 session without advancing it', async () => {
    const replay = new ChatStreamReplay<Frame>();
    let version = 4;
    const execute = jest.fn(async function* (
      _signal: AbortSignal,
      checkpoint: (
        read: () => { objective_id: string; checkpoint: number },
      ) => void,
    ) {
      checkpoint(() => ({ objective_id: 'objective', checkpoint: version }));
      yield { type: 'tool_result' };
      version = 5;
      yield { type: 'done' };
    });
    const first = await collect(replay.open('opaque', scope, {}, execute));
    expect(first.at(-1)?.replay).toMatchObject({
      objective_id: 'objective',
      checkpoint: 5,
    });
    expect(
      await collect(
        replay.open(
          'opaque',
          scope,
          { after_sequence: 2, objective_id: 'objective', checkpoint: 4 },
          execute,
        ),
      ),
    ).toHaveLength(1);
    for (const cursor of [
      { after_sequence: 0, objective_id: 'other' },
      { after_sequence: 0, checkpoint: 6 },
      { after_sequence: -1 },
      { after_sequence: 0.5 },
      { after_sequence: 999 },
    ])
      await expect(
        collect(replay.open('opaque', scope, cursor, execute)),
      ).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(version).toBe(5);
  });

  it('lost worker/cache and expired buffers require reconciliation, never redispatch', async () => {
    let now = 0;
    const replay = new ChatStreamReplay<Frame>(
      { sessions: 2, frames: 8, bytes: 10000, ttlMs: 10 },
      () => now,
    );
    const execute = run();
    await expect(
      collect(replay.open('missing', scope, { after_sequence: 0 }, execute)),
    ).rejects.toThrow('AI_STREAM_RECONCILE_REQUIRED');
    await collect(replay.open('opaque', scope, {}, execute));
    now = 11;
    await expect(
      collect(replay.open('opaque', scope, { after_sequence: 0 }, execute)),
    ).rejects.toThrow('AI_STREAM_RECONCILE_REQUIRED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('cursor outside a bounded replay window fails instead of silently omitting evidence', async () => {
    const replay = new ChatStreamReplay<Frame>({
      sessions: 2,
      frames: 2,
      bytes: 10000,
      ttlMs: 100,
    });
    const execute = run();
    await collect(replay.open('opaque', scope, {}, execute));
    await expect(
      collect(replay.open('opaque', scope, { after_sequence: 0 }, execute)),
    ).rejects.toThrow('AI_STREAM_RECONCILE_REQUIRED');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('disconnect aborts cooperative work but drains its uncertain-effect checkpoint to replay', async () => {
    const replay = new ChatStreamReplay<Frame>();
    const client = new AbortController();
    let persisted = false;
    const execute = jest.fn(async function* (signal: AbortSignal) {
      if (!signal.aborted)
        await new Promise<void>((resolve) =>
          signal.addEventListener('abort', () => resolve(), { once: true }),
        );
      persisted = true;
      yield {
        type: 'text',
        content: 'El efecto sigue pendiente de verificación.',
      };
      yield { type: 'done' };
    });
    const iterator = replay.open('opaque', scope, {}, execute, client.signal);
    await iterator.next();
    client.abort();
    await collect(iterator);
    const resumed = await collect(
      replay.open('opaque', scope, { after_sequence: 1 }, execute),
    );
    expect(persisted).toBe(true);
    expect(resumed[0].content).toContain('pendiente');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
