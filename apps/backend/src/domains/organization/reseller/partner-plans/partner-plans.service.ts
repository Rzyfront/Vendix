import { Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  CreatePartnerPlanOverrideDto,
  UpdatePartnerPlanOverrideDto,
  PartnerPlanQueryDto,
} from './dto';

@Injectable()
export class PartnerPlansService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly globalPrisma: GlobalPrismaService,
  ) {}

  async findAll(query: PartnerPlanQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const sort_by = query.sort_by ?? 'created_at';
    const sort_order = query.sort_order ?? 'desc';
    const { is_active, search } = query;
    const skip = (page - 1) * limit;

    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const where: any = {};
    if (is_active !== undefined) {
      where.is_active = is_active;
    }
    if (search) {
      where.OR = [
        { custom_name: { contains: search, mode: 'insensitive' } },
        { custom_code: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.globalPrisma.partner_plan_overrides.findMany({
        where: { ...where, organization_id: ctx.organization_id },
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          base_plan: {
            select: {
              id: true,
              code: true,
              name: true,
              base_price: true,
              currency: true,
              billing_cycle: true,
            },
          },
        },
      }),
      this.globalPrisma.partner_plan_overrides.count({
        where: { ...where, organization_id: ctx.organization_id },
      }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async create(dto: CreatePartnerPlanOverrideDto) {
    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const base_plan = await this.globalPrisma.subscription_plans.findUnique({
      where: { id: dto.base_plan_id },
    });

    if (!base_plan) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Base plan not found',
      );
    }

    if (!base_plan.resellable) {
      throw new VendixHttpException(ErrorCodes.PLAN_002);
    }

    if (
      base_plan.max_partner_margin_pct !== null &&
      base_plan.max_partner_margin_pct !== undefined &&
      dto.margin_pct > Number(base_plan.max_partner_margin_pct)
    ) {
      throw new VendixHttpException(ErrorCodes.PARTNER_002);
    }

    return this.globalPrisma.partner_plan_overrides.create({
      data: {
        organization_id: ctx.organization_id,
        base_plan_id: dto.base_plan_id,
        custom_code: dto.custom_code,
        custom_name: dto.custom_name,
        custom_description: dto.custom_description,
        margin_pct: dto.margin_pct,
        fixed_surcharge: dto.fixed_surcharge,
        is_active: dto.is_active ?? true,
        feature_overrides: dto.feature_overrides ?? {},
      },
      include: {
        base_plan: {
          select: {
            id: true,
            code: true,
            name: true,
            base_price: true,
            currency: true,
          },
        },
      },
    });
  }

  async update(id: number, dto: UpdatePartnerPlanOverrideDto) {
    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const existing = await this.globalPrisma.partner_plan_overrides.findUnique({
      where: { id },
    });

    if (!existing || existing.organization_id !== ctx.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Plan override not found',
      );
    }

    if (dto.margin_pct !== undefined) {
      const base_plan = await this.globalPrisma.subscription_plans.findUnique({
        where: { id: existing.base_plan_id },
      });

      if (
        base_plan?.max_partner_margin_pct !== null &&
        base_plan?.max_partner_margin_pct !== undefined &&
        dto.margin_pct > Number(base_plan.max_partner_margin_pct)
      ) {
        throw new VendixHttpException(ErrorCodes.PARTNER_002);
      }
    }

    return this.globalPrisma.partner_plan_overrides.update({
      where: { id },
      data: {
        ...(dto.custom_code !== undefined && { custom_code: dto.custom_code }),
        ...(dto.custom_name !== undefined && { custom_name: dto.custom_name }),
        ...(dto.custom_description !== undefined && {
          custom_description: dto.custom_description,
        }),
        ...(dto.margin_pct !== undefined && { margin_pct: dto.margin_pct }),
        ...(dto.fixed_surcharge !== undefined && {
          fixed_surcharge: dto.fixed_surcharge,
        }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...(dto.feature_overrides !== undefined && {
          feature_overrides: dto.feature_overrides,
        }),
        updated_at: new Date(),
      },
      include: {
        base_plan: {
          select: {
            id: true,
            code: true,
            name: true,
            base_price: true,
            currency: true,
          },
        },
      },
    });
  }

  async deactivate(id: number) {
    const ctx = RequestContextService.getContext();
    if (!ctx?.organization_id) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const existing = await this.globalPrisma.partner_plan_overrides.findUnique({
      where: { id },
    });

    if (!existing || existing.organization_id !== ctx.organization_id) {
      throw new VendixHttpException(
        ErrorCodes.SYS_NOT_FOUND_001,
        'Plan override not found',
      );
    }

    return this.globalPrisma.partner_plan_overrides.update({
      where: { id },
      data: {
        is_active: false,
        updated_at: new Date(),
      },
    });
  }
}
