import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UpdateSettingsDto } from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import { OrganizationSettings, OrganizationBranding } from './interfaces/organization-settings.interface';

@Injectable()
export class SettingsService {
  constructor(private prisma: OrganizationPrismaService) {}

  async findOne() {
    const settings = await this.prisma.organization_settings.findFirst();
    if (!settings) {
      throw new NotFoundException('Organization settings not found');
    }
    return settings;
  }

  async update(updateDto: UpdateSettingsDto) {
    const existing = await this.prisma.organization_settings.findFirst();
    if (existing) {
      return this.prisma.organization_settings.update({
        where: { id: existing.id },
        data: { settings: updateDto.settings, updated_at: new Date() },
      });
    } else {
      const context = RequestContextService.getContext();
      if (!context?.organization_id) {
        throw new ForbiddenException('Organization context required');
      }

      return this.prisma.organization_settings.create({
        data: {
          settings: updateDto.settings,
          organization_id: context.organization_id,
        },
      });
    }
  }

  /**
   * Update branding configuration
   * Source of truth: organization_settings.settings.branding
   */
  async updateBranding(brandingDto: Partial<OrganizationBranding>) {
    const existing = await this.prisma.organization_settings.findFirst();
    const currentSettings = (existing?.settings as OrganizationSettings) || { branding: {} as OrganizationBranding };

    const updatedSettings: OrganizationSettings = {
      ...currentSettings,
      branding: {
        ...currentSettings.branding,
        ...brandingDto,
      },
    };

    return this.update({ settings: updatedSettings as any });
  }

  /**
   * Get branding configuration
   * Source of truth: organization_settings.settings.branding
   */
  async getBranding(): Promise<OrganizationBranding | null> {
    try {
      const settings = await this.findOne();
      const orgSettings = settings.settings as OrganizationSettings;
      return orgSettings?.branding || null;
    } catch {
      return null;
    }
  }
}
