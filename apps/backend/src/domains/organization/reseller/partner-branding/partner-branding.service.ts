import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import {
  BrandingConfig,
  DEFAULT_BRANDING,
  UpdatePartnerBrandingDto,
} from './partner-branding.dto';

@Injectable()
export class PartnerBrandingService {
  constructor(private readonly prisma: GlobalPrismaService) {}

  async getBranding(organizationId: number): Promise<BrandingConfig> {
    const org = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
      select: { partner_settings: true },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const settings = (org.partner_settings ?? {}) as Record<string, any>;
    const branding = (settings.branding ?? {}) as Partial<BrandingConfig>;

    return { ...DEFAULT_BRANDING, ...branding };
  }

  async updateBranding(
    organizationId: number,
    dto: UpdatePartnerBrandingDto,
  ): Promise<BrandingConfig> {
    const org = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
      select: { partner_settings: true },
    });

    if (!org) {
      throw new VendixHttpException(ErrorCodes.ORG_CONTEXT_001);
    }

    const existing = (org.partner_settings ?? {}) as Record<string, any>;
    const currentBranding = (existing.branding ?? {}) as Partial<BrandingConfig>;

    const nextBranding: BrandingConfig = {
      ...DEFAULT_BRANDING,
      ...currentBranding,
      ...dto,
    };

    const nextSettings: Record<string, any> = {
      ...existing,
      branding: nextBranding,
    };

    await this.prisma.organizations.update({
      where: { id: organizationId },
      data: {
        partner_settings: nextSettings as Prisma.InputJsonValue,
        updated_at: new Date(),
      },
    });

    return nextBranding;
  }
}
