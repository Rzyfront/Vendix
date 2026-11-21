import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import Redis from 'ioredis';
import { store_subscription_state_enum } from '@prisma/client';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import {
  AI_AGENT_LABELS,
  AIEntitlement,
  legacyFlagsToAIEntitlements,
} from '../types/ai-capabilities';
import { SubscriptionResolverService } from './subscription-resolver.service';
import { AIEntitlementsResolverService } from './ai-entitlements-resolver.service';
import { aiEntitlementsMode } from './ai-entitlements-mode';

/** The two agents with their own quotas (T14). */
export const QUOTA_AGENT_KEYS = ['vex', 'vexi'] as const;
export type QuotaAgentKey = (typeof QUOTA_AGENT_KEYS)[number];

export function isQuotaAgentKey(value: unknown): value is QuotaAgentKey {
  return value === 'vex' || value === 'vexi';
}

/** Exact notice when an agent's monthly voice readout runs out (§3.7). */
export const VOICE_QUOTA_EXHAUSTED_MESSAGE =
  'Se acabó la lectura en voz de este mes';

export function voiceNotInPlanMessage(agent: QuotaAgentKey): string {
  return `Tu plan no incluye la lectura en voz de ${AI_AGENT_LABELS[agent]}.`;
}

/**
 * Whether an agent may read its answer aloud right now.
 *
 * - `ok`: speak; `used`/`cap` in seconds (`cap: null` = no limit).
 * - `disabled`: the plan does not include this agent's voice.
 * - `exhausted`: the monthly seconds ran out — the answer goes out as text with
 *   `VOICE_QUOTA_EXHAUSTED_MESSAGE`. Voice is a cost item: it always stops at
 *   the cap, whatever `on_limit` says (the matrix states it, F4).
 * - `unavailable`: the decision could not be computed (database or Redis
 *   down). Callers fail open, as before T14: the chat still reads the answer
 *   aloud and voice confirmations still run, and no plan notice is shown (no
 *   notice is better than a false one). Each generated second is still metered.
 */
export interface AgentVoiceDecision {
  status: 'ok' | 'disabled' | 'exhausted' | 'unavailable';
  cap: number | null;
  used: number;
}

export type AgentUsageMeterKind = 'messages' | 'tokens' | 'voice_seconds';

export interface AgentUsageMeter {
  capability_key: string;
  kind: AgentUsageMeterKind;
  label: string;
  unit: 'messages' | 'tokens' | 'seconds';
  period: 'daily' | 'monthly';
  used: number;
  /** `null` = no limit. */
  cap: number | null;
  enabled: boolean;
}

export interface AgentUsageView {
  enabled: boolean;
  meters: AgentUsageMeter[];
}

export type AgentUsage = Record<QuotaAgentKey, AgentUsageView>;

interface MeterDefinition {
  capability: 'agent' | 'model_tokens' | 'voice_readout';
  kind: AgentUsageMeterKind;
  label: string;
  unit: AgentUsageMeter['unit'];
  period: AgentUsageMeter['period'];
  /** Redis key holding the raw counter for this meter. */
  key: (storeId: number, periodKey: string) => string;
  /** Raw counter → displayed unit. */
  toUnit?: (raw: number) => number;
}

/**
 * The counters each meter reads. Messages and Vex tokens are the counters the
 * gate already writes (`ai:quota:{store}:streaming_chat:{day}` for Vexi,
 * `vex_agent` extras for Vex); voice and Vexi tokens are new per-agent counters.
 */
const METERS: Record<QuotaAgentKey, MeterDefinition[]> = {
  vex: [
    {
      capability: 'agent',
      kind: 'messages',
      label: 'Mensajes',
      unit: 'messages',
      period: 'daily',
      key: (s, p) => `ai:quota:${s}:vex_agent:daily_messages:${p}`,
    },
    {
      capability: 'model_tokens',
      kind: 'tokens',
      label: 'Tokens del modelo',
      unit: 'tokens',
      period: 'monthly',
      key: (s, p) => `ai:quota:${s}:vex_agent:monthly_tokens:${p}`,
    },
    {
      capability: 'voice_readout',
      kind: 'voice_seconds',
      label: 'Lectura en voz',
      unit: 'seconds',
      period: 'monthly',
      key: (s, p) => agentCounterKey(s, 'vex', 'voice_ms', p),
      toUnit: msToSeconds,
    },
  ],
  vexi: [
    {
      capability: 'agent',
      kind: 'messages',
      label: 'Mensajes',
      unit: 'messages',
      period: 'daily',
      key: (s, p) => `ai:quota:${s}:streaming_chat:${p}`,
    },
    {
      capability: 'model_tokens',
      kind: 'tokens',
      label: 'Tokens del modelo',
      unit: 'tokens',
      period: 'monthly',
      key: (s, p) => agentCounterKey(s, 'vexi', 'tokens', p),
    },
    {
      capability: 'voice_readout',
      kind: 'voice_seconds',
      label: 'Lectura en voz',
      unit: 'seconds',
      period: 'monthly',
      key: (s, p) => agentCounterKey(s, 'vexi', 'voice_ms', p),
      toUnit: msToSeconds,
    },
  ],
};

