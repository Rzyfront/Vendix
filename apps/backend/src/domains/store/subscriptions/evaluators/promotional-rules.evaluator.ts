import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PromoEligibilityResult, PromoRules } from '../types/promo.types';

interface PromoCondition {
  field: string;
  op:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'gte'
    | 'lt'
    | 'lte'
    | 'in'
    | 'not_in'
    | 'is_null'
    | 'is_not_null';
  value?: any;
}

interface PromoCriteria {
  conditions: PromoCondition[];
}

@Injectable()
export class PromotionalRulesEvaluator {
  private readonly logger = new Logger(PromotionalRulesEvaluator.name);

  constructor(private readonly prisma: GlobalPrismaService) {}

  /**
   * G9 — Strict eligibility evaluation against the typed `PromoRules` shape.
   *
   * Read-only. Accumulates ALL failing reasons (no short-circuit) so the
   * caller can show a full diff between the store and promo criteria.
   *
   * Throws `SUBSCRIPTION_001` when the plan does not exist.
   */
  async evaluate(
    storeId: number,
    promoPlanId: number,
  ): Promise<PromoEligibilityResult> {
    const promoPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: promoPlanId },
      select: {
        id: true,
        code: true,
        plan_type: true,
        promo_rules: true,
      },
    });

    if (!promoPlan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Plan no encontrado',
      );
    }

    const rules = this.coerceRules(promoPlan.promo_rules);
    const reasons: string[] = [];

    // 1. Time window
    const now = new Date();
    if (rules.starts_at) {
      const starts = new Date(rules.starts_at);
      if (!isNaN(starts.getTime()) && now < starts) {
        reasons.push('not_started');
      }
    }
    if (rules.ends_at) {
      const ends = new Date(rules.ends_at);
      if (!isNaN(ends.getTime()) && now > ends) {
        reasons.push('expired');
      }
    }

    // Resolve store + organization once for downstream checks.
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      select: {
        id: true,
        organization_id: true,
        is_active: true,
      },
    });

    if (!store) {
      // Treat missing store as non-eligible without throwing — callers may be
      // in a public-eligibility context where blanket 404s are noisy.
      reasons.push('store_not_found');
      return {
        promo_plan_id: promoPlan.id,
        promo_plan_code: promoPlan.code,
        eligible: false,
        reasons_blocked: reasons,
      };
    }

    const orgId = store.organization_id;

    // 2. Stores count (active stores in the same organization)
    if (
      typeof rules.stores_min === 'number' ||
      typeof rules.stores_max === 'number'
    ) {
      const storesCount = await this.prisma.stores.count({
        where: { organization_id: orgId, is_active: true },
      });
      if (
        typeof rules.stores_min === 'number' &&
        storesCount < rules.stores_min
      ) {
        reasons.push('stores_min');
      }
      if (
        typeof rules.stores_max === 'number' &&
        storesCount > rules.stores_max
      ) {
        reasons.push('stores_max');
      }
    }

    // 3. Plan type
    if (rules.plan_type_required) {
      if (
        (promoPlan.plan_type as unknown as string) !== rules.plan_type_required
      ) {
        reasons.push('plan_type_mismatch');
      }
    }

    // 4. Region — country lookup via organization addresses (primary or any).
    if (Array.isArray(rules.regions) && rules.regions.length > 0) {
      const country = await this.resolveOrganizationCountry(orgId);
      if (!country || !rules.regions.includes(country)) {
        reasons.push('region_not_eligible');
      }
    }

    // 5. Target / exclude
    if (
      Array.isArray(rules.excluded_organizations) &&
      rules.excluded_organizations.includes(orgId)
    ) {
      reasons.push('excluded');
    }
    if (
      Array.isArray(rules.target_organizations) &&
      rules.target_organizations.length > 0 &&
      !rules.target_organizations.includes(orgId)
    ) {
      reasons.push('not_targeted');
    }

    // 6. Max uses (global)
    if (typeof rules.max_uses === 'number') {
      const totalUses = await this.prisma.store_subscriptions.count({
        where: { plan_id: promoPlanId },
      });
      if (totalUses >= rules.max_uses) {
        reasons.push('max_uses_reached');
      }
    }

    // 7. Max uses per org
    if (typeof rules.max_uses_per_org === 'number') {
      const orgUses = await this.prisma.store_subscriptions.count({
        where: {
          plan_id: promoPlanId,
          store: { organization_id: orgId },
        },
      });
      if (orgUses >= rules.max_uses_per_org) {
        reasons.push('max_uses_per_org_reached');
      }
    }

    return {
      promo_plan_id: promoPlan.id,
      promo_plan_code: promoPlan.code,
      eligible: reasons.length === 0,
      reasons_blocked: reasons,
    };
  }

  /**
   * Best-effort country resolution for an organization.
   *
   * Knowledge gap: the schema has no `organizations.country_code`. We fall
   * back to the org's primary address; if missing we try any org-scoped
   * address; if still missing returns `null`.
   *
   * Returns ISO 3166-1 alpha-2/alpha-3 country code (whatever was stored).
   */
  private async resolveOrganizationCountry(
    orgId: number,
  ): Promise<string | null> {
    const primary = await this.prisma.addresses.findFirst({
      where: { organization_id: orgId, is_primary: true },
      select: { country_code: true },
    });
    if (primary?.country_code) return primary.country_code;

    const any = await this.prisma.addresses.findFirst({
      where: { organization_id: orgId },
      select: { country_code: true },
    });
    return any?.country_code ?? null;
  }

  private coerceRules(raw: unknown): PromoRules {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw as PromoRules;
  }

  // ─── Legacy condition-based evaluator (kept for backward compatibility) ───

  /**
   * Legacy evaluator over the `{ conditions: [...] }` shape. Kept until the
   * old promo_rules JSONs are migrated to the strict `PromoRules` interface.
   *
   * @deprecated use `evaluate(storeId, promoPlanId)` instead.
   */
  evaluateLegacyConditions(
    promoRules: PromoCriteria | null | undefined,
    storeProjection: Record<string, unknown>,
  ): boolean {
    if (
      !promoRules ||
      !promoRules.conditions ||
      !Array.isArray(promoRules.conditions)
    ) {
      return true;
    }

    for (const cond of promoRules.conditions) {
      if (!this.evaluateCondition(cond, storeProjection)) {
        return false;
      }
    }

    return true;
  }

  async evaluateEligibleStores(promoPlanId: number): Promise<number[]> {
    const promoPlan = await this.prisma.subscription_plans.findUnique({
      where: { id: promoPlanId },
    });

    if (!promoPlan) {
      throw new VendixHttpException(
        ErrorCodes.SUBSCRIPTION_001,
        'Promotional plan not found',
      );
    }

    if (!promoPlan.is_promotional) {
      throw new VendixHttpException(ErrorCodes.PROMO_001);
    }

    if (!promoPlan.promo_rules || typeof promoPlan.promo_rules !== 'object') {
      const allStores = await this.prisma.stores.findMany({
        where: { is_active: true },
        select: { id: true },
      });
      return allStores.map((s) => s.id);
    }

    const criteria = promoPlan.promo_rules as unknown as PromoCriteria;
    if (!criteria.conditions || !Array.isArray(criteria.conditions)) {
      const allStores = await this.prisma.stores.findMany({
        where: { is_active: true },
        select: { id: true },
      });
      return allStores.map((s) => s.id);
    }

    const where = this.buildWhereClause(criteria.conditions);

    const eligible = await this.prisma.stores.findMany({
      where: {
        is_active: true,
        ...where,
      },
      select: { id: true },
    });

    return eligible.map((s) => s.id);
  }

  private evaluateCondition(
    cond: PromoCondition,
    storeProjection: Record<string, unknown>,
  ): boolean {
    const fieldValue = storeProjection[cond.field];

    switch (cond.op) {
      case 'eq':
        return fieldValue === cond.value;
      case 'neq':
        return fieldValue !== cond.value;
      case 'gt':
        return typeof fieldValue === 'number' && fieldValue > cond.value;
      case 'gte':
        return typeof fieldValue === 'number' && fieldValue >= cond.value;
      case 'lt':
        return typeof fieldValue === 'number' && fieldValue < cond.value;
      case 'lte':
        return typeof fieldValue === 'number' && fieldValue <= cond.value;
      case 'in':
        if (Array.isArray(cond.value)) {
          return cond.value.includes(fieldValue);
        }
        return fieldValue === cond.value;
      case 'not_in':
        if (Array.isArray(cond.value)) {
          return !cond.value.includes(fieldValue);
        }
        return fieldValue !== cond.value;
      case 'is_null':
        return fieldValue === null || fieldValue === undefined;
      case 'is_not_null':
        return fieldValue !== null && fieldValue !== undefined;
      default:
        this.logger.warn(`Unknown promo condition op: ${cond.op}`);
        return false;
    }
  }

  private buildWhereClause(
    conditions: PromoCondition[],
  ): Prisma.storesWhereInput {
    const andClauses: Prisma.storesWhereInput[] = [];

    for (const cond of conditions) {
      const clause = this.conditionToWhere(cond);
      if (Object.keys(clause).length > 0) {
        andClauses.push(clause);
      }
    }

    if (andClauses.length === 0) return {};
    if (andClauses.length === 1) return andClauses[0];
    return { AND: andClauses };
  }

  private conditionToWhere(cond: PromoCondition): Prisma.storesWhereInput {
    const field = cond.field;
    const storeFields: Record<string, string> = {
      state: 'state',
      is_active: 'is_active',
      organization_id: 'organization_id',
      created_at: 'created_at',
      currency: 'currency',
      country: 'country',
    };

    const prismaField = storeFields[field];
    if (!prismaField) {
      this.logger.warn(`Unknown promo condition field: ${field}`);
      return {};
    }

    switch (cond.op) {
      case 'eq':
        return { [prismaField]: cond.value } as Prisma.storesWhereInput;
      case 'neq':
        return {
          [prismaField]: { not: cond.value },
        } as Prisma.storesWhereInput;
      case 'gt':
        return { [prismaField]: { gt: cond.value } } as Prisma.storesWhereInput;
      case 'gte':
        return {
          [prismaField]: { gte: cond.value },
        } as Prisma.storesWhereInput;
      case 'lt':
        return { [prismaField]: { lt: cond.value } } as Prisma.storesWhereInput;
      case 'lte':
        return {
          [prismaField]: { lte: cond.value },
        } as Prisma.storesWhereInput;
      case 'in':
        return {
          [prismaField]: {
            in: Array.isArray(cond.value) ? cond.value : [cond.value],
          },
        } as Prisma.storesWhereInput;
      case 'not_in':
        return {
          [prismaField]: {
            notIn: Array.isArray(cond.value) ? cond.value : [cond.value],
          },
        } as Prisma.storesWhereInput;
      case 'is_null':
        return { [prismaField]: null } as Prisma.storesWhereInput;
      case 'is_not_null':
        return { [prismaField]: { not: null } } as Prisma.storesWhereInput;
      default:
        this.logger.warn(`Unknown promo condition op: ${cond.op}`);
        return {};
    }
  }
}
