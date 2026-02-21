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
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
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

    // Obtener datos de la tienda desde la tabla stores
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        name: true,
        logo_url: true,
        store_type: true,
        timezone: true,
        organization_id: true,
      }
    });

    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    // Read branding from store_settings.settings.branding (source of truth)
    const settings = (storeSettings?.settings || {}) as StoreSettings;
    const branding = settings.branding || getDefaultStoreSettings().branding;

    // Map branding to legacy app structure for compatibility
    const primaryColor = branding.primary_color || '#7ED7A5';
    const secondaryColor = branding.secondary_color || '#2F6F4E';
    const accentColor = branding.accent_color || '#FFFFFF';

    // Sign URLs on-demand before returning to frontend
    // Keys are stored in DB, but frontend needs signed URLs to access S3 objects
    const signedStoreLogoUrl = await this.s3Service.signUrl(store?.logo_url);
    const signedBrandingLogoUrl = await this.s3Service.signUrl(branding.logo_url);
    const signedFaviconUrl = await this.s3Service.signUrl(branding.favicon_url);

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...getDefaultStoreSettings(),
        general: {
          ...getDefaultStoreSettings().general,
          name: store?.name,
          logo_url: signedStoreLogoUrl,
          store_type: store?.store_type,
          timezone: store?.timezone || getDefaultStoreSettings().general.timezone,
        },
        app: {
          name: branding.name || store?.name || 'Vendix',
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          accent_color: accentColor,
          theme: 'default',
          logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
          favicon_url: signedFaviconUrl,
        }
      };
    }

    // Merge existing settings with store data
    return {
      ...settings,
      general: {
        ...settings.general,
        name: store?.name,
        logo_url: signedStoreLogoUrl,
        store_type: store?.store_type,
        timezone: store?.timezone || settings.general?.timezone,
      },
      app: {
        name: branding.name || store?.name || 'Vendix',
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
        theme: 'default',
        logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
        favicon_url: signedFaviconUrl,
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

    // Read raw DB settings (without signed URLs) to avoid leaking temporary URLs into stored JSON
    const storeSettings = await this.prisma.store_settings.findUnique({ where: { store_id } });
    const currentSettings = (storeSettings?.settings || getDefaultStoreSettings()) as StoreSettings;

    // Guardar valores antiguos para auditoría
    const oldValues = { ...currentSettings };

    // Solo validar las secciones que se están actualizando
    await this.validatePartialSettings(dto);

    // Handle app section - update branding in store_settings.settings.branding
    if (dto.app) {
      // CRITICAL: Sanitize logo_url to extract S3 key before storing
      // This prevents storing signed URLs that expire after 24 hours
      if (dto.app.logo_url !== undefined) {
        dto.app.logo_url = extractS3KeyFromUrl(dto.app.logo_url) ?? undefined;
      }
      if (dto.app.favicon_url !== undefined) {
        dto.app.favicon_url = extractS3KeyFromUrl(dto.app.favicon_url) ?? undefined;
      }

      // Sincronizar logo_url simultáneamente en stores table
      if (dto.app.logo_url !== undefined) {
        await this.prisma.stores.update({
          where: { id: store_id },
          data: { logo_url: dto.app.logo_url },
        });
      }

      // Sincronizar nombre simultáneamente en stores y organizations
      if (dto.app.name !== undefined) {
        await this.prisma.stores.update({
          where: { id: store_id },
          data: { name: dto.app.name },
        });

        // Sincronizar con organizations table
        const store = await this.prisma.stores.findUnique({
          where: { id: store_id },
          select: { organization_id: true }
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: dto.app.name }
          });
        }
      }

      // Update branding in store_settings.settings.branding (source of truth)
      await this.updateStoreBranding(store_id, dto.app);
      delete (dto as any).app; // Remove from dto to not save again in store_settings
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
      let { name, logo_url, store_type, timezone } = dto.general;

      // CRITICAL: Sanitize logo_url to extract S3 key before storing
      // This prevents storing signed URLs that expire after 24 hours
      if (logo_url !== undefined) {
        logo_url = extractS3KeyFromUrl(logo_url) ?? undefined;
        dto.general.logo_url = logo_url; // Update DTO for consistency
      }

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
          // Obtener la tienda para saber si es la principal y su organización
          const store = await this.prisma.stores.findUnique({
            where: { id: store_id },
            select: { organization_id: true, main_store_users: { take: 1 } }
          });

          await this.prisma.stores.update({
            where: { id: store_id },
            data: storeUpdateData,
          });

          // Si el nombre cambió, actualizar en store_settings.settings.branding
          if (name && store?.organization_id) {
            await this.updateStoreBranding(store_id, { name } as any);
          }

          // Trigger favicon generation asynchronously if logo_url was updated
          if (logo_url !== undefined && logo_url !== null) {
            this.generateFaviconForStore(store_id, logo_url)
              .catch(error => this.logger.warn(`Favicon generation failed: ${error.message}`));
          }
        } catch (error) {
          console.error('Error updating stores table:', error);
        }
      }
    }

    // Safety net: sanitize any signed URLs that may have leaked into the settings object
    if (updatedSettings.general?.logo_url) {
      updatedSettings.general.logo_url = extractS3KeyFromUrl(updatedSettings.general.logo_url) ?? undefined;
    }
    if (updatedSettings.app?.logo_url) {
      updatedSettings.app.logo_url = extractS3KeyFromUrl(updatedSettings.app.logo_url) ?? undefined;
    }
    if (updatedSettings.app?.favicon_url) {
      updatedSettings.app.favicon_url = extractS3KeyFromUrl(updatedSettings.app.favicon_url) ?? undefined;
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
        is_active: true,
        is_system: true,
      },
      select: {
        template_name: true,
        template_data: true,
        description: true,
      },
      orderBy: {
        updated_at: 'desc',
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
        is_active: true,
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

      // 4. Update store_settings.settings.branding.favicon_url (source of truth)
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id: storeId },
      });

      const currentSettings = (storeSettings?.settings || getDefaultStoreSettings()) as StoreSettings;
      const updatedSettings = {
        ...currentSettings,
        branding: {
          ...currentSettings.branding,
          favicon_url: result.faviconKey, // Store S3 key (not signed URL)
        },
      };

      await this.prisma.store_settings.upsert({
        where: { store_id: storeId },
        update: {
          settings: updatedSettings,
          updated_at: new Date(),
        },
        create: {
          store_id: storeId,
          settings: updatedSettings,
        },
      });

      this.logger.log(`Favicon updated in store_settings for store ${storeId}`);
    } catch (error) {
      this.logger.error(`Error in generateFaviconForStore for store ${storeId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Updates the branding configuration in store_settings.settings.branding (source of truth).
   *
   * @param storeId - Store ID
   * @param appSettings - App settings containing branding configuration
   */
  private async updateStoreBranding(storeId: number, appSettings: AppSettingsDto): Promise<void> {
    // Get current store_settings
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
    });

    const currentSettings = (storeSettings?.settings || getDefaultStoreSettings()) as StoreSettings;
    const existingBranding = currentSettings.branding || getDefaultStoreSettings().branding;

    // Build updated branding - only update fields that are provided
    const updatedBranding = {
      ...existingBranding,
      ...(appSettings.name !== undefined && { name: appSettings.name }),
      ...(appSettings.primary_color !== undefined && { primary_color: appSettings.primary_color }),
      ...(appSettings.secondary_color !== undefined && { secondary_color: appSettings.secondary_color }),
      ...(appSettings.accent_color !== undefined && { accent_color: appSettings.accent_color }),
      ...(appSettings.logo_url !== undefined && { logo_url: appSettings.logo_url }),
      ...(appSettings.favicon_url !== undefined && { favicon_url: appSettings.favicon_url }),
    };

    const updatedSettings = {
      ...currentSettings,
      branding: updatedBranding,
    };

    // Upsert store_settings with updated branding
    await this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      update: {
        settings: updatedSettings,
        updated_at: new Date(),
      },
      create: {
        store_id: storeId,
        settings: updatedSettings,
      },
    });

    this.logger.log(`Branding updated in store_settings for store ${storeId}`);

    // Sync organization name if it changed
    if (appSettings.name) {
      try {
        const store = await this.prisma.stores.findUnique({
          where: { id: storeId },
          select: { organization_id: true }
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: appSettings.name }
          });
          this.logger.log(`Organization ${store.organization_id} name updated to ${appSettings.name}`);
        }
      } catch (error) {
        this.logger.warn(`Failed to sync organization name: ${error.message}`);
      }
    }
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
