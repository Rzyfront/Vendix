import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { StoreSettings } from './interfaces/store-settings.interface';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { validateSync } from 'class-validator';
import { getDefaultStoreSettings } from './defaults/default-store-settings';

@Injectable()
export class SettingsService {
  constructor(private prisma: StorePrismaService) {}

  async getSettings(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    let storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    if (!storeSettings || !storeSettings.settings) {
      return getDefaultStoreSettings();
    }

    try {
      return this.validateSettings(storeSettings.settings);
    } catch (error) {
      return getDefaultStoreSettings();
    }
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const currentSettings = await this.getSettings();
    const updatedSettings = {
      ...currentSettings,
      ...dto,
    };

    await this.validateSettings(updatedSettings);

    return this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings: updatedSettings,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings: updatedSettings,
      },
    });
  }

  async resetToDefault(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    await this.prisma.store_settings.delete({
      where: { store_id },
    });

    return getDefaultStoreSettings();
  }

  async getSystemTemplates(): Promise<any[]> {
    const templates = await this.prisma.default_templates.findMany({
      where: {
        configuration_type: 'store_settings',
      },
      select: {
        template_name: true,
        template_data: true,
        description: true,
      },
      orderBy: {
        template_name: 'asc',
      },
    });

    return templates;
  }

  async applyTemplate(template_name: string): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const template = await this.prisma.default_templates.findFirst({
      where: {
        template_name,
        configuration_type: 'store_settings',
      },
    });

    if (!template) {
      throw new NotFoundException(`Template '${template_name}' not found`);
    }

    await this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings: template.template_data,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings: template.template_data,
      },
    });

    return template.template_data as unknown as StoreSettings;
  }

  private validateSettings(settings: any): StoreSettings {
    const dto = new UpdateSettingsDto();
    Object.assign(dto, settings);

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid settings structure: ${errors.map((e) => e.toString()).join(', ')}`,
      );
    }

    return settings as StoreSettings;
  }

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    return this.prisma.store_settings.create({
      data: {
        ...data,
        store_id: store_id,
      },
    });
  }

  async findAll() {
    return this.prisma.store_settings.findMany();
  }

  async findOne(id: number) {
    const setting = await this.prisma.store_settings.findFirst({
      where: { id },
    });
    if (!setting) throw new NotFoundException('Setting not found');
    return setting;
  }

  async update(id: number, data: any) {
    await this.findOne(id);
    return this.prisma.store_settings.update({
      where: { id },
      data,
    });
  }

  async remove(id: number) {
    await this.findOne(id);
    return this.prisma.store_settings.delete({
      where: { id },
    });
  }
}
