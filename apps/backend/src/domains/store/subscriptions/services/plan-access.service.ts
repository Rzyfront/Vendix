import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { AccessGateModeService } from '../../../../common/access/access-gate-mode.service';
import { AccessGateMode } from '../../../../common/access/access-audit.types';
import {
  PlanModuleRulesService,
  PlanOffer,
} from '../../../../common/access/plan-module-rules.service';
import { planModuleFamily } from '../../../../common/access/plan-modules';
import { SubscriptionResolverService } from './subscription-resolver.service';

/** Panel route of the plan catalog; the paywall CTA preselects plan/cycle. */
export const PLAN_CATALOG_ROUTE = '/admin/subscription/plans';

export interface CurrentPlan {
  code: string;
  name: string;
  cycle: string | null;
}

/** Plan layer of `GET /{store|organization}/access-gate`. */
export interface PlanGateState {
  mode: AccessGateMode;
  current_plan: CurrentPlan | null;
  /** Module keys the plan does not include (exempt keys never appear). */
  blocked: string[];
  /** Sellable plans that include each blocked key, cheapest first. */
  required_plans: Record<string, PlanOffer[]>;
}

/** `details` of `403 PLAN_MODULE_NOT_INCLUDED`. */
export interface PlanModuleDenial {
  module: string;
  module_name: string | null;
  current_plan: CurrentPlan | null;
  required_plans: PlanOffer[];
  upgrade_url: string;
}

export function upgradeUrl(
  moduleKey: string,
  offer: Pick<PlanOffer, 'code' | 'cycle'> | null,
): string {
  const params = new URLSearchParams();
  if (offer) {
    params.set('plan', offer.code);
    params.set('cycle', offer.cycle);
  }
  params.set('from', moduleKey);
  return `${PLAN_CATALOG_ROUTE}?${params.toString()}`;
}

/**
 * Plan layer of the access gate (odd/tasks/planes-matriz-accesos.md §4.2).
 *
 * The plan in force is resolved exactly as the AI gate does
 * (`SubscriptionResolverService`: trial → `plan_id`, otherwise the paid plan;
 * promotions and partner overrides only reshape AI caps, never the plan
 * identity). A store without a plan, or whose plan is outside the matrix
 * (promotional, archived, legacy), is never blocked here: the subscription
 * gate owns "no plan / unpaid".
 *
 * Organization panel: a module is blocked only when EVERY active store of the
 * organization lacks it (same union rule as the industry layer).
 */
@Injectable()
export class PlanAccessService {
  private readonly logger = new Logger(PlanAccessService.name);

  constructor(
    private readonly resolver: SubscriptionResolverService,
    private readonly rules: PlanModuleRulesService,
    private readonly modeService: AccessGateModeService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  async currentPlanForStore(storeId: number): Promise<CurrentPlan | null> {
    try {
      const resolved = await this.resolver.resolveSubscription(storeId);
      if (!resolved.found || !resolved.planCode) return null;
      const known = await this.rules.planByCode(resolved.planCode);
      if (known) {
        return { code: known.code, name: known.name, cycle: known.cycle };
      }
      const row = await this.globalPrisma.subscription_plans.findUnique({
        where: { code: resolved.planCode },
        select: { code: true, name: true, billing_cycle: true },
      });
      return row
        ? { code: row.code, name: row.name, cycle: row.billing_cycle }
        : { code: resolved.planCode, name: resolved.planCode, cycle: null };
    } catch (error) {
      // Fail-open: an unresolvable plan never blocks.
      this.logger.warn(
        `plan resolve failed for store=${storeId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  async blockedForStore(storeId: number): Promise<{
    current: CurrentPlan | null;
    blocked: string[];
  }> {
    const current = await this.currentPlanForStore(storeId);
    const blocked = current ? await this.rules.blockedModules(current.code) : [];
    return { current, blocked };
  }

  async blockedForOrganization(organizationId: number): Promise<string[]> {
    const stores = await this.globalPrisma.stores.findMany({
      where: { organization_id: organizationId, is_active: true },
      select: { id: true },
    });
    if (!stores.length) return [];
    let common: Set<string> | null = null;
    for (const store of stores) {
      const { blocked } = await this.blockedForStore(store.id);
      const set = new Set(blocked);
      common = common
        ? new Set([...common].filter((key) => set.has(key)))
        : set;
      if (!common.size) return [];
    }
    return [...(common ?? [])].sort();
  }

  async storeState(storeId: number | null | undefined): Promise<PlanGateState> {
    if (!storeId) return this.emptyState('audit');
    const [mode, { current, blocked }] = await Promise.all([
      this.modeService.planModeForStore(storeId),
      this.blockedForStore(storeId),
    ]);
    return {
      mode,
      current_plan: current,
      blocked,
      required_plans: await this.offersByKey(blocked),
    };
  }

  async organizationState(
    organizationId: number | null | undefined,
  ): Promise<PlanGateState> {
    const mode = await this.modeService.planModeForOrganization();
    if (!organizationId) return this.emptyState(mode);
    const blocked = await this.blockedForOrganization(organizationId);
    return {
      mode,
      current_plan: null,
      blocked,
      required_plans: await this.offersByKey(blocked),
    };
  }

  /** Payload of the 403 for one denied module. */
  async denial(
    moduleKey: string,
    current: CurrentPlan | null,
  ): Promise<PlanModuleDenial> {
    const offers = await this.rules.offersFor(moduleKey);
    const preferred =
      offers.find((offer) => offer.cycle === current?.cycle) ??
      offers[0] ??
      null;
    return {
      module: moduleKey,
      module_name: planModuleFamily(moduleKey)?.name ?? null,
      current_plan: current,
      required_plans: offers,
      upgrade_url: upgradeUrl(moduleKey, preferred),
    };
  }

  private async offersByKey(
    keys: string[],
  ): Promise<Record<string, PlanOffer[]>> {
    const entries = await Promise.all(
      keys.map(async (key) => [key, await this.rules.offersFor(key)] as const),
    );
    return Object.fromEntries(entries);
  }

  private emptyState(mode: AccessGateMode): PlanGateState {
    return { mode, current_plan: null, blocked: [], required_plans: {} };
  }
}