type AgentCounter = 'voice_ms' | 'tokens';

function agentCounterKey(
  storeId: number,
  agent: QuotaAgentKey,
  counter: AgentCounter,
  periodKey: string,
): string {
  return `ai:quota:${storeId}:agent:${agent}:${counter}:${periodKey}`;
}

function msToSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

/** Same Lua as `SubscriptionAccessService.consumeQuotaLua`: dedup + INCRBY. */
const CONSUME_LUA = `
  if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return 0 end
  redis.call('SADD', KEYS[2], ARGV[1])
  redis.call('EXPIRE', KEYS[2], ARGV[3])
  local v = redis.call('INCRBY', KEYS[1], ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  return v
`;

const MONTHLY_TTL_SECONDS = 40 * 24 * 60 * 60;

export interface EffectiveAIEntitlements {
  found: boolean;
  hasPlan: boolean;
  rows: AIEntitlement[];
  /**
   * Subscription state of the record, when there is one: the gate blocks by
   * state before it looks at the rows (`subscriptionStateToGateMode`).
   */
  state?: store_subscription_state_enum;
}

/**
 * Rows the gate decides with. `enforce`: the table rows only, and none when
 * they could not be read (fail-closed). `shadow`: the legacy JSON translated by
 * the catalog, except the voice row, which is AND-ed with the per-agent row
 * (it can only restrict) and takes its per-agent cap.
 */
function combineEffectiveRows(
  legacyFeatures: unknown,
  tableRows: AIEntitlement[] | null,
): AIEntitlement[] {
  if (aiEntitlementsMode() === 'enforce') return tableRows ?? [];
  const legacyRows = legacyFlagsToAIEntitlements(legacyFeatures);
  if (!tableRows) return legacyRows;
  return legacyRows.map((row) => {
    if (row.capability_key !== 'voice_readout') return row;
    const perAgent = tableRows.find(
      (n) =>
        n.agent_key === row.agent_key && n.capability_key === row.capability_key,
    );
    if (!perAgent) return row;
    return {
      ...row,
      enabled: row.enabled && perAgent.enabled,
      cap_value: perAgent.cap_value,
    };
  });
}

/**
 * T14 — per-agent quotas: voice readout seconds, Vexi tokens and the usage
 * bars of each agent.
 *
 * Decides with the effective entitlement rows of the store:
 * - `enforce` (T20): the `plan_ai_entitlements` rows only.
 * - `shadow` (default): the legacy JSON translated by the catalog, which is
 *   what the gate decides with today. The one exception is the voice row: the
 *   legacy JSON has a single `realtime_voice` switch, so the per-agent row is
 *   AND-ed with it (it can only restrict) and its cap is the per-agent one.
 */
@Injectable()
export class AgentQuotaService {
  private readonly logger = new Logger(AgentQuotaService.name);

  constructor(
    private readonly resolver: SubscriptionResolverService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional()
    private readonly entitlementsResolver?: AIEntitlementsResolverService,
  ) {}

  async checkAgentVoice(
    storeId: number,
    agent: QuotaAgentKey,
  ): Promise<AgentVoiceDecision> {
    try {
      const effective = await this.effectiveRows(storeId);
      const row = effective?.find(
        (r) => r.agent_key === agent && r.capability_key === 'voice_readout',
      );
      const used = msToSeconds(
        await this.readCounter(
          agentCounterKey(storeId, agent, 'voice_ms', this.periodKey('monthly')),
        ),
      );
      // A cap of 0 is "nothing" in the plan, not a month already spent.
      if (!row || !row.enabled || row.cap_value === 0) {
        return { status: 'disabled', cap: row?.cap_value ?? null, used };
      }
      if (row.cap_value !== null && used >= row.cap_value) {
        return { status: 'exhausted', cap: row.cap_value, used };
      }
      return { status: 'ok', cap: row.cap_value, used };
    } catch (err) {
      this.logger.warn(
        `checkAgentVoice failed for store=${storeId} agent=${agent}: ${(err as Error).message}`,
      );
      return { status: 'unavailable', cap: null, used: 0 };
    }
  }

  /** Adds generated audio (milliseconds) to the agent's monthly counter. */
  async consumeAgentVoice(
    storeId: number,
    agent: QuotaAgentKey,
    milliseconds: number,
    requestId: string,
  ): Promise<void> {
    await this.consume(storeId, agent, 'voice_ms', milliseconds, requestId);
  }

