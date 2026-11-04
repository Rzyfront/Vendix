import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import {
  PlanModuleRule,
  planBlockedModules,
  requiredPlanCodes,
} from './plan-modules';

/** Public catalog data of a plan that includes a module (paywall offer). */
export interface PlanOffer {
  code: string;
  name: string;
  price: number;
  currency: string;
  cycle: string;
}

interface PlanRow extends PlanOffer {
  sellable: boolean;
  sort_order: number;
}

interface Snapshot {
  rules: PlanModuleRule[];
  plans: Map<string, PlanRow>;
  loadedAt: number;
}

/** The table is tiny (dozens of rows) and read on every gated request. */
export const PLAN_RULES_CACHE_TTL_MS = 60_000;

/**
 * Reads `plan_module_rules` (plus the public data of the plans they name) and
 * answers the pure questions of `plan-modules.ts`: which modules a plan lacks
 * and which sellable plans include a module. In-memory snapshot per process,
 * refreshed every minute or on `invalidate()`.
 *
 * DB failure: keeps the last good snapshot; with none, behaves as an empty
 * matrix (nothing blocked). The plan layer must never take the panel down.
 */
@Injectable()
export class PlanModuleRulesService {
  private readonly logger = new Logger(PlanModuleRulesService.name);
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  invalidate(): void {
    this.snapshot = null;
  }

  async blockedModules(planCode: string | null | undefined): Promise<string[]> {
    const { rules } = await this.load();
    return planBlockedModules(planCode, rules);
  }

  /**
   * Sellable plans (active, not archived, not promotional) that include `key`,
   * cheapest first.
   */
  async offersFor(key: string): Promise<PlanOffer[]> {
    const { rules, plans } = await this.load();
    return requiredPlanCodes(key, rules)
      .map((code) => plans.get(code))
      .filter((row): row is PlanRow => !!row && row.sellable)
      .sort((a, b) => a.price - b.price || a.sort_order - b.sort_order)
      .map(({ code, name, price, currency, cycle }) => ({
        code,
        name,
        price,
        currency,
        cycle,
      }));
  }

  /** Public data of one plan code, if it exists. */
  async planByCode(code: string | null | undefined): Promise<PlanOffer | null> {
    if (!code) return null;
    const { plans } = await this.load();
    const row = plans.get(code);
    if (row) {
      const { code: c, name, price, currency, cycle } = row;
      return { code: c, name, price, currency, cycle };
    }
    return null;
  }

  private async load(now: number = Date.now()): Promise<Snapshot> {
    if (this.snapshot && now - this.snapshot.loadedAt < PLAN_RULES_CACHE_TTL_MS) {
      return this.snapshot;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.read(now)
      .then((snapshot) => {
        this.snapshot = snapshot;
        return snapshot;
      })
      .catch((error) => {
        this.logger.warn(
          `plan_module_rules unavailable, plan layer allows everything: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return (
          this.snapshot ?? { rules: [], plans: new Map(), loadedAt: now }
        );
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }

  private async read(now: number): Promise<Snapshot> {
    const rows = await this.globalPrisma.plan_module_rules.findMany({
      select: {
        module_key: true,
        mode: true,
        plan: {
          select: {
            code: true,
            name: true,
            base_price: true,
            currency: true,
            billing_cycle: true,
            state: true,
            archived_at: true,
            is_promotional: true,
            sort_order: true,
          },
        },
      },
    });
    const rules: PlanModuleRule[] = [];
    const plans = new Map<string, PlanRow>();
    for (const row of rows) {
      rules.push({
        plan_code: row.plan.code,
        module_key: row.module_key,
        mode: row.mode,
      });
      if (!plans.has(row.plan.code)) {
        plans.set(row.plan.code, {
          code: row.plan.code,
          name: row.plan.name,
          price: Number(row.plan.base_price),
          currency: row.plan.currency,
          cycle: row.plan.billing_cycle,
          sellable:
            row.plan.state === 'active' &&
            !row.plan.archived_at &&
            !row.plan.is_promotional,
          sort_order: row.plan.sort_order,
        });
      }
    }
    return { rules, plans, loadedAt: now };
  }
}
