import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../../common/redis/redis.module';
import { AIToolRegistry } from '../../../../ai-engine/tools/ai-tool-registry';
import { IRREVERSIBLE_DOMAIN_SEGMENTS } from '../../../../ai-engine/tools/bridge/capability-registry.service';

/** One approval covers the whole plan; 15 minutes to run it before re-asking. */
export const PLAN_TOKEN_TTL_SECONDS = 900;

export type PlanRedeemOutcome =
  | 'ok'
  | 'missing'
  | 'mismatch'
  | 'unknown_step'
  | 'replayed'
  | 'irreversible';

export interface PlanApprovalStep {
  order: number;
  tool: string;
  args: Record<string, any>;
}

export interface ClassifiedPlanSteps {
  covered: PlanApprovalStep[];
  reconfirm: PlanApprovalStep[];
}

/**
 * Compare-and-consume one step in a single round trip.
 *
 *  1 → consumed, the step may run exactly once
 *  0 → no such token (never issued, or expired)
 * -1 → token exists but the user/plan/step-list fingerprint does not match
 * -2 → the step hash is not part of this plan (arguments were altered)
 * -3 → the step is irreversible: the plan approval never covers it
 * -4 → the step already ran under this token
 */
const REDEEM_STEP_SCRIPT = `
local fp = redis.call('HGET', KEYS[1], 'fp')
if not fp then return 0 end
if fp ~= ARGV[1] then return -1 end
local v = redis.call('HGET', KEYS[1], ARGV[2])
if not v then return -2 end
if v == 'I' then return -3 end
if v == '1' then return -4 end
redis.call('HSET', KEYS[1], ARGV[2], '1')
return 1
`;

/**
 * Domain segments whose writes always re-confirm, even inside an approved plan.
 *
 * Single-sourced from `IRREVERSIBLE_DOMAINS` in
 * `ai-engine/tools/bridge/capability-registry.service.ts` (imported above):
 * the local mirror drifted once (`cash-register` vs `cash-registers`) and let
 * irreversible writes slip through whole-plan approval. Membership is pinned
 * by the spec; the matching logic below is unchanged.
 */

/**
 * Deterministic JSON: object keys sorted at every depth, arrays kept in order.
 * Same function as `VexiConfirmationService` — duplicated rather than imported
 * because that module keeps it private, and the two fingerprints must hash
 * identically for the same arguments.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`);
  return `{${entries.join(',')}}`;
}

/**
 * Whole-plan approval for Vex: one click authorizes every reversible step.
 *
 * The token binds (user, plan, ORDERED step hashes). Order matters because a
 * plan is a sequence — "crear y luego enviar" is not the same approval as
 * "enviar y luego crear" — so the fingerprint hashes the ordered list, while
 * each step redeems independently (a retry of step 2 must not re-run step 1,
 * and must not be blocked by step 3 already consumed).
 *
 * Irreversible steps are fingerprinted but never consumable: redeeming one
 * answers `irreversible` so the caller routes it to its own confirmation card.
 * The token authorizes nothing by itself — each step still executes through
 * `executeTool()`, which re-checks permissions on the way through.
 */
@Injectable()
export class PlanApprovalService {
  private readonly logger = new Logger(PlanApprovalService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly toolRegistry: AIToolRegistry,
  ) {}

  /**
   * Splits the approved steps into those the plan token covers and those that
   * always need their own confirmation. Called at approve time so the plan
   * card can label each step honestly before the person clicks.
   */
  classifySteps(steps: PlanApprovalStep[]): ClassifiedPlanSteps {
    const covered: PlanApprovalStep[] = [];
    const reconfirm: PlanApprovalStep[] = [];
    for (const step of steps) {
      if (this.isIrreversibleStep(step.tool, step.args)) {
        reconfirm.push(step);
      } else {
        covered.push(step);
      }
    }
    return { covered, reconfirm };
  }

  /**
   * Mints the single-use plan token. Every step — including the irreversible
   * ones — is part of the fingerprint, so adding, dropping or reordering a
   * step after approval invalidates the whole token instead of silently
   * narrowing it. The approved list itself is stored server-side in the same
   * hash, so the apply path never trusts a client re-declaration of it.
   */
  async issuePlanToken(
    planId: string,
    userId: number | undefined,
    steps: PlanApprovalStep[],
  ): Promise<string> {
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const hashes = ordered.map((s) => this.stepHash(s.tool, s.args));
    const token = randomUUID();
    const fields: Record<string, string> = {
      fp: this.planFingerprint(planId, userId, hashes),
      steps: JSON.stringify(
        ordered.map((s) => ({ order: s.order, tool: s.tool, args: s.args })),
      ),
    };
    for (let i = 0; i < ordered.length; i++) {
      const step = ordered[i];
      fields[`s:${hashes[i]}`] = this.isIrreversibleStep(step.tool, step.args)
        ? 'I'
        : '0';
    }
    await this.redis.hset(this.key(token), fields);
    await this.redis.expire(this.key(token), PLAN_TOKEN_TTL_SECONDS);
    return token;
  }

