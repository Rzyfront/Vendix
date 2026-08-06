import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';

/**
 * What the browser reports about the screen the user is looking at.
 *
 * Treated as **untrusted input**. It is interpolated into the prompt so Vexi
 * can say "veo que estás en el POS", and it is never consulted to authorize
 * anything: a client that claims `visible_modules: ['payroll']` gets a
 * chattier assistant, not access to payroll. Authorization stays where it
 * already is — the permission filter on the tool catalog and the guards behind
 * every endpoint.
 */
export interface VexiUiContext {
  /** Router path, e.g. `/admin/pos`. */
  route?: string;
  /** Module keys currently reachable in the sidebar. */
  visible_modules?: string[];
  /** Hidden modules with the layer that blocks each one. */
  hidden_modules?: Array<{ key: string; blocked_by: string }>;
  /** Shape of the POS cart when the user is standing in it. */
  pos?: {
    item_count?: number;
    total?: number;
    customer?: string | null;
  };
}

export interface VexiStreamIntent {
  conversation_id: number;
  content: string;
  ui_context?: VexiUiContext;
  user_id?: number;
  /** Handles of the documents this turn carries (`att_41`), never bytes. */
  attachment_ids?: string[];
  /**
   * Whether this turn should also be spoken. Travels with the intent for the
   * same reason the UI context does: it describes one turn, and the person can
   * switch modes between turns of the same conversation.
   */
  speak?: boolean;
}

/**
 * Just long enough for the browser to receive the id and open the EventSource.
 * Anything longer is a replayable handle to someone else's prompt.
 */
const INTENT_TTL_SECONDS = 60;

/**
 * Two-step handshake for the chat SSE endpoint.
 *
 * `EventSource` cannot send a body, so the previous design put the user's
 * message in `?content=`. That writes every question a user ever asks into the
 * access logs, next to the JWT that is also in the query string. The message
 * now travels in a `POST` body and the SSE call carries only an opaque,
 * single-use, short-lived id.
 *
 * The UI context rides along here rather than through a separate endpoint
 * because it describes one specific turn. Sent out of band it would race the
 * user: the prompt could end up describing a screen they already left.
 */
@Injectable()
export class VexiStreamIntentService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async create(intent: VexiStreamIntent): Promise<string> {
    const streamId = randomUUID();
    await this.redis.set(
      this.key(streamId),
      JSON.stringify(intent),
      'EX',
      INTENT_TTL_SECONDS,
    );
    return streamId;
  }

  /**
   * Reads and consumes the intent. Single use: a reconnecting EventSource must
   * ask for a new id rather than silently re-running the same turn — browsers
   * reconnect automatically on any transport hiccup, and an idempotent-looking
   * replay of an agent turn can re-execute tools.
   */
  async consume(
    streamId: string,
    userId: number | undefined,
  ): Promise<VexiStreamIntent | null> {
    const raw = await this.redis.getdel(this.key(streamId));
    if (!raw) return null;

    const intent = JSON.parse(raw) as VexiStreamIntent;

    // The id is opaque and short-lived, but it is still a bearer handle: bind
    // it to the user who created it so a leaked id cannot be spent by anyone
    // else's session.
    if (intent.user_id !== undefined && intent.user_id !== userId) return null;

    return intent;
  }

  private key(streamId: string): string {
    return `vexi:stream-intent:${streamId}`;
  }
}
