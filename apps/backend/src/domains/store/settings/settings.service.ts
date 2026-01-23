import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { StoreSettings } from './interfaces/store-settings.interface';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { validateSync } from 'class-validator';
import { getDefaultStoreSettings } from './defaults/default-store-settings';

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: StorePrismaService,
    private organizationPrisma: OrganizationPrismaService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
  ) { }

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

    // NUEVO: Actualizar campos de la tabla stores si vienen en general
    if (dto.general) {
      const { name, logo_url, store_type, timezone } = dto.general;

      // Preparar objeto de actualización solo con campos definidos
      const storeUpdateData: any = {};

      if (name !== undefined) {
        storeUpdateData.name = name;
      }
      if (logo_url !== undefined) {
        storeUpdateData.logo_url = logo_url;
      }
      if (store_type !== undefined) {
        storeUpdateData.store_type = store_type;
      }
      if (timezone !== undefined) {
        // Sincronizar timezone con la tabla stores
        storeUpdateData.timezone = timezone;
      }

      // Actualizar tabla stores si hay campos para actualizar
      if (Object.keys(storeUpdateData).length > 0) {
        try {
          await this.prisma.stores.update({
            where: { id: store_id },
            data: storeUpdateData,
          });

          // Trigger favicon generation asynchronously if logo_url was updated
          if (logo_url !== undefined && logo_url !== null) {
            this.generateFaviconForStore(store_id, logo_url)
              .catch(error => this.logger.warn(`Favicon generation failed: ${error.message}`));
          }
        } catch (error) {
          console.error('Error updating stores table:', error);
          // No fallar la operación completa si falla la actualización de stores
          // Los settings se guardan igualmente en store_settings
        }
      }
    }

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

  /**
   * Generates a favicon from the store logo and updates the domain configuration.
   * This method runs asynchronously (fire-and-forget) to avoid blocking the logo upload response.
   *
   * @param storeId - Store ID
   * @param logoUrl - Logo URL (S3 key or HTTP URL)
   */
  private async generateFaviconForStore(storeId: number, logoUrl: string): Promise<void> {
    try {
      // 1. Get store with organization and slugs for path S3
      const store = await this.prisma.stores.findUnique({
        where: { id: storeId },
        select: {
          id: true,
          slug: true,
          organization_id: true,
          logo_url: true,
          organizations: {
            select: { id: true, slug: true },
          },
        },
      });

      if (!store?.organization_id || !store.organizations) {
        this.logger.warn(`Store ${storeId} missing organization data`);
        return;
      }

      if (!store.logo_url) {
        this.logger.warn(`Store ${storeId} has no logo_url`);
        return;
      }

      // 2. Download logo from S3 (if it's a key, not an external URL)
      let logoBuffer: Buffer;
      if (store.logo_url.startsWith('http')) {
        this.logger.warn(`Store ${storeId} has external logo URL, skipping favicon generation`);
        return;
      }

      try {
        logoBuffer = await this.s3Service.downloadImage(store.logo_url);
      } catch (error) {
        this.logger.error(`Failed to download logo for store ${storeId}: ${error.message}`);
        return;
      }

      // 3. Generate and upload favicons using path with slug-id
      const faviconPath = this.s3PathHelper.buildFaviconPath(
        store.organizations,
        store,
      );

      const result = await this.s3Service.generateAndUploadFaviconFromLogo(
        logoBuffer,
        faviconPath,
      );

      if (!result) {
        this.logger.warn(`Favicon generation failed for store ${storeId}`);
        return;
      }

      this.logger.log(`Favicons generated for store ${storeId}: ${result.sizes.join(', ')}px`);

      // 4. Update the ecommerce domain config
      const domain = await this.organizationPrisma.domain_settings.findFirst({
        where: { store_id: storeId }
      });

      if (!domain) {
        this.logger.warn(`No domain found for store ${storeId}`);
        return;
      }

      // Merge with existing config
      const existingConfig = (domain.config as any) || {};
      const updatedConfig = {
        ...existingConfig,
        branding: {
          ...existingConfig.branding,
          favicon: result.faviconKey // Store S3 key (not signed URL)
        }
      };

      await this.organizationPrisma.domain_settings.update({
        where: { id: domain.id },
        data: { config: updatedConfig }
      });

      this.logger.log(`Favicon updated for domain ${domain.hostname} (store ${storeId})`);
    } catch (error) {
      this.logger.error(`Error in generateFaviconForStore for store ${storeId}: ${error.message}`);
      throw error;
    }
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