  /**
   * Consumes one step of an approved plan. Returns whether the step may run;
   * only `ok` authorizes execution, and each step returns `ok` at most once.
   *
   * The fingerprint is recomputed from the SERVER-stored step list, then the
   * Lua script re-verifies it and consumes the step atomically — the read and
   * the consume are two round trips, but nothing between them is attacker
   * controlled (stored steps, server context), and the consume itself is one
   * script, so a double-clicked approval still applies each step once.
   */
  async redeemPlanStep(
    token: string,
    planId: string,
    userId: number | undefined,
    tool: string,
    args: Record<string, any>,
  ): Promise<PlanRedeemOutcome> {
    const stored = await this.redis.hgetall(this.key(token));
    if (!stored || !stored.fp || !stored.steps) return 'missing';
    let steps: PlanApprovalStep[];
    try {
      const parsed: unknown = JSON.parse(stored.steps);
      if (!Array.isArray(parsed)) return 'mismatch';
      steps = parsed as PlanApprovalStep[];
    } catch {
      return 'mismatch';
    }
    const ordered = [...steps].sort((a, b) => a.order - b.order);
    const hashes = ordered.map((s) => this.stepHash(s.tool, s.args));
    const result = (await this.redis.eval(
      REDEEM_STEP_SCRIPT,
      1,
      this.key(token),
      this.planFingerprint(planId, userId, hashes),
      `s:${this.stepHash(tool, args)}`,
    )) as number;

    if (result === 1) return 'ok';
    if (result === -1) {
      this.logger.warn(
        `Plan token replayed for a different user/plan/step-list (plan "${planId}")`,
      );
      return 'mismatch';
    }
    if (result === -2) {
      this.logger.warn(
        `Plan token replayed against altered arguments for tool "${tool}" (plan "${planId}")`,
      );
      return 'unknown_step';
    }
    if (result === -3) return 'irreversible';
    if (result === -4) {
      this.logger.warn(
        `Plan step "${tool}" replayed after running once (plan "${planId}")`,
      );
      return 'replayed';
    }
    return 'missing';
  }

  private key(token: string): string {
    return `vex:plan:${token}`;
  }

  private stepHash(tool: string, args: Record<string, any>): string {
    return createHash('sha256')
      .update(`${tool}|${canonicalJson(args ?? {})}`)
      .digest('hex');
  }

  private planFingerprint(
    planId: string,
    userId: number | undefined,
    orderedHashes: string[],
  ): string {
    return createHash('sha256')
      .update(`${userId ?? 'anon'}|${planId}|${orderedHashes.join(',')}`)
      .digest('hex');
  }

  /**
   * Whether a step always re-confirms on its own card.
   *
   * Three sources, in order: the explicit `irreversible` mark on the tool
   * (typed tools), the tool's domain landing on an irreversible segment, and —
   * for `write_endpoint`, which has no domain of its own — the path segments
   * and verb of the call it carries. Unknown tools fail closed: forcing the
   * per-step path surfaces the real "tool does not exist" error instead of
   * smuggling an unrecognized write through a bundle approval.
   */
  private isIrreversibleStep(
    toolName: string,
    args: Record<string, any>,
  ): boolean {
    const tool = this.toolRegistry.get(toolName) as
      | { domain?: string; irreversible?: boolean }
      | undefined;
    if (!tool) return true;
    if (tool.irreversible === true) return true;
    if (tool.domain && IRREVERSIBLE_DOMAIN_SEGMENTS.has(tool.domain)) {
      return true;
    }
    if (toolName === 'write_endpoint') {
      const segments = String(args?.path ?? '')
        .split('/')
        .filter(Boolean);
      if (segments.some((s) => IRREVERSIBLE_DOMAIN_SEGMENTS.has(s))) {
        return true;
      }
      if (String(args?.method ?? '').toUpperCase() === 'DELETE') return true;
    }
    return false;
  }
}
