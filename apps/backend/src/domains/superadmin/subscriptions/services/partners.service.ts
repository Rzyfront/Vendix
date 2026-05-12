import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  TogglePartnerDto,
  SetMarginCapDto,
  CreatePartnerOverrideDto,
  UpdatePartnerOverrideDto,
  PartnerQueryDto,
  UpdatePartnerOrganizationDto,
} from '../dto';

interface PartnerSettings {
  max_partner_margin_pct?: number;
  partner_margin_percent?: number;
  partner_margin_cap?: number | null;
  partner_override_pricing?: Record<string, number>;
}

function projectPartner(org: any) {
  const settings: PartnerSettings =
    (org.partner_settings as PartnerSettings) || {};
  return {
    ...org,
    partner_margin_percent: Number(settings.partner_margin_percent ?? 0),
    partner_margin_cap:
      settings.partner_margin_cap === undefined
        ? null
        : settings.partner_margin_cap,
    partner_override_pricing: settings.partner_override_pricing ?? {},
  };
}

@Injectable()
export class PartnersService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async findAllPartners(query: PartnerQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.organizationsWhereInput = {
      is_partner: true,
    };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      this.prisma.organizations.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          partner_overrides: {
            include: {
              base_plan: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      this.prisma.organizations.count({ where }),
    ]);

    return {
      data: data.map(projectPartner),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findPartner(organizationId: number) {
    const org = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
      include: {
        partner_overrides: {
          include: {
            base_plan: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    return projectPartner(org);
  }

  async updatePartnerOrganization(
    organizationId: number,
    dto: UpdatePartnerOrganizationDto,
  ) {
    const org = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
      include: {
        partner_overrides: {
          include: {
            base_plan: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    const currentSettings: PartnerSettings =
      (org.partner_settings as PartnerSettings) || {};

    const nextSettings: PartnerSettings = { ...currentSettings };
    if (dto.partner_margin_percent !== undefined) {
      nextSettings.partner_margin_percent = dto.partner_margin_percent;
    }
    if (dto.partner_margin_cap !== undefined) {
      nextSettings.partner_margin_cap = dto.partner_margin_cap;
    }
    if (dto.partner_override_pricing !== undefined) {
      nextSettings.partner_override_pricing = dto.partner_override_pricing;
    }

    const wasPartner = org.is_partner;
    const willBePartner = dto.is_partner ?? wasPartner;

    const updated = await this.prisma.organizations.update({
      where: { id: organizationId },
      data: {
        ...(dto.is_partner !== undefined && { is_partner: dto.is_partner }),
        ...(dto.is_partner === true &&
          !wasPartner && { partner_since: new Date() }),
        partner_settings: nextSettings as any,
        updated_at: new Date(),
      },
      include: {
        partner_overrides: {
          include: {
            base_plan: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });

    return projectPartner(updated);
  }

  async togglePartner(dto: TogglePartnerDto) {
    const org = await this.prisma.organizations.findUnique({
      where: { id: dto.organization_id },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    return this.prisma.organizations.update({
      where: { id: dto.organization_id },
      data: {
        is_partner: dto.is_partner,
        updated_at: new Date(),
      },
    });
  }

  async setMarginCap(dto: SetMarginCapDto) {
    const org = await this.prisma.organizations.findUnique({
      where: { id: dto.organization_id },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_FIND_001);
    }

    const partnerSettings = (org.partner_settings as Record<string, any>) || {};

    return this.prisma.organizations.update({
      where: { id: dto.organization_id },
      data: {
        partner_settings: {
          ...partnerSettings,
          max_partner_margin_pct: dto.max_partner_margin_pct,
        },
        updated_at: new Date(),
      },
    });
  }

  async createOverride(dto: CreatePartnerOverrideDto) {
    const existing = await this.prisma.partner_plan_overrides.findUnique({
      where: {
        organization_id_base_plan_id: {
          organization_id: dto.organization_id,
          base_plan_id: dto.base_plan_id,
        },
      },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.SYS_CONFLICT_001);
    }

    const plan = await this.prisma.subscription_plans.findUnique({
      where: { id: dto.base_plan_id },
    });

    if (!plan) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    if (dto.margin_pct > Number(plan.max_partner_margin_pct ?? 100)) {
      throw new VendixHttpException(ErrorCodes.PARTNER_002);
    }

    return this.prisma.partner_plan_overrides.create({
      data: {
        organization_id: dto.organization_id,
        base_plan_id: dto.base_plan_id,
        custom_code: dto.custom_code || null,
        custom_name: dto.custom_name || null,
        custom_description: dto.custom_description || null,
        margin_pct: dto.margin_pct,
        fixed_surcharge: dto.fixed_surcharge || null,
        is_active: dto.is_active ?? true,
        feature_overrides: (dto.feature_overrides as any) || null,
        updated_at: new Date(),
      },
    });
  }

  async updateOverride(id: number, dto: UpdatePartnerOverrideDto) {
    const existing = await this.prisma.partner_plan_overrides.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    return this.prisma.partner_plan_overrides.update({
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
          feature_overrides: dto.feature_overrides as any,
        }),
        updated_at: new Date(),
      },
    });
  }

  async removeOverride(id: number) {
    const existing = await this.prisma.partner_plan_overrides.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.SYS_NOT_FOUND_001);
    }

    await this.prisma.partner_plan_overrides.delete({ where: { id } });
  }
}
