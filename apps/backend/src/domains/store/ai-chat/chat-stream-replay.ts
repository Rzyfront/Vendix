import {
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';

export interface ChatReplayCursor {
  stream_id: string;
  sequence: number;
  objective_id?: string;
  checkpoint?: number;
}
export interface ChatReplayRequest {
  after_sequence?: number;
  objective_id?: string;
  checkpoint?: number;
}
export interface ChatReplayScope {
  store_id: number;
  organization_id: number;
  user_id: number;
  conversation_id: number;
}
type Frame = { type: string; replay?: ChatReplayCursor };
type Session<T extends Frame> = {
  scope: string;
  frames: Array<{ frame: T; bytes: number }>;
  sequence: number;
  bytes: number;
  finished: boolean;
  touched: number;
  abort: AbortController;
  wake: Set<() => void>;
  checkpoint?: () => { objective_id: string; checkpoint: number };
};

/** Transport only: never starts/resumes an objective, authorizes a tool, or stores a prompt.
 * A worker restart/window miss fails closed and requires reading D1/transcript state.
 */
export class ChatStreamReplay<T extends Frame> {
  private readonly sessions = new Map<string, Session<T>>();
  constructor(
    private readonly limits = {
      sessions: 32,
      frames: 256,
      bytes: 2_000_000,
      ttlMs: 300_000,
    },
    private readonly now = () => Date.now(),
  ) {}

  async *open(
    streamId: string,
    scope: ChatReplayScope,
    request: ChatReplayRequest,
    run: (
      signal: AbortSignal,
      checkpoint: (read: NonNullable<Session<T>['checkpoint']>) => void,
    ) => AsyncGenerator<T>,
    disconnected?: AbortSignal,
  ): AsyncGenerator<T> {
    const owner = JSON.stringify(scope);
    for (const [id, value] of this.sessions) {
      if (value.finished && this.now() - value.touched > this.limits.ttlMs)
        this.sessions.delete(id);
    }
    let session = this.sessions.get(streamId);
    const reconnect = request.after_sequence !== undefined;
    if (session && session.scope !== owner)
      throw new NotFoundException('AI_STREAM_NOT_FOUND');
    if (reconnect) {
      if (!session) throw new NotFoundException('AI_STREAM_RECONCILE_REQUIRED');
      if (
        !Number.isSafeInteger(request.after_sequence) ||
        request.after_sequence! < 0 ||
        request.after_sequence! > session.sequence
      )
        throw new BadRequestException('AI_STREAM_INVALID_CURSOR');
      const current = session.checkpoint?.();
      if (
        (request.objective_id &&
          request.objective_id !== current?.objective_id) ||
        (request.checkpoint !== undefined &&
          (!Number.isSafeInteger(request.checkpoint) ||
            request.checkpoint < 0 ||
            !current ||
            request.checkpoint > current.checkpoint))
      )
        throw new BadRequestException('AI_STREAM_INVALID_CHECKPOINT');
    } else {
      // A duplicate GET without an explicit cursor must NEVER re-consume the intent.
      if (session) throw new BadRequestException('AI_STREAM_CURSOR_REQUIRED');
      if (this.sessions.size >= this.limits.sessions) {
        const oldest = [...this.sessions].find(([, value]) => value.finished);
        if (oldest) this.sessions.delete(oldest[0]);
        else throw new ServiceUnavailableException('AI_STREAM_CAPACITY');
      }
      session = {
        scope: owner,
        frames: [],
        sequence: 0,
        bytes: 0,
        finished: false,
        touched: this.now(),
        abort: new AbortController(),
        wake: new Set(),
      };
      this.sessions.set(streamId, session);
      const created = session;
      // One producer owns this intent. All reconnects only read its frames.
      void (async () => {
        try {
          this.append(streamId, created, { type: 'progress' } as T);
          for await (const frame of run(created.abort.signal, (read) => {
            created.checkpoint = read;
          }))
            this.append(streamId, created, frame);
        } catch {
          this.append(streamId, created, {
            type: 'error',
            error:
              'La respuesta se interrumpió. Consulta el objetivo o la conversación antes de reintentar.',
          } as unknown as T);
        } finally {
          created.finished = true;
          created.touched = this.now();
          this.wake(created);
        }
      })();
    }
    const active = session!;
    const abort = () => active.abort.abort();
    if (disconnected?.aborted) abort();
    else disconnected?.addEventListener('abort', abort, { once: true });
    let sequence = request.after_sequence ?? 0;
    try {
      while (true) {
        const first =
          active.frames[0]?.frame.replay?.sequence ?? active.sequence + 1;
        if (sequence < first - 1)
          throw new BadRequestException('AI_STREAM_RECONCILE_REQUIRED');
        for (const { frame } of active.frames.slice()) {
          if (frame.replay!.sequence > sequence) {
            sequence = frame.replay!.sequence;
            active.touched = this.now();
            yield frame;
          }
        }
        if (active.finished && sequence >= active.sequence) return;
        if (active.sequence > sequence) continue;
        await new Promise<void>((resolve) => active.wake.add(resolve));
      }
    } finally {
      disconnected?.removeEventListener('abort', abort);
    }
  }

  private append(streamId: string, session: Session<T>, raw: T): void {
    const frame = {
      ...raw,
      replay: {
        stream_id: streamId,
        sequence: ++session.sequence,
        ...session.checkpoint?.(),
      },
    } as T;
    const bytes = Buffer.byteLength(JSON.stringify(frame));
    session.frames.push({ frame, bytes });
    session.bytes += bytes;
    while (
      session.frames.length > 1 &&
      (session.frames.length > this.limits.frames ||
        session.bytes > this.limits.bytes)
    ) {
      session.bytes -= session.frames.shift()!.bytes;
    }
    // Oversized audio/data cannot make the replay cache unbounded.
    if (session.bytes > this.limits.bytes) {
      session.frames = [];
      session.bytes = 0;
    }
    session.touched = this.now();
    this.wake(session);
  }
  private wake(session: Session<T>): void {
    for (const resolve of session.wake) resolve();
    session.wake.clear();
  }
}
