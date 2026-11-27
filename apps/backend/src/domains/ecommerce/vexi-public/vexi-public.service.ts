import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../common/redis/redis.module';
import {
  RequestContext,
  RequestContextService,
} from '@common/context/request-context.service';
import { VendixHttpException } from '../../../common/errors/vendix-http.exception';
import { ErrorCodeEntry, ErrorCodes } from '../../../common/errors/error-codes';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { EcommercePrismaService } from '../../../prisma/services/ecommerce-prisma.service';
import { AIAgentService } from '../../../ai-engine/ai-agent.service';
import type { AIMessage } from '../../../ai-engine/interfaces/ai-provider.interface';
import {
  VEXI_AGENT_KEY,
  VEXI_PUBLIC_TOOL_CATALOG,
  VEXI_STOREFRONT_APP_KEY,
} from '../../../ai-engine/tools/agent-tool-catalog';
import {
  StorefrontCard,
  storefrontCardSink,
} from '../../../ai-engine/tools/domains/storefront.tools';
import { CatalogService } from '../catalog/catalog.service';
import { SubscriptionAccessService } from '../../store/subscriptions/services/subscription-access.service';
import { AgentQuotaService } from '../../store/subscriptions/services/agent-quota.service';
import {
  VexiPublicContextDto,
  VexiPublicMessageDto,
} from './dto/vexi-public.dto';

/** App key of the customer-facing prompt (migration `20270106120000_vexi_public_sessions`). */
export { VEXI_STOREFRONT_APP_KEY };

/**
 * Limits of the public chat. Every number here is a cost or abuse bound on an
 * anonymous endpoint that spends the store's AI tokens.
 */
export const VEXI_PUBLIC_LIMITS = Object.freeze({
  sessionTtlHours: 24,
  /** New sessions per visitor IP per hour. */
  sessionsPerIpPerHour: 10,
  /** Messages per session per minute. */
  messagesPerSessionPerMinute: 8,
  /** Messages per visitor IP per minute (NAT-friendly flood net). */
  messagesPerIpPerMinute: 30,
  /** Messages over a session's whole life. */
  messagesPerSession: 60,
  /** Default store-wide cap of visitor messages per UTC day. */
  defaultDailyMessagesPerStore: 500,
  maxMessageChars: 1000,
  historyMessages: 12,
  maxIterations: 6,
});

export interface VexiPublicVisitor {
  /** Store resolved from the public domain (`DomainResolverMiddleware`). */
  store_id: number;
  /** Client IP as resolved behind the trusted proxy chain. */
  ip: string;
  user_agent?: string;
  /** Authenticated storefront user, if any (`@OptionalAuth`). */
  user?: { id?: number; store_id?: number | null; roles?: string[] } | null;
}

export interface VexiPublicConfig {
  enabled: boolean;
  name: 'Vexi';
  greeting: string;
  /** Digits of the store's WhatsApp (handoff after an order), or null. */
  whatsapp_number: string | null;
  store_name: string | null;
}

export interface VexiPublicReply {
  reply: string;
  cards: StorefrontCard[];
}

type StoreRow = { id: number; name: string | null; organization_id: number };

const DISABLED_CONFIG: VexiPublicConfig = Object.freeze({
  enabled: false,
  name: 'Vexi',
  greeting: '',
  whatsapp_number: null,
  store_name: null,
}) as VexiPublicConfig;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10).replace(/-/g, '');
}

/**
 * Vexi público F2 — the anonymous storefront chat.
 *
 * Identity: every turn runs inside a request context built HERE from the
 * public domain only — store and organization, no `user_id`, no roles, no
 * permissions, no bearer. A logged-in storefront customer is recorded on the
 * session, never used as the execution identity, so neither a visitor nor a
 * staff JWT that happens to reach this endpoint can lend the turn an internal
 * identity. The agent is always the closed-catalog `vexi` (F1) with the
 * code-owned storefront catalog: it can read the public catalog and propose,
 * never write.
 *
 * It does not go through `AIChatService`/`resolveChatAgent`: that path needs a
 * staff `user_id` and its conversations are staff data. The agent row is
 * resolved here, fail-closed: missing or inactive `vexi` → the chat is
 * unavailable, never another agent.
 */
