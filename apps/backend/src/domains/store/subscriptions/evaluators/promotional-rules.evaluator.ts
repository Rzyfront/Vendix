import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

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
   * Evaluate a set of promotional rules against a store projection object.
   * Returns true only when ALL conditions pass (AND semantics).
   */
  evaluate(promoRules: PromoCriteria | null | undefined, storeProjection: Record<string, unknown>): boolean {
    if (!promoRules || !promoRules.conditions || !Array.isArray(promoRules.conditions)) {
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
      throw new VendixHttpException(ErrorCodes.SUBSCRIPTION_001, 'Promotional plan not found');
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

  private buildWhereClause(conditions: PromoCondition[]): Prisma.storesWhereInput {
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
        return { [prismaField]: { not: cond.value } } as Prisma.storesWhereInput;
      case 'gt':
        return { [prismaField]: { gt: cond.value } } as Prisma.storesWhereInput;
      case 'gte':
        return { [prismaField]: { gte: cond.value } } as Prisma.storesWhereInput;
      case 'lt':
        return { [prismaField]: { lt: cond.value } } as Prisma.storesWhereInput;
      case 'lte':
        return { [prismaField]: { lte: cond.value } } as Prisma.storesWhereInput;
      case 'in':
        return {
          [prismaField]: { in: Array.isArray(cond.value) ? cond.value : [cond.value] },
        } as Prisma.storesWhereInput;
      case 'not_in':
        return {
          [prismaField]: { notIn: Array.isArray(cond.value) ? cond.value : [cond.value] },
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
