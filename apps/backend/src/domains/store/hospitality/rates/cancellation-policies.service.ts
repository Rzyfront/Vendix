import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CancellationRuleDto,
  CreateCancellationPolicyDto,
  PenaltyTermDto,
  UpdateCancellationPolicyDto,
} from './dto';
import {
  CancellationPolicySnapshot,
  CancellationRule,
  PenaltyTerm,
} from './lodging-cancellation-penalty';

/** Most nights a penalty can take (a longer stay is charged by percent). */
const MAX_PENALTY_NIGHTS = 30;

/** Snapshot a sold room keeps of its plan's policy (null = no policy). */
export function toPolicySnapshot(
  policy: { id: number; name: string; rules: Prisma.JsonValue; no_show_penalty: Prisma.JsonValue } | null | undefined,
): CancellationPolicySnapshot | null {
  if (!policy) return null;
  return {
    id: policy.id,
    name: policy.name,
    rules: (Array.isArray(policy.rules) ? policy.rules : []) as unknown as CancellationRule[],
    no_show_penalty: (policy.no_show_penalty ?? null) as unknown as PenaltyTerm | null,
  };
}

function normalizeTerm(term: PenaltyTermDto): PenaltyTerm {
  const value = Number(term.penalty_value);
  const valid =
    term.penalty_type === 'nights'
      ? Number.isInteger(value) && value >= 1 && value <= MAX_PENALTY_NIGHTS
      : value >= 0 && value <= 100;
  if (!valid) {
    throw new VendixHttpException(ErrorCodes.LODGING_CANCEL_POLICY_RULES_001);
  }
  return { penalty_type: term.penalty_type, penalty_value: value };
}

/** One rule per window, widest first; only the known fields are stored. */
export function normalizeRules(rules: readonly CancellationRuleDto[]): CancellationRule[] {
  const windows = new Set<number>();
  const normalized = rules.map((rule) => {
    if (windows.has(rule.hours_before)) {
      throw new VendixHttpException(ErrorCodes.LODGING_CANCEL_POLICY_RULES_001);
    }
    windows.add(rule.hours_before);
    return { hours_before: rule.hours_before, ...normalizeTerm(rule) };
  });
  return normalized.sort((a, b) => b.hours_before - a.hours_before);
}

/** A duplicate name becomes a 409; any other error passes through. */
function duplicateNameAs409(error: unknown): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    return new VendixHttpException(ErrorCodes.LODGING_CANCEL_POLICY_DUP_001);
  }
  return error;
}

/**
 * Hospitality Suite (H2.4) — cancellation policies ("Flexible: gratis hasta
 * 48 h, luego 1 noche") assigned to rate plans. A sold room keeps a snapshot,
 * so editing a policy never changes existing reservations. Policies are
 * switched off, not deleted.
 */
@Injectable()
export class LodgingCancellationPoliciesService {
  constructor(private readonly prisma: StorePrismaService) {}

  findAll() {
    return this.prisma.lodging_cancellation_policies.findMany({
      orderBy: [{ is_active: 'desc' }, { name: 'asc' }],
    });
  }

  async findOne(id: number) {
    const policy = await this.prisma.lodging_cancellation_policies.findFirst({ where: { id } });
    if (!policy) {
      throw new VendixHttpException(ErrorCodes.LODGING_CANCEL_POLICY_FIND_001);
    }
    return policy;
  }

  async create(dto: CreateCancellationPolicyDto) {
    const store_id = this.requireStoreId();
    const rules = normalizeRules(dto.rules);
    const no_show_penalty = dto.no_show_penalty ? normalizeTerm(dto.no_show_penalty) : null;
    try {
      return await this.prisma.lodging_cancellation_policies.create({
        data: {
          store_id,
          name: dto.name,
          rules: rules as unknown as Prisma.InputJsonValue,
          no_show_penalty: no_show_penalty
            ? (no_show_penalty as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          is_active: dto.is_active ?? true,
          updated_at: new Date(),
        },
      });
    } catch (error) {
      throw duplicateNameAs409(error);
    }
  }

  async update(id: number, dto: UpdateCancellationPolicyDto) {
    const current = await this.findOne(id);
    const data: Prisma.lodging_cancellation_policiesUpdateInput = { updated_at: new Date() };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.is_active !== undefined) data.is_active = dto.is_active;
    if (dto.rules !== undefined) {
      data.rules = normalizeRules(dto.rules) as unknown as Prisma.InputJsonValue;
    }
    if (dto.no_show_penalty !== undefined) {
      data.no_show_penalty = dto.no_show_penalty
        ? (normalizeTerm(dto.no_show_penalty) as unknown as Prisma.InputJsonValue)
        : Prisma.DbNull;
    }
    try {
      return await this.prisma.lodging_cancellation_policies.update({
        where: { id: current.id },
        data,
      });
    } catch (error) {
      throw duplicateNameAs409(error);
    }
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