@Injectable()
export class VexiPublicService {
  private readonly logger = new Logger(VexiPublicService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly ecommercePrisma: EcommercePrismaService,
    private readonly agent: AIAgentService,
    private readonly catalog: CatalogService,
    private readonly subscriptionAccess: SubscriptionAccessService,
    private readonly quota: AgentQuotaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  // ---------------------------------------------------------------------------
  // Config
  // ---------------------------------------------------------------------------

  /** Public config for the widget. With the flag off it reveals nothing else. */
  async getConfig(storeId: number): Promise<VexiPublicConfig> {
    const store = await this.loadStore(storeId);
    if (!store) return DISABLED_CONFIG;
    return this.withStoreContext(store, async () => {
      const settings = await this.readSettings();
      if (settings?.vexi_public?.enabled !== true) return DISABLED_CONFIG;
      const digits = String(
        settings?.ecommerce?.checkout?.whatsapp_number ?? '',
      ).replace(/\D/g, '');
      return {
        enabled: true,
        name: 'Vexi',
        greeting: `¡Hola! Soy Vexi, de ${store.name ?? 'la tienda'}. ¿Te ayudo a encontrar algo, hacer un pedido o agendar?`,
        whatsapp_number: digits.length >= 7 && digits.length <= 15 ? digits : null,
        store_name: store.name,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------

  async createSession(
    visitor: VexiPublicVisitor,
    input: { consent: boolean; app_type?: string },
  ): Promise<{ session_id: string; token: string; expires_at: string }> {
    const store = await this.requireEnabledStore(visitor.store_id);
    if (input.consent !== true)
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_CONSENT_REQUIRED);
    await this.hit(
      `vexi_public:sess:ip:${sha256(visitor.ip)}`,
      VEXI_PUBLIC_LIMITS.sessionsPerIpPerHour,
      3600,
      ErrorCodes.VEXI_PUBLIC_RATE_LIMITED,
    );
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expires = new Date(
      now.getTime() + VEXI_PUBLIC_LIMITS.sessionTtlHours * 3600_000,
    );
    const row = await this.withStoreContext<{
      public_id: string;
      expires_at: Date;
    }>(store, () =>
      this.ecommercePrisma.vexi_public_sessions.create({
        data: {
          token_hash: sha256(token),
          store_id: store.id,
          organization_id: store.organization_id,
          customer_user_id: this.customerUserId(visitor),
          visitor_hash: sha256(`${visitor.ip}|${visitor.user_agent ?? ''}`),
          app_type: input.app_type?.slice(0, 40) ?? null,
          consent_at: now,
          expires_at: expires,
        },
        select: { public_id: true, expires_at: true },
      }),
    );
    return {
      session_id: row.public_id,
      token,
      expires_at: row.expires_at.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Turn
  // ---------------------------------------------------------------------------

  async sendMessage(
    visitor: VexiPublicVisitor,
    sessionId: string,
    token: string | undefined,
    dto: VexiPublicMessageDto,
  ): Promise<VexiPublicReply> {
    const store = await this.requireEnabledStore(visitor.store_id);
    const text = String(dto.message ?? '').trim();
    if (!text)
      throw new VendixHttpException(
        ErrorCodes.VEXI_PUBLIC_SESSION_INVALID,
        'Mensaje vacío.',
      );

    return this.withStoreContext(store, async () => {
      const session = await this.loadSession(store.id, sessionId, token);

      if (session.message_count >= VEXI_PUBLIC_LIMITS.messagesPerSession)
        throw new VendixHttpException(
          ErrorCodes.VEXI_PUBLIC_RATE_LIMITED,
          'Esta conversación llegó a su límite. Abre una nueva.',
        );
      await this.hit(
        `vexi_public:msg:sess:${session.id}`,
        VEXI_PUBLIC_LIMITS.messagesPerSessionPerMinute,
        60,
        ErrorCodes.VEXI_PUBLIC_RATE_LIMITED,
      );
      await this.hit(
        `vexi_public:msg:ip:${sha256(visitor.ip)}`,
        VEXI_PUBLIC_LIMITS.messagesPerIpPerMinute,
        60,
        ErrorCodes.VEXI_PUBLIC_RATE_LIMITED,
      );
      await this.hit(
        `vexi_public:daily:${store.id}:${utcDay()}`,
        this.dailyCap(),
        26 * 3600,
        ErrorCodes.VEXI_PUBLIC_DAILY_CAP,
      );

      const agentRow = await this.resolvePublicAgent();
      const history = await this.ecommercePrisma.vexi_public_messages.findMany({
        where: { session_id: session.id },
        orderBy: { created_at: 'desc' },
        take: VEXI_PUBLIC_LIMITS.historyMessages,
        select: { role: true, content: true },
      });
      const messages: AIMessage[] = history
        .reverse()
        .map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        }));

      await this.ecommercePrisma.vexi_public_messages.create({
        data: { session_id: session.id, store_id: store.id, role: 'user', content: text },
      });

      const appContext = await this.describeContext(dto.context);
      const cards: StorefrontCard[] = [];
      let reply = '';
      let tokens = 0;
      try {
        const result = await storefrontCardSink.run(cards, () =>
          this.agent.runAgent({
            goal: text,
            messages,
            app_key: VEXI_STOREFRONT_APP_KEY,
            variables: {
              store_name: store.name ?? 'la tienda',
              app_context: appContext,
            },
            agent_key: VEXI_AGENT_KEY,
            // Closed catalog: the code-owned storefront list is the ceiling;
            // the row may only subtract (denied_tools), never widen.
            tools: [...VEXI_PUBLIC_TOOL_CATALOG],
            agent_allowed_tools: [...VEXI_PUBLIC_TOOL_CATALOG],
            agent_denied_tools: agentRow.denied_tools,
            max_iterations: Math.min(
              agentRow.max_iterations ?? VEXI_PUBLIC_LIMITS.maxIterations,
              VEXI_PUBLIC_LIMITS.maxIterations,
            ),
            trace_surface: 'text',
          }),
        );
        reply = (result.content ?? '').trim();
        tokens = result.total_tokens ?? 0;
        if (!result.success && !reply)
          reply =
            'Tuve un problema para responder. ¿Me lo repites en un momento?';
      } catch (error) {
        this.logger.warn(
          `Public Vexi turn failed store=${store.id}: ${(error as Error).message}`,
        );
        reply = 'Tuve un problema para responder. ¿Me lo repites en un momento?';
      }

      await this.ecommercePrisma.vexi_public_messages.create({
        data: {
          session_id: session.id,
          store_id: store.id,
          role: 'assistant',
          content: reply,
          cards: cards.length ? (cards as unknown as object) : undefined,
          tokens_used: tokens,
        },
      });
      await this.ecommercePrisma.vexi_public_sessions.update({
        where: { id: session.id },
        data: { message_count: { increment: 1 }, last_message_at: new Date() },
      });
      if (tokens > 0)
        await this.quota
          .consumeAgentTokens(store.id, VEXI_AGENT_KEY, tokens, randomUUID())
          .catch(() => undefined);

      return { reply, cards };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async loadStore(storeId: number): Promise<StoreRow | null> {
    if (!Number.isInteger(storeId) || storeId <= 0) return null;
    return this.globalPrisma.stores.findUnique({
      where: { id: storeId },
      select: { id: true, name: true, organization_id: true },
    });
  }

  /**
   * The turn's execution identity: the public store, nothing else. Replaces
   * (never extends) whatever context the request carried.
   */
  private withStoreContext<T>(store: StoreRow, work: () => Promise<T>): Promise<T> {
    const parent = RequestContextService.asyncLocalStorage.getStore();
    const context: RequestContext = {
      store_id: store.id,
      organization_id: store.organization_id,
      is_super_admin: false,
      is_owner: false,
      roles: [],
      permissions: [],
      request_id: parent?.request_id,
    };
    return RequestContextService.asyncLocalStorage.run(context, work);
  }

  private async readSettings(): Promise<any> {
    const row = await this.ecommercePrisma.store_settings.findFirst({
      select: { settings: true },
    });
    return (row?.settings as any) ?? null;
  }

  private async requireEnabledStore(storeId: number): Promise<StoreRow> {
    const store = await this.loadStore(storeId);
    if (!store) throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_DISABLED);
    const settings = await this.withStoreContext(store, () => this.readSettings());
    if (settings?.vexi_public?.enabled !== true)
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_DISABLED);
    const gate = await this.subscriptionAccess
      .canUseAIFeature(store.id, 'streaming_chat')
      .catch(() => ({ allowed: false }));
    if (!gate.allowed)
      throw new VendixHttpException(
        ErrorCodes.VEXI_PUBLIC_UNAVAILABLE,
        'El plan de la tienda no incluye el asistente.',
      );
    return store;
  }

  /** Fail-closed: only an active `vexi` row; never another agent. */
  private async resolvePublicAgent(): Promise<{
    denied_tools: string[];
    max_iterations: number | null;
  }> {
    const row = await this.globalPrisma.ai_agents
      .findUnique({ where: { key: VEXI_AGENT_KEY } })
      .catch(() => null);
    if (!row || !row.is_active)
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_UNAVAILABLE);
    return {
      denied_tools: row.denied_tools ?? [],
      max_iterations: row.max_iterations ?? null,
    };
  }

  private async loadSession(storeId: number, publicId: string, token?: string) {
    if (!token || !/^[0-9a-f-]{36}$/i.test(publicId))
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_SESSION_INVALID);
    const session = await this.ecommercePrisma.vexi_public_sessions.findFirst({
      where: { public_id: publicId, store_id: storeId },
      select: { id: true, token_hash: true, expires_at: true, message_count: true },
    });
    if (
      !session ||
      session.token_hash !== sha256(token) ||
      session.expires_at.getTime() <= Date.now()
    )
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_SESSION_INVALID);
    return session;
  }

  /** A storefront customer of THIS store; staff or foreign tokens are ignored. */
  private customerUserId(visitor: VexiPublicVisitor): number | null {
    const user = visitor.user;
    if (!user?.id) return null;
    const isCustomer = (user.roles ?? []).some((r) => r === 'customer');
    return isCustomer && Number(user.store_id) === visitor.store_id
      ? Number(user.id)
      : null;
  }

  private dailyCap(): number {
    const raw = Number(process.env.VEXI_PUBLIC_DAILY_MESSAGE_CAP);
    return Number.isInteger(raw) && raw > 0
      ? raw
      : VEXI_PUBLIC_LIMITS.defaultDailyMessagesPerStore;
  }

  /**
   * Fixed-window counter. Fail-CLOSED on Redis errors: these limits bound the
   * store's AI spend on an anonymous endpoint, so an unmetered turn is worse
   * than a refused one.
   */
  private async hit(
    key: string,
    max: number,
    windowSeconds: number,
    code: ErrorCodeEntry,
  ): Promise<void> {
    let current: number;
    try {
      const results = await this.redis.multi().incr(key).exec();
      current = Number(results?.[0]?.[1]);
      if (current === 1) await this.redis.expire(key, windowSeconds);
    } catch (error) {
      this.logger.warn(`Public Vexi limiter unavailable: ${(error as Error).message}`);
      throw new VendixHttpException(ErrorCodes.VEXI_PUBLIC_UNAVAILABLE);
    }
    if (!Number.isFinite(current) || current > max) {
      const ttl = await this.redis.ttl(key).catch(() => windowSeconds);
      throw new VendixHttpException(code, undefined, {
        retry_after: ttl > 0 ? ttl : windowSeconds,
      });
    }
  }

  /**
   * App context as read-only, server-verified data. The client's ids are only
   * pointers: names come from the public catalog of THIS store; an id that
   * is not published there is dropped.
   */
  private async describeContext(context?: VexiPublicContextDto): Promise<string> {
    if (!context) return 'Sin contexto.';
    const parts: string[] = [];
    const app = String(context.app_type ?? '').replace(/[^A-Z_]/g, '').slice(0, 40);
    if (app) parts.push(`App: ${app}.`);
    const route = String(context.route ?? '')
      .replace(/[^a-zA-Z0-9/_-]/g, '')
      .slice(0, 120);
    if (route) parts.push(`Ruta: ${route}.`);
    const cart = (context.cart ?? []).slice(0, 20);
    const ids = [
      ...(context.product_id ? [context.product_id] : []),
      ...cart.map((l) => l.product_id),
    ].filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length) {
      try {
        const result: any = await this.catalog.getProducts({
          ids: [...new Set(ids)].join(','),
          limit: ids.length,
          page: 1,
        } as any);
        const names = new Map<number, string>(
          (result?.data ?? []).map((p: any) => [Number(p.id), String(p.name)]),
        );
        if (context.product_id && names.has(context.product_id))
          parts.push(
            `Está viendo «${names.get(context.product_id)}» (id ${context.product_id}).`,
          );
        const lines = cart
          .filter((l) => names.has(l.product_id))
          .map((l) => `${Math.max(1, Math.trunc(l.quantity || 1))} × ${names.get(l.product_id)} (id ${l.product_id})`);
        if (lines.length) parts.push(`Su carrito tiene: ${lines.join('; ')}.`);
      } catch {
        // Context is a hint; a catalog failure never blocks the turn.
      }
    }
    return parts.length ? parts.join(' ') : 'Sin contexto.';
  }
}
