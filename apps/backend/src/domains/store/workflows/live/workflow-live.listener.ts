import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { Observable, Subject, filter } from 'rxjs';

export const WORKFLOW_LIVE_CHANNEL = 'workflow_live';

export type WorkflowLiveKind = 'event' | 'task';

/** What the database triggers send: ids only, never request data. */
export interface WorkflowLivePayload {
  store_id: number;
  instance_id: number;
  task_id?: number;
  kind: WorkflowLiveKind;
}

/** The subset of `pg.Client` the listener uses (so tests can fake it). */
export interface WorkflowListenClient {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  on(event: 'notification', cb: (msg: { channel: string; payload?: string }) => void): unknown;
  on(event: 'error' | 'end', cb: (err?: Error) => void): unknown;
  removeAllListeners(): unknown;
  end(): Promise<void>;
}

const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Defensive parse of a NOTIFY payload; anything unexpected is dropped. */
export function parseWorkflowLivePayload(raw: string | undefined): WorkflowLivePayload | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  if (!isId(o.store_id) || !isId(o.instance_id)) return null;
  if (o.kind !== 'event' && o.kind !== 'task') return null;
  if (o.task_id !== undefined && o.task_id !== null && !isId(o.task_id)) return null;
  return {
    store_id: o.store_id,
    instance_id: o.instance_id,
    kind: o.kind,
    ...(isId(o.task_id) ? { task_id: o.task_id } : {}),
  };
}

/**
 * P5.6: ONE dedicated connection that `LISTEN`s to `workflow_live` (the
 * database triggers notify on commit) and fans the ids out to every SSE
 * subscriber of this process. A pooled connection cannot do this: LISTEN needs
 * a session that stays open. Reconnects with backoff when the session drops.
 */
@Injectable()
export class WorkflowLiveListener implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkflowLiveListener.name);
  private readonly subject = new Subject<WorkflowLivePayload>();
  private client: WorkflowListenClient | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay = RECONNECT_MIN_MS;
  private destroyed = false;

  /** Replaceable in tests. */
  clientFactory: () => WorkflowListenClient = () =>
    new Client({ connectionString: process.env.DATABASE_URL }) as unknown as WorkflowListenClient;

  async onModuleInit(): Promise<void> {
    // A worker-only process serves no HTTP, so nobody would read the stream.
    // Same rule as `resolveVendixProcessRole`: only an exact `worker` opts out.
    if ((process.env.VENDIX_PROCESS_ROLE ?? '').trim().toLowerCase() === 'worker') return;
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.dispose();
    this.subject.complete();
  }

  /** Live events of one store. The filter is the only isolation: callers must pass their own store. */
  stream(storeId: number): Observable<WorkflowLivePayload> {
    return this.subject.pipe(filter((e) => e.store_id === storeId));
  }

  async connect(): Promise<void> {
    if (this.destroyed) return;
    const client = this.clientFactory();
    this.client = client;
    client.on('notification', (msg) => {
      if (msg.channel !== WORKFLOW_LIVE_CHANNEL) return;
      const payload = parseWorkflowLivePayload(msg.payload);
      if (payload) this.subject.next(payload);
    });
    client.on('error', (err) => this.lost(client, err));
    client.on('end', () => this.lost(client));
    try {
      await client.connect();
      await client.query(`LISTEN ${WORKFLOW_LIVE_CHANNEL}`);
      this.delay = RECONNECT_MIN_MS;
    } catch (err) {
      this.lost(client, err as Error);
    }
  }

  private lost(client: WorkflowListenClient, err?: Error): void {
    // `error` and `end` both fire for one drop; only the live client reconnects.
    if (this.client !== client) return;
    this.client = null;
    if (err) this.logger.warn(`workflow_live listener lost: ${err.message}`);
    client.removeAllListeners();
    client.on('error', () => undefined);
    void client.end().catch(() => undefined);
    if (this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS);
  }

  private async dispose(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;
    client.removeAllListeners();
    client.on('error', () => undefined);
    await client.end().catch(() => undefined);
  }
}
