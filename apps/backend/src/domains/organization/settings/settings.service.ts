import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UpdateSettingsDto } from './dto';

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
      return this.prisma.organization_settings.create({
        data: { settings: updateDto.settings },
      });
    }
  }
}
