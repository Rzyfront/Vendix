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
import {
  AuditService,
  AuditAction,
  AuditResource,
} from '../../../common/audit/audit.service';
import { StoreSettings } from './interfaces/store-settings.interface';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AppSettingsDto } from './dto/settings-schemas.dto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { getDefaultStoreSettings } from './defaults/default-store-settings';
import { SettingsMigratorService } from './migrations/settings-migrator.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

/**
 * Top-level keys retained when sanitizing an incoming settings payload.
 * Anything else is dropped and logged. Order does not matter.
 */
const KNOWN_SECTIONS = [
  'general',
  'inventory',
  'checkout',
  'notifications',
  'pos',
  'receipts',
  'branding',
  'fonts',
  'publication',
  'operations',
  'panel_ui',
  'ecommerce',
  'module_flows',
  'fiscal_status',
  'fiscal_data',
  // `app` is intentionally accepted here because the service maps it to
  // branding via updateStoreBranding(); the migrator strips persisted `app`
  // afterwards. The legacy alias should not break update calls.
  'app',
] as const;

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private prisma: StorePrismaService,
    private organizationPrisma: OrganizationPrismaService,
    private s3Service: S3Service,
    private s3PathHelper: S3PathHelper,
    private auditService: AuditService,
    private migrator: SettingsMigratorService,
  ) {}

  /**
   * Idempotently ensures a `store_settings` row exists for the given store
   * with current default settings. Never overwrites an existing row.
   * Safe to call from store-creation flows or as auto-heal on first read.
   */
  async ensureDefaults(storeId: number): Promise<void> {
    if (!storeId) return;
    await this.prisma.store_settings.upsert({
      where: { store_id: storeId },
      create: {
        store_id: storeId,
        settings: getDefaultStoreSettings() as any,
      },
      update: {},
    });
  }

  /**
   * Filter unknown top-level keys, validate retained sections against
   * `UpdateSettingsDto` (with whitelist + skipMissingProperties), and return
   * the sanitized DTO. Known-section validation errors are surfaced via
   * SYS_VALIDATION_001; deprecated keys are dropped and logged.
   */
  private sanitizeAndValidate(
    raw: Record<string, unknown>,
    storeId: number,
  ): UpdateSettingsDto {
    const filtered: Record<string, unknown> = {};
    const droppedKeys: string[] = [];

    const knownSet = new Set<string>(KNOWN_SECTIONS as readonly string[]);
    for (const [key, value] of Object.entries(raw ?? {})) {
      if (knownSet.has(key)) {
        filtered[key] = value;
      } else {
        droppedKeys.push(key);
      }
    }

    if (droppedKeys.length > 0) {
      this.logger.warn(
        `[Settings] dropped deprecated keys storeId=${storeId} keys=${droppedKeys.join(
          ',',
        )}`,
      );
    }

    const dto = plainToInstance(UpdateSettingsDto, filtered, {
      enableImplicitConversion: true,
    });

    const errors = validateSync(dto, {
      whitelist: true,
      forbidNonWhitelisted: false,
      skipMissingProperties: true,
      stopAtFirstError: false,
    });

    if (errors.length > 0) {
      throw new VendixHttpException(ErrorCodes.SYS_VALIDATION_001, undefined, {
        validation: errors.map((e) => ({
          property: e.property,
          constraints: e.constraints ?? {},
          children: e.children?.length ? e.children.map((c) => c.property) : [],
        })),
      });
    }

    return dto;
  }

  async getSettings(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Auto-heal: legacy stores without a settings row get one with current
    // defaults before we read. Idempotent — never overwrites existing data.
    await this.ensureDefaults(store_id);

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
      },
    });

    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    // Run lazy schema migrations against the persisted JSON. If any migration
    // applied, persist the migrated value so subsequent reads are idempotent.
    let rawSettings = (storeSettings?.settings || {}) as any;
    if (storeSettings?.settings) {
      const result = this.migrator.migrate(rawSettings);
      if (result.changed) {
        try {
          await this.prisma.store_settings.update({
            where: { store_id },
            data: { settings: result.migrated, updated_at: new Date() },
          });
          this.logger.log(
            `[Settings] migrated store ${store_id}: v${result.fromVersion}->v${result.toVersion}`,
          );
        } catch (err: any) {
          this.logger.warn(
            `[Settings] failed to persist migration for store ${store_id}: ${err?.message ?? err}`,
          );
        }
      }
      rawSettings = result.migrated;
    }

    // Read branding from store_settings.settings.branding (source of truth)
    const settings = (rawSettings || {}) as StoreSettings;
    const branding = settings.branding || getDefaultStoreSettings().branding;

    // Map branding to legacy app structure for compatibility
    const primaryColor = branding.primary_color || '#7ED7A5';
    const secondaryColor = branding.secondary_color || '#2F6F4E';
    const accentColor = branding.accent_color || '#FFFFFF';

    // Sign URLs on-demand before returning to frontend
    // Keys are stored in DB, but frontend needs signed URLs to access S3 objects
    const signedStoreLogoUrl = await this.s3Service.signUrl(store?.logo_url);
    const signedBrandingLogoUrl = await this.s3Service.signUrl(
      branding.logo_url,
    );
    const signedFaviconUrl = await this.s3Service.signUrl(branding.favicon_url);

    if (!storeSettings || !storeSettings.settings) {
      return {
        ...getDefaultStoreSettings(),
        general: {
          ...getDefaultStoreSettings().general,
          name: store?.name,
          logo_url: signedStoreLogoUrl,
          store_type: store?.store_type,
          timezone:
            store?.timezone || getDefaultStoreSettings().general.timezone,
        },
        app: {
          name: branding.name || store?.name || 'Vendix',
          primary_color: primaryColor,
          secondary_color: secondaryColor,
          accent_color: accentColor,
          theme: 'default',
          logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
          favicon_url: signedFaviconUrl,
        },
      };
    }

    // Merge existing settings with store data
    // Use branding as the single source of truth for colors (same as onboarding)
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
        // Use branding as the single source of truth for colors
        name: branding.name || store?.name || 'Vendix',
        primary_color: primaryColor,
        secondary_color: secondaryColor,
        accent_color: accentColor,
        theme: settings.app?.theme || 'default',
        logo_url: signedBrandingLogoUrl || signedStoreLogoUrl,
        favicon_url: signedFaviconUrl,
      },
    };
  }

  async updateSettings(
    raw: Record<string, unknown> | UpdateSettingsDto,
  ): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    // Sanitize unknown top-level keys and validate retained sections.
    // This replaces the previous, ineffective controller-side ValidationPipe.
    const dto: UpdateSettingsDto = this.sanitizeAndValidate(
      raw as Record<string, unknown>,
      store_id,
    );

    // Read raw DB settings (without signed URLs) to avoid leaking temporary URLs into stored JSON
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    let currentSettings = (storeSettings?.settings ||
      getDefaultStoreSettings()) as StoreSettings;

    // Guardar valores antiguos para auditoría
    const oldValues = { ...currentSettings };

    // Handle app section - update branding in store_settings.settings.branding
    if (dto.app) {
      // CRITICAL: Sanitize logo_url to extract S3 key before storing
      // This prevents storing signed URLs that expire after 24 hours
      if (dto.app.logo_url !== undefined) {
        dto.app.logo_url = extractS3KeyFromUrl(dto.app.logo_url) ?? undefined;
      }
      if (dto.app.favicon_url !== undefined) {
        dto.app.favicon_url =
          extractS3KeyFromUrl(dto.app.favicon_url) ?? undefined;
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
          select: { organization_id: true },
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: dto.app.name },
          });
        }
      }

      // Update branding in store_settings.settings.branding (source of truth)
      await this.updateStoreBranding(store_id, dto.app);

      // Delete app and branding from dto - branding is managed by updateStoreBranding()
      // App will be built from branding in getSettings()
      // Branding must also be removed because the frontend sends the ENTIRE settings object,
      // which includes stale branding values from the previous GET response
      delete (dto as any).app;
      delete (dto as any).branding;

      // Re-read settings after branding update to avoid overwriting with stale data
      const freshStoreSettings = await this.prisma.store_settings.findUnique({
        where: { store_id },
      });
      currentSettings = (freshStoreSettings?.settings ||
        getDefaultStoreSettings()) as StoreSettings;
    }

    // Merge solo las secciones enviadas
    const updatedSettings = { ...currentSettings };
    for (const key of Object.keys(dto)) {
      if (dto[key as keyof UpdateSettingsDto] !== undefined) {
        (updatedSettings as any)[key] = dto[key as keyof UpdateSettingsDto];
      }
    }

    // @deprecated: Sync bidireccional eliminada. module_flows es source of truth.
    // accounting_flows se mantiene en lectura como fallback legacy (Fase 2: eliminar).

    // Legacy accounting_flows writes → sync a module_flows.accounting
    if (dto.accounting_flows) {
      if (!updatedSettings.module_flows) {
        updatedSettings.module_flows = {
          accounting: { enabled: true, ...dto.accounting_flows } as any,
          payroll: { enabled: true },
          invoicing: { enabled: true },
        };
      } else {
        updatedSettings.module_flows = {
          ...updatedSettings.module_flows,
          accounting: {
            ...updatedSettings.module_flows.accounting,
            ...dto.accounting_flows,
          } as any,
        };
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
            select: { organization_id: true, main_store_users: { take: 1 } },
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
            this.generateFaviconForStore(store_id, logo_url).catch((error) =>
              this.logger.warn(`Favicon generation failed: ${error.message}`),
            );
          }
        } catch (error) {
          console.error('Error updating stores table:', error);
        }
      }
    }

    // Safety net: sanitize any signed URLs that may have leaked into the settings object
    if (updatedSettings.general?.logo_url) {
      updatedSettings.general.logo_url =
        extractS3KeyFromUrl(updatedSettings.general.logo_url) ?? undefined;
    }

    // Remove app from settings - branding is the single source of truth
    // App will be built from branding in getSettings()
    delete (updatedSettings as any).app;

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
        store_id, // Validado arriba, siempre existe aquí
        null, // No guardamos el objeto completo de oldValues
        changedSections, // Solo las secciones que cambiaron
        {
          sections_updated: Object.keys(dto),
          store_id,
        },
      );
      this.logger.log(
        `Audit log created for settings update by user ${user_id}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to create audit log for settings update: ${error.message}`,
      );
    }

    return result.settings as StoreSettings;
  }

  async resetToDefault(): Promise<StoreSettings> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
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
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    const template = await this.prisma.default_templates.findFirst({
      where: {
        template_name,
        configuration_type: 'store_settings',
        is_active: true,
      },
    });

    if (!template) {
      throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
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
  private async generateFaviconForStore(
    storeId: number,
    logoUrl: string,
  ): Promise<void> {
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
        this.logger.warn(
          `Store ${storeId} has external logo URL, skipping favicon generation`,
        );
        return;
      }

      try {
        logoBuffer = await this.s3Service.downloadImage(store.logo_url);
      } catch (error) {
        this.logger.error(
          `Failed to download logo for store ${storeId}: ${error.message}`,
        );
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

      this.logger.log(
        `Favicons generated for store ${storeId}: ${result.sizes.join(', ')}px`,
      );

      // 4. Update store_settings.settings.branding.favicon_url (source of truth)
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id: storeId },
      });

      const currentSettings = (storeSettings?.settings ||
        getDefaultStoreSettings()) as StoreSettings;
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
      this.logger.error(
        `Error in generateFaviconForStore for store ${storeId}: ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Updates the branding configuration in store_settings.settings.branding (source of truth).
   *
   * @param storeId - Store ID
   * @param appSettings - App settings containing branding configuration
   */
  private async updateStoreBranding(
    storeId: number,
    appSettings: AppSettingsDto,
  ): Promise<void> {
    // Get current store_settings
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id: storeId },
    });

    const currentSettings = (storeSettings?.settings ||
      getDefaultStoreSettings()) as StoreSettings;
    const existingBranding =
      currentSettings.branding || getDefaultStoreSettings().branding;

    // Build updated branding - only update fields that are provided
    const updatedBranding = {
      ...existingBranding,
      ...(appSettings.name !== undefined && { name: appSettings.name }),
      ...(appSettings.primary_color !== undefined && {
        primary_color: appSettings.primary_color,
      }),
      ...(appSettings.secondary_color !== undefined && {
        secondary_color: appSettings.secondary_color,
      }),
      ...(appSettings.accent_color !== undefined && {
        accent_color: appSettings.accent_color,
      }),
      ...(appSettings.logo_url !== undefined && {
        logo_url: appSettings.logo_url,
      }),
      ...(appSettings.favicon_url !== undefined && {
        favicon_url: appSettings.favicon_url,
      }),
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
          select: { organization_id: true },
        });

        if (store?.organization_id) {
          await this.organizationPrisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: appSettings.name },
          });
          this.logger.log(
            `Organization ${store.organization_id} name updated to ${appSettings.name}`,
          );
        }
      } catch (error) {
        this.logger.warn(`Failed to sync organization name: ${error.message}`);
      }
    }
  }

  async create(data: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
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
    if (!setting) throw new VendixHttpException(ErrorCodes.STORE_FIND_001);
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

  /**
   * Patch-style update for `settings.fiscal_data`. Deep-merges over the
   * existing section so partial payloads are safe. Other settings sections
   * (branding, panel_ui, etc.) are never touched.
   *
   * Canonical endpoint: `PATCH /store/settings/fiscal-data`.
   */
  async updateFiscalData(
    dto: Record<string, unknown>,
  ): Promise<StoreSettings['fiscal_data']> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;
    const user_id = context?.user_id;

    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }

    await this.ensureDefaults(store_id);

    const existing = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    const currentSettings = (existing?.settings ||
      getDefaultStoreSettings()) as StoreSettings;
    const previousFiscalData = currentSettings.fiscal_data ?? {};

    const nextFiscalData = {
      ...previousFiscalData,
      ...dto,
    };

    const updatedSettings: StoreSettings = {
      ...currentSettings,
      fiscal_data: nextFiscalData as StoreSettings['fiscal_data'],
    };

    await this.prisma.store_settings.upsert({
      where: { store_id },
      update: {
        settings: updatedSettings as any,
        updated_at: new Date(),
      },
      create: {
        store_id,
        settings: updatedSettings as any,
      },
    });

    try {
      await this.auditService.logUpdate(
        user_id!,
        AuditResource.SETTINGS,
        store_id,
        { fiscal_data: previousFiscalData },
        { fiscal_data: nextFiscalData },
        { action: 'update_fiscal_data', store_id },
      );
    } catch (err) {
      this.logger.warn(
        `Audit log for fiscal_data update failed: ${(err as Error).message}`,
      );
    }

    return nextFiscalData as StoreSettings['fiscal_data'];
  }

  /**
   * Returns the currency code configured for the current store.
   * Reads from store_settings.settings.general.currency with fallback to 'USD'.
   */
  async getStoreCurrency(): Promise<string> {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      return 'USD';
    }

    try {
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id },
        select: { settings: true },
      });

      const settings = storeSettings?.settings as StoreSettings | null;
      return settings?.general?.currency || 'USD';
    } catch {
      return 'USD';
    }
  }
}
