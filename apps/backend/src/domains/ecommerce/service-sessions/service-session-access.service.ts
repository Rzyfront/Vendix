import {
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import type Redis from 'ioredis';
import { defer, EMPTY, from, merge, Observable, of, throwError, timer } from 'rxjs';
import { catchError, filter, finalize, map, mergeMap, takeWhile } from 'rxjs/operators';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService, RequestContext } from '../../../common/context/request-context.service';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import { NotificationsSseService } from '../../store/notifications/notifications-sse.service';

const PUBLIC_EVENT_TYPES = new Set([
  'opened', 'paused', 'resumed', 'extended', 'closed', 'cancelled', 'no_show', 'provider_changed',
  'work_started', 'work_updated', 'proposal_submitted', 'proposal_approved', 'proposal_rejected',
]);
const TOKEN_GONE = { code: 'SERVICE_QR_001', status: 410, message: 'Access link unavailable' };
const STREAM_CAP = 3;
const STREAM_TTL_SECONDS = 120;
const PUBLIC_LINE_FIELDS = new Set([
  'name', 'product_name', 'description', 'quantity', 'unit', 'unit_price',
  'subtotal', 'tax', 'tax_amount', 'tax_rate', 'discount', 'discount_amount',
  'total', 'currency',
]);
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
const RESERVE_STREAM = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[2])
  local count = redis.call('ZCARD', KEYS[1])
  if count >= tonumber(ARGV[3]) then
    redis.call('ZREM', KEYS[1], ARGV[1])
    return 0
  end
  redis.call('ZADD', KEYS[1], ARGV[4], ARGV[1])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[5]))
  return 1
`;
const REFRESH_STREAM = `
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
  local exists = redis.call('ZSCORE', KEYS[1], ARGV[2])
  if not exists then return 0 end
  redis.call('ZADD', KEYS[1], ARGV[3], ARGV[2])
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[4]))
  return 1
