import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { Observable, Subject, filter } from 'rxjs';
import { REDIS_CLIENT } from '../../common/redis/redis.module';

/** Redis channel shared by the API and worker processes. */
export const CRM_INBOX_EVENTS_CHANNEL = 'crm:inbox:events';

export type CrmInboxEventType = 'crm.message' | 'crm.conversation';

/**
 * Real-time signal for the inbox (PLAN-CRM §4.3). It carries ids and states
 * only, never message bodies nor contact data: the client re-reads through
 * the REST endpoints, which apply the store scope and the assignment rule.
 */
export interface CrmInboxEvent {
  type: CrmInboxEventType;
  store_id: number;
  conversation_id: number;
  /** Assignee at the time of the event; drives per-user filtering. */
  assigned_user_id: number | null;
  /** Previous assignee on reassignment, so they learn they lost it. */
  previous_assigned_user_id?: number | null;
  message_id?: number;
  /** Message status (`queued`, `sent`, …) or conversation status. */
  status?: string;
  direction?: 'inbound' | 'outbound';
  at: string;
}

export type CrmInboxEventInput = Omit<CrmInboxEvent, 'at'>;

/**
 * Fan-out of inbox events across processes.
 *
 * Inbound messages and delivery statuses are written by the BullMQ workers,
 * which may run in a separate process (`VENDIX_PROCESS_ROLE=worker`), while
 * the SSE connections live in the API process. Every event is published to
 * Redis; each API process subscribes lazily on its first SSE client, so a
 * worker-only process never opens the subscriber connection.
 *
 * Publishing is best effort: a Redis failure is logged and never breaks the
 * write that produced the event. The inbox stays correct on reload.
 */
@Injectable()
export class CrmInboxEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(CrmInboxEventsService.name);
  private readonly events$ = new Subject<CrmInboxEvent>();
  private subscriber: Redis | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async publish(event: CrmInboxEventInput): Promise<void> {
    try {
      const payload: CrmInboxEvent = { ...event, at: new Date().toISOString() };
      await this.redis.publish(CRM_INBOX_EVENTS_CHANNEL, JSON.stringify(payload));
    } catch (error) {
      this.logger.warn(
        `Could not publish ${event.type} for conversation ${event.conversation_id}: ${(error as Error)?.message}`,
      );
    }
  }

  /** Events of one store. Opens the Redis subscriber on first use. */
  stream(storeId: number): Observable<CrmInboxEvent> {
    this.ensureSubscribed();
    return this.events$.pipe(filter((event) => event.store_id === storeId));
  }

  async onModuleDestroy(): Promise<void> {
    this.events$.complete();
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => undefined);
      this.subscriber = null;
    }
  }

  private ensureSubscribed(): void {
    if (this.subscriber) return;
    // A connection in subscriber mode cannot run other commands, hence the
    // dedicated duplicate. One per process, shared by every SSE client.
    const subscriber = this.redis.duplicate();
    this.subscriber = subscriber;
    subscriber.on('message', (channel: string, raw: string) => {
      if (channel !== CRM_INBOX_EVENTS_CHANNEL) return;
      const event = this.parse(raw);
      if (event) this.events$.next(event);
    });
    subscriber.subscribe(CRM_INBOX_EVENTS_CHANNEL).catch((error: Error) => {
      this.logger.error(`Could not subscribe to inbox events: ${error.message}`);
      this.subscriber = null;
      subscriber.disconnect();
    });
  }

  private parse(raw: string): CrmInboxEvent | null {
    try {
      const event = JSON.parse(raw) as CrmInboxEvent;
      return Number.isInteger(event?.store_id) &&
        Number.isInteger(event?.conversation_id)
        ? event
        : null;
    } catch {
      return null;
    }
  }
}
