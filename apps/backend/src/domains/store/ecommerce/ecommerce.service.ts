import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EcommerceSettingsDto } from './dto/ecommerce-settings.dto';
import {
  DomainGeneratorHelper,
  DomainContext,
} from '../../../common/helpers/domain-generator.helper';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';
import { S3PathHelper } from '@common/helpers/s3-path.helper';
import { extractS3KeyFromUrl } from '@common/helpers/s3-url.helper';
import { StoreSettings, EcommerceSettings, EcommerceBrandingSettings } from '../settings/interfaces/store-settings.interface';

@Injectable()
export class EcommerceService {
  private readonly logger = new Logger(EcommerceService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly domainGeneratorHelper: DomainGeneratorHelper,
    private readonly s3Service: S3Service,
    private readonly s3PathHelper: S3PathHelper,
  ) { }

  /**
   * Get e-commerce settings from store_settings (single source of truth)
   * Returns null if no ecommerce config exists (setup mode)
   */
  async getSettings() {
    const store_id = RequestContextService.getStoreId();

    // 1. Read from store_settings.settings.ecommerce (single source of truth)
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });

    const ecommerceConfig = (storeSettings?.settings as StoreSettings)?.ecommerce || null;

    // 2. Find ecommerce domain to get the URL
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        store_id,
        domain_type: 'ecommerce',
      },
    });

    if (!ecommerceConfig) {
      // Return null indicates setup mode (no configuration)
      return null;
    }

    // 3. Create a copy to avoid mutating the original
    const config = JSON.parse(JSON.stringify(ecommerceConfig));

    // 3.1. Migration: If no branding exists but inicio.colores does, create branding from legacy data
    if (!config.branding && config.inicio?.colores) {
      config.branding = {
        primary_color: config.inicio.colores.primary_color,
        secondary_color: config.inicio.colores.secondary_color,
        accent_color: config.inicio.colores.accent_color,
        // Defaults for missing fields
        background_color: '#F4F4F4',
        surface_color: '#FFFFFF',
        text_color: '#222222',
        text_secondary_color: '#666666',
        text_muted_color: '#999999',
      } as EcommerceBrandingSettings;
    }

    // 4. Sign S3 URLs for slider photos
    if (config.slider?.photos) {
      for (const photo of config.slider.photos) {
        if (photo.url && !photo.url.startsWith('http')) {
          photo.url = await this.s3Service.signUrl(photo.url);
        }
      }
    }

    // 5. Sign logo_url in inicio section
    if (config.inicio?.logo_url && !config.inicio.logo_url.startsWith('http')) {
      config.inicio.logo_url = await this.s3Service.signUrl(config.inicio.logo_url);
    }

    // 5.1. Sign branding images
    if (config.branding?.logo_url && !config.branding.logo_url.startsWith('http')) {
      config.branding.logo_url = await this.s3Service.signUrl(config.branding.logo_url);
    }
    if (config.branding?.favicon_url && !config.branding.favicon_url.startsWith('http')) {
      config.branding.favicon_url = await this.s3Service.signUrl(config.branding.favicon_url);
    }

    // 6. Build ecommerce URL from domain hostname
    const ecommerceUrl = domain ? this.buildEcommerceUrl(domain.hostname) : null;

    return {
      config,
      ecommerceUrl,
    };
  }

  /**
   * Construye la URL completa del dominio de Ecommerce
   */
  private buildEcommerceUrl(hostname: string): string {
    // Si el hostname ya incluye el protocolo, retornarlo tal cual
    if (hostname.startsWith('http://') || hostname.startsWith('https://')) {
      return hostname;
    }

    // Construir la URL con https
    return `https://${hostname}`;
  }

  /**
   * Get default template for e-commerce configuration
   */
  async getDefaultTemplate(type: 'basic' | 'advanced' = 'basic') {
    // Siempre retorna la plantilla default
    const templateName = 'ecommerce_default_settings';

    const template = await this.prisma.default_templates.findFirst({
      where: {
        template_name: templateName,
        is_active: true,
        is_system: true,
      },
      orderBy: {
        updated_at: 'desc',
      },
    });

    if (!template) {
      throw new NotFoundException(`Template '${templateName}' not found`);
    }

    return template.template_data as any;
  }

  /**
   * Update or create e-commerce settings
   * Writes to store_settings.settings.ecommerce (single source of truth)
   * Creates/updates domain_settings only for hostname (no config duplication)
   */
  async updateSettings(ecommerceDto: EcommerceSettingsDto) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new Error('Store ID not found in context');

    const appType = 'STORE_ECOMMERCE';

    // Apply default values and sanitize
    const processedDto = this.applyDefaultValues(ecommerceDto);

    // 1. Get current store_settings
    const storeSettings = await this.prisma.store_settings.findUnique({
      where: { store_id },
    });
    const currentSettings = (storeSettings?.settings || {}) as StoreSettings;
    const existingEcommerce = currentSettings.ecommerce || ({} as Partial<EcommerceSettings>);

    // 2. Merge with existing ecommerce config
    const mergedEcommerce: EcommerceSettings = {
      ...existingEcommerce,
      ...processedDto,
      enabled: true,
      slider: {
        enable: existingEcommerce.slider?.enable ?? processedDto.slider?.enable ?? false,
        photos: processedDto.slider?.photos ?? existingEcommerce.slider?.photos ?? [],
      },
      inicio: {
        ...existingEcommerce.inicio,
        ...processedDto.inicio,
      },
    } as EcommerceSettings;

    // 3. Sanitize URLs to S3 keys before storage
    if (mergedEcommerce.slider?.photos && Array.isArray(mergedEcommerce.slider.photos)) {
      mergedEcommerce.slider.photos = mergedEcommerce.slider.photos.map((photo: any) => {
        const sanitizedPhoto = { ...photo };
        const sourceValue = photo.key || photo.url;
        const sanitizedKey = extractS3KeyFromUrl(sourceValue);
        if (sanitizedKey) {
          sanitizedPhoto.url = sanitizedKey;
          sanitizedPhoto.key = sanitizedKey;
        }
        return sanitizedPhoto;
      });
    }

    if (mergedEcommerce.inicio?.logo_url) {
      mergedEcommerce.inicio.logo_url = extractS3KeyFromUrl(mergedEcommerce.inicio.logo_url) ?? undefined;
    }

    // 4. Handle ecommerce-specific branding (NO sync to store branding)
    if (processedDto.branding) {
      // Merge with existing ecommerce branding
      const newBranding: EcommerceBrandingSettings = {
        ...mergedEcommerce.branding,
        ...processedDto.branding,
      };

      // Sanitize S3 URLs in ecommerce branding
      if (newBranding.logo_url) {
        newBranding.logo_url = extractS3KeyFromUrl(newBranding.logo_url) ?? undefined;
      }
      if (newBranding.favicon_url) {
        newBranding.favicon_url = extractS3KeyFromUrl(newBranding.favicon_url) ?? undefined;
      }

      mergedEcommerce.branding = newBranding;
    }

    // 4.1. Migration: If branding doesn't exist but inicio.colores does, initialize from legacy
    if (!mergedEcommerce.branding && mergedEcommerce.inicio?.colores) {
      mergedEcommerce.branding = {
        primary_color: mergedEcommerce.inicio.colores.primary_color,
        secondary_color: mergedEcommerce.inicio.colores.secondary_color,
        accent_color: mergedEcommerce.inicio.colores.accent_color,
        background_color: '#F4F4F4',
        surface_color: '#FFFFFF',
        text_color: '#222222',
        text_secondary_color: '#666666',
        text_muted_color: '#999999',
      };
    }

    // 5. Check if logo changed for favicon generation
    const logoChanged = mergedEcommerce.inicio?.logo_url &&
      mergedEcommerce.inicio.logo_url !== existingEcommerce.inicio?.logo_url;

    // 6. Save to store_settings.settings.ecommerce (single source of truth)
    // NOTE: We NO LONGER sync ecommerce colors to store branding - they are independent
    const updatedSettings = {
      ...currentSettings,
      // Keep store branding unchanged (no sync from ecommerce)
      ecommerce: mergedEcommerce,
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

    // 7. Sync store name and organization name if titulo changed
    if (mergedEcommerce.inicio?.titulo) {
      try {
        const store = await this.prisma.stores.findUnique({
          where: { id: store_id },
          select: { organization_id: true },
        });

        await this.prisma.stores.update({
          where: { id: store_id },
          data: { name: mergedEcommerce.inicio.titulo },
        });

        if (store?.organization_id) {
          await this.prisma.organizations.update({
            where: { id: store.organization_id },
            data: { name: mergedEcommerce.inicio.titulo },
          });
        }
      } catch (error) {
        this.logger.warn(`Failed to sync name from ecommerce: ${error.message}`);
      }
    }

    // 8. Ensure ecommerce domain exists (for hostname only, no config duplication)
    let domain = await this.prisma.domain_settings.findFirst({
      where: { store_id, domain_type: 'ecommerce' },
    });

    if (!domain) {
      domain = await this.createEcommerceDomain(store_id, appType);
    } else {
      // Update app_type if needed (no config update)
      await this.prisma.domain_settings.update({
        where: { id: domain.id },
        data: { app_type: appType, updated_at: new Date() },
      });
    }

    // 9. Generate favicon if logo changed
    if (logoChanged && mergedEcommerce.inicio?.logo_url) {
      this.generateFaviconForEcommerce(mergedEcommerce.inicio.logo_url).catch((error) =>
        this.logger.warn(`Favicon generation failed: ${error.message}`),
      );
    }

    return mergedEcommerce;
  }

  /**
   * Create ecommerce domain with hostname only (no config duplication)
   */
  private async createEcommerceDomain(store_id: number, appType: string) {
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      include: { organizations: true },
    });

    const slug = store?.slug || `${store_id}`;
    const existingDomains = await this.prisma.domain_settings.findMany({
      select: { hostname: true },
    });
    const existingHostnames: Set<string> = new Set(
      existingDomains.map((d) => d.hostname as string),
    );

    const hostname = this.domainGeneratorHelper.generateUnique(
      slug,
      DomainContext.ECOMMERCE,
      existingHostnames,
    );

    // Disable any existing active ecommerce domains
    await this.prisma.domain_settings.updateMany({
      where: {
        store_id,
        domain_type: 'ecommerce',
        status: 'active',
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });

    // Create domain with minimal config (hostname only, no ecommerce settings duplication)
    return this.prisma.domain_settings.create({
      data: {
        hostname,
        store_id,
        domain_type: 'ecommerce',
        app_type: appType,
        is_primary: false,
        ownership: 'vendix_subdomain',
        status: 'active',
        config: {}, // Empty config - settings live in store_settings
      },
    });
  }

  /**
   * Aplica valores por defecto a la configuración de e-commerce
   * Auto-rellena título y párrafo si están vacíos
   * Sincroniza colores de inicio.colores con branding
   */
  private applyDefaultValues(
    ecommerceDto: EcommerceSettingsDto,
  ): EcommerceSettingsDto {
    const settings = { ...ecommerceDto };

    // Auto-relleno de la sección inicio
    if (settings.inicio) {
      // Auto-relleno del título
      if (!settings.inicio.titulo || settings.inicio.titulo.trim() === '') {
        // Intentar obtener el nombre de la tienda del contexto
        const store_id = RequestContextService.getStoreId();
        settings.inicio.titulo = `Bienvenido a nuestra tienda`;
      }

      // Auto-relleno del párrafo
      if (!settings.inicio.parrafo || settings.inicio.parrafo.trim() === '') {
        settings.inicio.parrafo =
          'Encuentra aquí todo lo que buscas y si no lo encuentras pregúntanos...';
      }

      // Legacy: inicio.colores is deprecated, we now use ecommerce.branding
      // Migration happens in updateSettings() when saving

      // Sanitize logo_url - extract S3 key from any signed URL
      if (settings.inicio.logo_url) {
        settings.inicio.logo_url = extractS3KeyFromUrl(settings.inicio.logo_url);
      }
    }

    // Sanitize slider photos - extract S3 keys from any signed URLs
    if (settings.slider?.photos && Array.isArray(settings.slider.photos)) {
      settings.slider.photos = settings.slider.photos.map((photo: any) => {
        const sanitizedPhoto = { ...photo };
        const sourceValue = photo.key || photo.url;
        const sanitizedKey = extractS3KeyFromUrl(sourceValue);
        if (sanitizedKey) {
          sanitizedPhoto.url = sanitizedKey;
          sanitizedPhoto.key = sanitizedKey;
        }
        return sanitizedPhoto;
      });
    }

    return settings;
  }

  /**
   * Upload slider image to S3
   */
  async uploadSliderImage(file: Buffer, filename: string) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new Error('Store ID not found in context');

    // Obtener store con org para construir path con slugs
    const store = await this.prisma.stores.findUnique({
      where: { id: store_id },
      select: {
        id: true,
        slug: true,
        organizations: {
          select: { id: true, slug: true },
        },
      },
    });

    if (!store || !store.organizations) {
      throw new Error('Store or organization not found');
    }

    // Generar path organizado con slug-id
    const timestamp = Date.now();
    const clean_filename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const basePath = this.s3PathHelper.buildEcommerceSliderPath(
      store.organizations,
      store,
    );
    const key = `${basePath}/${timestamp}-${clean_filename}`;

    // Cargar y optimizar imagen (S3Service se encarga de convertir a WebP y hacer el thumb)
    const result = await this.s3Service.uploadImage(file, key, {
      generateThumbnail: true,
    });

    // Generar URL firmada temporal para previsualización inmediata en el frontend
    const signed_url = await this.s3Service.getPresignedUrl(result.key);

    return {
      key: result.key, // Esta es la clave que guardaremos en la DB
      url: signed_url, // Esta es la URL para verla ahora
      thumbKey: result.thumbKey,
    };
  }

  /**
   * Genera favicon desde el logo de ecommerce y lo agrega a store_settings.branding
   * Se ejecuta asíncronamente para no bloquear la respuesta
   */
  private async generateFaviconForEcommerce(logoUrl: string): Promise<void> {
    try {
      const store_id = RequestContextService.getStoreId();
      if (!store_id) {
        this.logger.warn('Store ID not found in context');
        return;
      }

      // 1. Obtener store con organization y slugs para path S3
      const store = await this.prisma.stores.findUnique({
        where: { id: store_id },
        select: {
          id: true,
          slug: true,
          organization_id: true,
          organizations: {
            select: { id: true, slug: true },
          },
        },
      });

      if (!store?.organization_id || !store.organizations) {
        this.logger.warn(`Store ${store_id} missing organization data`);
        return;
      }

      // 2. Descargar logo desde S3
      let logoBuffer: Buffer;
      if (logoUrl.startsWith('http')) {
        this.logger.warn(
          'External logo URL detected, skipping favicon generation',
        );
        return;
      }

      try {
        logoBuffer = await this.s3Service.downloadImage(logoUrl);
      } catch (error) {
        this.logger.error(`Failed to download logo: ${error.message}`);
        return;
      }

      // 3. Generar y subir favicons usando path con slug-id
      const faviconPath = this.s3PathHelper.buildFaviconPath(
        store.organizations,
        store,
      );

      const result = await this.s3Service.generateAndUploadFaviconFromLogo(
        logoBuffer,
        faviconPath,
      );

      if (!result) {
        this.logger.warn(`Favicon generation failed for store ${store_id}`);
        return;
      }

      this.logger.log(`Favicons generated: ${result.sizes.join(', ')}px`);

      // 4. Update store_settings.settings.branding.favicon_url (single source of truth)
      const storeSettings = await this.prisma.store_settings.findUnique({
        where: { store_id },
      });

      if (storeSettings) {
        const currentSettings = (storeSettings.settings || {}) as StoreSettings;
        const updatedSettings: StoreSettings = {
          ...currentSettings,
          branding: {
            ...currentSettings.branding,
            favicon_url: result.faviconKey,
          },
        };

        await this.prisma.store_settings.update({
          where: { store_id },
          data: {
            settings: updatedSettings as any,
            updated_at: new Date(),
          },
        });

        this.logger.log(`Favicon updated in store_settings for store ${store_id}`);
      }
    } catch (error) {
      this.logger.error(
        `Error in generateFaviconForEcommerce: ${error.message}`,
      );
      // No re-lanzamos el error para no afectar el flujo principal si esto falla
    }
  }
}