  /** Adds model tokens to the agent's own monthly counter (Vexi, T14). */
  async consumeAgentTokens(
    storeId: number,
    agent: QuotaAgentKey,
    tokens: number,
    requestId: string,
  ): Promise<void> {
    await this.consume(storeId, agent, 'tokens', tokens, requestId);
  }

  /**
   * Messages, tokens and voice of each agent against its effective cap, for
   * the store's agent settings (N7). `null` when the store has no
   * subscription. Read-only: never increments.
   */
  async getAgentUsage(storeId: number): Promise<AgentUsage | null> {
    const effective = await this.effectiveRows(storeId);
    if (!effective) return null;

    const usage = {} as AgentUsage;
    for (const agent of QUOTA_AGENT_KEYS) {
      const meters: AgentUsageMeter[] = [];
      for (const def of METERS[agent]) {
        const row = effective.find(
          (r) => r.agent_key === agent && r.capability_key === def.capability,
        );
        const raw = await this.readCounter(
          def.key(storeId, this.periodKey(def.period)),
        );
        meters.push({
          capability_key: `${agent}.${def.capability}`,
          kind: def.kind,
          label: def.label,
          unit: def.unit,
          period: def.period,
          used: def.toUnit ? def.toUnit(raw) : raw,
          cap: row?.cap_value ?? null,
          enabled: row?.enabled === true,
        });
      }
      const agentRow = effective.find(
        (r) => r.agent_key === agent && r.capability_key === 'agent',
      );
      usage[agent] = { enabled: agentRow?.enabled === true, meters };
    }
    return usage;
  }

  /**
   * T19 — the entitlement rows the gate decides with right now, so "why is it
   * off" never contradicts what actually happens (see class doc).
   * - `found`: the store has a subscription record.
   * - `hasPlan`: `shadow` decides with the legacy JSON, so any subscription
   *   counts; `enforce` decides with the table, so the table must resolve an
   *   effective plan (fail-closed when it cannot be read).
   */
  async resolveEffectiveEntitlements(
    storeId: number,
  ): Promise<EffectiveAIEntitlements> {
    const resolved = await this.resolver.resolveSubscription(storeId);
    if (!resolved.found) return { found: false, hasPlan: false, rows: [] };

    let table: { found: boolean; planId: number | null; rows: AIEntitlement[] } | null =
      null;
    if (this.entitlementsResolver) {
      try {
        table = await this.entitlementsResolver.resolveForStore(storeId);
      } catch (err) {
        this.logger.warn(
          `AI entitlements read failed for store=${storeId}: ${(err as Error).message}`,
        );
      }
    }
    const rows = combineEffectiveRows(
      resolved.features ?? {},
      table?.found ? table.rows : null,
    );
    const hasPlan =
      aiEntitlementsMode() === 'enforce'
        ? table?.found === true && table.planId !== null
        : true;
    return { found: true, hasPlan, rows, state: resolved.state };
  }

  /** The rows the gate decides with; `null` without a subscription record. */
  private async effectiveRows(
    storeId: number,
  ): Promise<AIEntitlement[] | null> {
    const effective = await this.resolveEffectiveEntitlements(storeId);
    return effective.found ? effective.rows : null;
  }

  private async consume(
    storeId: number,
    agent: QuotaAgentKey,
    counter: AgentCounter,
    units: number,
    requestId: string,
  ): Promise<void> {
    if (typeof requestId !== 'string' || requestId.trim().length === 0) {
      throw new InternalServerErrorException(
        'Agent quota consumption requires a non-empty requestId for atomic dedup.',
      );
    }
    if (!Number.isInteger(storeId) || storeId <= 0) return;
    if (!isQuotaAgentKey(agent)) return;
    if (!Number.isFinite(units) || units <= 0) return;

    const periodKey = this.periodKey('monthly');
    const key = agentCounterKey(storeId, agent, counter, periodKey);
    const dedupKey = key.replace('ai:quota:', 'ai:quota:dedup:');
    try {
      await this.redis.eval(
        CONSUME_LUA,
        2,
        key,
        dedupKey,
        requestId,
        Math.floor(units),
        MONTHLY_TTL_SECONDS,
      );
    } catch (err) {
      // Observational counter: a Redis failure must not break the turn.
      this.logger.warn(
        `Agent quota consume failed for store=${storeId} agent=${agent} counter=${counter}: ${(err as Error).message}`,
      );
    }
  }

  private async readCounter(key: string): Promise<number> {
    try {
      const raw = await this.redis.get(key);
      const value = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(value) && value > 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  /** UTC period key, identical to the gate's (`YYYYMM` / `YYYYMMDD`). */
  private periodKey(period: 'daily' | 'monthly'): string {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    if (period === 'monthly') return `${y}${m}`;
    return `${y}${m}${String(now.getUTCDate()).padStart(2, '0')}`;
  }
}