`;

export interface IssuedServiceSessionAccess {
  token: string;
  token_id: number;
  expires_at: Date;
}

@Injectable()
export class ServiceSessionAccessService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsSseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Internal hook for session-open/email orchestration. Plaintext is returned once and never logged. */
  async issueAccessToken(sessionId: number, expiresAt: Date): Promise<IssuedServiceSessionAccess> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId || !(expiresAt instanceof Date) || expiresAt <= new Date()) {
      throw new Error('Cannot issue service-session access token');
    }
    const session = await this.prisma.service_sessions.findFirst({
      where: { id: sessionId, store_id: storeId, status: { in: ['open', 'paused'] } },
      select: { id: true },
    });
    if (!session) throw new Error('Cannot issue service-session access token');

    return this.createAccessToken(this.prisma, storeId, session.id, expiresAt);
  }

  /** Creates/rotates the credential in the caller's transaction (used at session open). */
  async createAccessToken(
    tx: Prisma.TransactionClient | StorePrismaService,
    storeId: number,
    sessionId: number,
    expiresAt: Date,
  ): Promise<IssuedServiceSessionAccess> {
    if (!(expiresAt instanceof Date) || expiresAt <= new Date()) throw new Error('Cannot issue service-session access token');
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    await tx.service_session_tokens.updateMany({
      where: { store_id: storeId, session_id: sessionId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    const tokenRow = await tx.service_session_tokens.create({
      data: { store_id: storeId, session_id: sessionId, token_hash: tokenHash, expires_at: expiresAt },
      select: { id: true },
    });
    return { token, token_id: tokenRow.id, expires_at: expiresAt };
  }

  async getPublicProgress(token: string) {
    const binding = await this.resolveToken(token);
    const [events, budget, proposal] = await Promise.all([
      this.prisma.service_progress_events.findMany({
        where: { store_id: binding.store_id, session_id: binding.session_id, public_text: { not: null } },
        select: { event_type: true, public_text: true, created_at: true },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 101,
      }),
      this.prisma.service_budgets.findFirst({
        where: { store_id: binding.store_id, session_id: binding.session_id },
        orderBy: { version: 'desc' },
        select: { amount: true, currency: true, version: true, approved_at: true },
      }),
      this.prisma.service_change_proposals.findFirst({
        where: { store_id: binding.store_id, session_id: binding.session_id },
        orderBy: { version: 'desc' },
        select: {
          version: true, order_version: true, snapshot_hash: true, lines: true,
          subtotal: true, tax: true, discount: true, currency: true, total: true,
          status: true, expires_at: true,
        },
      }),
    ]);
    const verifiedSnapshot = proposal ? this.verifyProposalSnapshot(proposal) : false;
    const currentOrder = proposal && binding.order_id
      ? await this.prisma.orders.findFirst({
          where: { id: binding.order_id, store_id: binding.store_id },
          select: { service_version: true },
        })
      : null;
    const isCurrentVersion = !proposal || proposal.status !== 'pending' || currentOrder?.service_version === proposal.order_version;
    const publicProposal = proposal && verifiedSnapshot && isCurrentVersion && proposal.version > 0
      ? {
          version: proposal.version,
          order_version: proposal.order_version,
          snapshot_hash: proposal.snapshot_hash,
          lines: this.projectProposalLines(proposal.lines),
          subtotal: String(proposal.subtotal),
          tax: String(proposal.tax),
          discount: String(proposal.discount),
          currency: proposal.currency,
          total: String(proposal.total),
          status: proposal.status === 'pending' && proposal.expires_at <= new Date() ? 'expired' : proposal.status,
          expires_at: proposal.expires_at,
        }
      : null;
    return {
      status: binding.status,
      budget: budget ? {
        amount: String(budget.amount),
        currency: budget.currency,
        version: budget.version,
        approved_at: budget.approved_at,
      } : null,
      proposal: publicProposal,
      events: events.slice(0, 100).reverse().filter((e) => PUBLIC_EVENT_TYPES.has(e.event_type)).map((e) => ({
        type: e.event_type,
        text: e.public_text,
        created_at: e.created_at,
      })),
      events_have_older: events.length > 100,
    };
  }

  private projectProposalLines(raw: unknown): Array<Record<string, string | number | boolean | null>> {
    const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const rawItems = Array.isArray(value.items) ? value.items : Array.isArray(raw) ? raw : [];
    return rawItems.slice(0, 100).map((candidate) => {
      const source = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : {};
      const line: Record<string, string | number | boolean | null> = {};
      for (const [key, item] of Object.entries(source)) {
        if (!PUBLIC_LINE_FIELDS.has(key)) continue;
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
          line[key] = item;
        }
      }
      return line;
    });
  }

  private verifyProposalSnapshot(proposal: {
    lines: unknown;
    snapshot_hash: string;
    subtotal: Prisma.Decimal;
    tax: Prisma.Decimal;
    discount: Prisma.Decimal;
    currency: string;
    total: Prisma.Decimal;
    expires_at: Date;
  }): boolean {
    if (!/^[a-f0-9]{64}$/i.test(proposal.snapshot_hash)) return false;
    const lines = proposal.lines && typeof proposal.lines === 'object'
      ? proposal.lines as Record<string, unknown>
      : null;
    if (!lines || !('items' in lines) || !('budget_snapshot' in lines)) return false;
    const normalized = {
      lines: lines.items,
      subtotal: new Prisma.Decimal(proposal.subtotal).toFixed(2),
      tax: new Prisma.Decimal(proposal.tax).toFixed(2),
      discount: new Prisma.Decimal(proposal.discount).toFixed(2),
      currency: proposal.currency,
      total: new Prisma.Decimal(proposal.total).toFixed(2),
      expires_at: proposal.expires_at.toISOString(),
    };
    const calculated = createHash('sha256')
      .update(canonicalJson({ ...normalized, budget_snapshot: lines }))
      .digest('hex');
    return calculated === proposal.snapshot_hash;
  }

  streamPublicProgress(token: string, context: RequestContext): Observable<any> {
    return defer(() => from(RequestContextService.run(context, () => this.resolveToken(token)))).pipe(
      mergeMap(async (binding) => {
        const key = `service-session:${binding.store_id}:${binding.session_id}:public-streams`;
        const connectionId = randomUUID();
        const now = Date.now();
        const reserved = await this.redis.eval(
          RESERVE_STREAM, 1, key, connectionId, now - 90_000, STREAM_CAP, now, STREAM_TTL_SECONDS,
        );
        if (Number(reserved) !== 1) {
          throw new HttpException(
            { statusCode: 429, error_code: 'SERVICE_QR_002', message: 'Too many progress connections' },
            429,
          );
        }
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          this.notifications.unsubscribe(binding.store_id);
          void this.redis.zrem(key, connectionId).catch(() => undefined);
        };

        const snapshot$ = from(RequestContextService.run(context, () => this.getPublicProgress(token))).pipe(
          map((snapshot) => ({ type: 'snapshot', data: snapshot })),
        );
        const live$ = this.notifications.getOrCreate(binding.store_id).pipe(
          filter((message: any) => message?.type === 'service_session.progress' && message?.data?.session_id === binding.session_id),
          mergeMap((message: any) => from(RequestContextService.run(context, async () => {
            await this.resolveToken(token);
            if (!PUBLIC_EVENT_TYPES.has(message.data.event_type)) return null;
            const event = await this.prisma.service_progress_events.findFirst({
              where: {
                store_id: binding.store_id,
                session_id: binding.session_id,
                event_type: message.data.event_type,
                public_text: { not: null },
              },
              select: { public_text: true, created_at: true },
              orderBy: { created_at: 'desc' },
            });
            return {
              type: 'progress',
              data: {
                type: message.data.event_type,
                status: typeof message.data.status === 'string' ? message.data.status : binding.status,
                text: event?.public_text ?? null,
                created_at: event?.created_at ?? new Date().toISOString(),
              },
            };
          })).pipe(
            filter((event): event is NonNullable<typeof event> => event !== null),
            catchError(() => of({ type: 'link_expired', data: { status: 'unavailable' } })),
          )),
        );
        const heartbeat$ = timer(30_000, 30_000).pipe(
          mergeMap(async () => {
            const now = Date.now();
            const refreshed = await this.redis.eval(
              REFRESH_STREAM, 1, key, now - 90_000, connectionId, now, STREAM_TTL_SECONDS,
            );
            if (Number(refreshed) !== 1) throw this.unavailable();
            await RequestContextService.run(context, () => this.resolveToken(token));
            return { type: 'heartbeat', data: {} };
          }),
          catchError(() => of({ type: 'link_expired', data: { status: 'unavailable' } })),
        );
        return merge(snapshot$, live$, heartbeat$).pipe(
          takeWhile((event) => event.type !== 'link_expired', true),
          finalize(release),
        );
      }),
      catchError((error: unknown) =>
        error instanceof HttpException && error.getStatus() === 410
          ? EMPTY
          : throwError(() => error),
      ),
    );
  }

  private async resolveToken(token: string) {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id;
    // Malformed, expired, revoked, wrong-store, and terminal-session links share one response.
    if (!storeId || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw this.unavailable();
    }
    const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
    const row = await this.prisma.service_session_tokens.findFirst({
      where: {
        store_id: storeId, token_hash: tokenHash, revoked_at: null, expires_at: { gt: new Date() },
      },
      select: { store_id: true, session_id: true },
    });
    if (!row) throw this.unavailable();
    const session = await this.prisma.service_sessions.findFirst({
      where: { id: row.session_id, store_id: storeId, status: { in: ['open', 'paused'] } },
      select: { id: true, status: true, order_id: true },
    });
    if (!session) throw this.unavailable();
    return { store_id: row.store_id, session_id: session.id, status: session.status, order_id: session.order_id };
  }

  private unavailable(): any {
    return new HttpException(
      { statusCode: TOKEN_GONE.status, error_code: TOKEN_GONE.code, message: TOKEN_GONE.message },
      TOKEN_GONE.status,
    );
  }
}
