import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';

/**
 * How long a turn waits for the browser to finish a UI command.
 *
 * Sized against the human, not the network: picking a variant, confirming a
 * removal or choosing a customer all end in a dialog. Shorter than the agent's
 * own 60 s budget so the turn still has room to narrate what happened.
 */
const DEFAULT_WAIT_MS = 25_000;

/** Poll cadence while waiting. 150 ms is invisible next to a human click. */
const POLL_INTERVAL_MS = 150;

/** Long enough to outlive any single turn, short enough not to accumulate. */
const OWNER_TTL_SECONDS = 300;
const RESULT_TTL_SECONDS = 120;

export interface UiCommandResult {
  tool_call_id: string;
  result: string;
}

/**
 * The return path for commands that execute in the browser.
 *
 * Vexi's `ui_*` tools run in the user's tab — there is no router and no cart in
 * the server process. Before this channel existed the agent loop pushed the
 * command out over SSE and immediately told the model "dispatched", so the model
 * narrated outcomes it had never seen: it would claim two products were added to
 * a cart that was still empty. The fix is not a better prompt, it is giving the
 * loop the actual answer.
 *
 * **Why polling instead of pub/sub.** `SUBSCRIBE` puts an ioredis connection
 * into subscriber mode, where it can no longer serve normal commands, so a
 * pub/sub design needs `duplicate()` — a fresh TCP connection per waiting turn,
 * torn down on every timeout. Polling a key every 150 ms costs a handful of
 * `GETDEL` calls against the connection that already exists, and 150 ms of added
 * latency is nothing against an interaction whose other end is a person
 * clicking. The simpler resource story wins.
 *
 * **Why the ownership key.** The stream id is consumed by the SSE handshake, so
 * by the time the browser posts a result there is nothing left to validate
 * against. `registerTurn` re-establishes who owns the turn, so a leaked stream
 * id cannot be used to inject a fabricated tool result into somebody else's
 * conversation — which would be a way to make Vexi believe a checkout succeeded.
 */
@Injectable()
export class VexiUiChannelService {
  private readonly logger = new Logger(VexiUiChannelService.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Binds a turn to its user so results can be authorised later. */
  async registerTurn(streamId: string, userId: number | undefined): Promise<void> {
    if (!streamId || !userId) return;
    await this.redis.set(
      this.ownerKey(streamId),
      String(userId),
      'EX',
      OWNER_TTL_SECONDS,
    );
  }

  /**
   * Accepts a result from the browser.
   *
   * Returns `false` when the turn does not belong to this user, so the
   * controller can answer 403 instead of silently swallowing it.
   */
  async submitResult(
    streamId: string,
    toolCallId: string,
    result: string,
    userId: number | undefined,
  ): Promise<boolean> {
    const owner = await this.redis.get(this.ownerKey(streamId));

    // No owner means the turn already ended (TTL) or never existed. Accepting it
    // would park a result nobody will ever read; rejecting tells the browser to
    // stop trying.
    if (!owner) return false;
    if (userId !== undefined && owner !== String(userId)) {
      this.logger.warn(
        `Rejected UI result for stream ${streamId}: owner=${owner} caller=${userId}`,
      );
      return false;
    }

    await this.redis.set(
      this.resultKey(streamId, toolCallId),
      result,
      'EX',
      RESULT_TTL_SECONDS,
    );

    return true;
  }

  /**
   * Waits for the browser's answer to one command.
   *
   * Resolves `null` on timeout rather than throwing: a person who walked away
   * mid-dialog has not caused an error, and the loop turns that `null` into an
   * honest "quedó pendiente de que termines" instead of a failure.
   */
  async awaitResult(
    streamId: string,
    toolCallId: string,
    timeoutMs = DEFAULT_WAIT_MS,
  ): Promise<string | null> {
    if (!streamId) return null;

    const key = this.resultKey(streamId, toolCallId);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const value = await this.redis.getdel(key);
      if (value) return value;
      await this.sleep(POLL_INTERVAL_MS);
    }

    this.logger.warn(
      `UI command ${toolCallId} on stream ${streamId} did not report back within ${timeoutMs}ms`,
    );
    return null;
  }

  /** Drops the turn's ownership marker once the turn is over. */
  async releaseTurn(streamId: string): Promise<void> {
    if (!streamId) return;
    await this.redis.del(this.ownerKey(streamId));
  }

  private ownerKey(streamId: string): string {
    return `vexi:ui:owner:${streamId}`;
  }

  private resultKey(streamId: string, toolCallId: string): string {
    return `vexi:ui:result:${streamId}:${toolCallId}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
