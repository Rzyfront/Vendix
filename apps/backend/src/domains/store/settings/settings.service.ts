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
import { AuditService, AuditAction, AuditResource } from '../../../common/audit/audit.service';
import { StoreSettings } from './interfaces/store-settings.interface';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AppSettingsDto } from './dto/settings-schemas.dto';
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
    private auditService: AuditService,
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

    // Get domain config for the app section
    const domainConfig = await this.getDomainConfig(store_id);
    const branding = domainConfig?.branding || {};

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...getDefaultStoreSettings(),
        app: {
          name: branding.name || 'Vendix',
          primary_color: branding.primary_color || '#7ED7A5',
          secondary_color: branding.secondary_color || '#2F6F4E',
          accent_color: branding.accent_color || '#FFFFFF',
          theme: branding.theme || 'default',
          logo_url: branding.logo_url || null,
          favicon_url: branding.favicon_url || null,
        }
      };
    }

    // Merge existing settings with app config from domain
    const settings = storeSettings.settings as StoreSettings;
    return {
      ...settings,
      app: {
        name: branding.name || 'Vendix',
        primary_color: branding.primary_color || '#7ED7A5',
        secondary_color: branding.secondary_color || '#2F6F4E',
        accent_color: branding.accent_color || '#FFFFFF',
        theme: branding.theme || 'default',
        logo_url: branding.logo_url || null,
        favicon_url: branding.favicon_url || null,
      }
    };
  }

  async updateSettings(dto: UpdateSettingsDto): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    const currentSettings = await this.getSettings();

    // Guardar valores antiguos para auditoría
    const oldValues = { ...currentSettings };

    // Solo validar las secciones que se están actualizando
    await this.validatePartialSettings(dto);

    // Handle app section separately (domain_settings)
    if (dto.app) {
      await this.updateDomainBranding(store_id, dto.app);
      delete (dto as any).app; // Remove from dto to not save in store_settings
    }

    // Merge solo las secciones enviadas
    const updatedSettings = { ...currentSettings };
    for (const key of Object.keys(dto)) {
      if (dto[key as keyof UpdateSettingsDto] !== undefined) {
        (updatedSettings as any)[key] = dto[key as keyof UpdateSettingsDto];
      }
    }

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

    const result = await this.prisma.store_settings.upsert({
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

    // Registrar auditoría de actualización de settings
    try {
      // Solo guardar las secciones que cambiaron (no todo el objeto de settings)
      const changedSections: Record<string, any> = {};
      for (const key of Object.keys(dto)) {
        if (dto[key as keyof UpdateSettingsDto] !== undefined) {
          changedSections[key] = {
            old: (oldValues as any)[key],
            new: (updatedSettings as any)[key],
          };
        }
      }

      await this.auditService.logUpdate(
        user_id!,
        AuditResource.SETTINGS,
        store_id!, // Validado arriba, siempre existe aquí
        null, // No guardamos el objeto completo de oldValues
        changedSections, // Solo las secciones que cambiaron
        {
          sections_updated: Object.keys(dto),
          store_id,
        }
      );
      this.logger.log(`Audit log created for settings update by user ${user_id}`);
    } catch (error) {
      this.logger.error(`Failed to create audit log for settings update: ${error.message}`);
    }

    return result.settings as StoreSettings;
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

  /**
   * Gets the domain configuration for a store.
   * Prioritizes the primary domain, falls back to any domain associated with the store.
   *
   * @param storeId - Store ID
   * @returns Domain config object or empty object if no domain found
   */
  private async getDomainConfig(storeId: number): Promise<any> {
    // Try to find primary domain first
    const domain = await this.organizationPrisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        is_primary: true,
      },
      select: { config: true }
    });

    // If no primary domain, try to find any domain associated with the store
    if (!domain) {
      const anyDomain = await this.organizationPrisma.domain_settings.findFirst({
        where: { store_id: storeId },
        select: { config: true }
      });
      return anyDomain?.config || {};
    }

    return domain?.config || {};
  }

  /**
   * Updates the branding configuration in domain_settings.
   *
   * @param storeId - Store ID
   * @param appSettings - App settings containing branding configuration
   */
  private async updateDomainBranding(storeId: number, appSettings: AppSettingsDto): Promise<void> {
    // Try to find primary domain first
    let domain = await this.organizationPrisma.domain_settings.findFirst({
      where: {
        store_id: storeId,
        is_primary: true,
      }
    });

    // If no primary domain, try to find any domain associated with the store
    if (!domain) {
      domain = await this.organizationPrisma.domain_settings.findFirst({
        where: { store_id: storeId }
      });
    }

    if (!domain) {
      this.logger.warn(`No domain found for store ${storeId}, skipping branding update`);
      return;
    }

    // Merge with existing config to preserve other settings
    const existingConfig = (domain.config as any) || {};
    const updatedConfig = {
      ...existingConfig,
      branding: {
        ...existingConfig.branding,
        name: appSettings.name,
        primary_color: appSettings.primary_color,
        secondary_color: appSettings.secondary_color,
        accent_color: appSettings.accent_color,
        theme: appSettings.theme,
        logo_url: appSettings.logo_url,
        favicon_url: appSettings.favicon_url,
      }
    };

    await this.organizationPrisma.domain_settings.update({
      where: { id: domain.id },
      data: { config: updatedConfig }
    });

    this.logger.log(`Branding updated for domain ${domain.hostname} (store ${storeId})`);
  }

  private async validatePartialSettings(dto: UpdateSettingsDto): Promise<void> {
    // Validar solo las secciones que se están enviando (no son undefined)
    const partialDto = new UpdateSettingsDto();

    for (const key of Object.keys(dto)) {
      const value = dto[key as keyof UpdateSettingsDto];
      if (value !== undefined) {
        (partialDto as any)[key] = value;
      }
    }

    const errors = validateSync(partialDto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      throw new BadRequestException(
        `Invalid settings structure: ${errors.map((e) => e.toString()).join(', ')}`,
      );
    }
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
