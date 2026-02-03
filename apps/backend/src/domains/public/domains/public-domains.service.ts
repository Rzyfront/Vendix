import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { S3Service } from '@common/services/s3.service';

/**
 * 🌐 Public Domains Service
 *
 * Handles domain resolution logic for public endpoints.
 * Uses GlobalPrismaService to avoid organization context requirements.
 *
 * NUEVO ESTÁNDAR: app_type es la única fuente de verdad para el tipo de aplicación.
 * El branding se obtiene desde store_settings (no desde domain.config).
 */
@Injectable()
export class PublicDomainsService {
  private readonly logger = new Logger(PublicDomainsService.name);

  constructor(
    private readonly globalPrisma: GlobalPrismaService,
    private readonly s3Service: S3Service,
  ) { }

  /**
   * Resolve domain configuration by hostname
   *
   * NUEVO ESTÁNDAR:
   * - app_type viene directo del domain (no hay mapping)
   * - branding viene de store_settings (no de domain.config)
   * - ecommerce settings vienen de store_settings
   */
  async resolveDomain(
    hostname: string,
    subdomain?: string,
    forwardedHost?: string,
  ) {
    this.logger.log(`🔍 Resolving domain: ${hostname}`);

    const domain = await this.globalPrisma.domain_settings.findUnique({
      where: { hostname },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!domain) {
      throw new NotFoundException(`Domain ${hostname} not found`);
    }

    // Fetch settings based on domain type
    let branding: any = null;
    let ecommerceSettings: any = null;
    let publicationSettings: any = null;
    let fontsSettings: any = null;

    // 1. If it's a STORE domain → read from store_settings
    if (domain.store_id) {
      const storeSettings = await this.globalPrisma.store_settings.findUnique({
        where: { store_id: domain.store_id },
      });

      if (storeSettings) {
        const settingsData = storeSettings.settings as any;
        const storeBranding = settingsData?.branding;
        ecommerceSettings = settingsData?.ecommerce;
        publicationSettings = settingsData?.publication;
        fontsSettings = settingsData?.fonts;

        // CLAVE: Para dominios STORE_ECOMMERCE, usar el branding del ecommerce
        if (domain.app_type === 'STORE_ECOMMERCE' && ecommerceSettings?.branding) {
          // Use ecommerce-specific branding
          branding = { ...ecommerceSettings.branding };

          // Migration: If ecommerce branding doesn't have all fields, fill from inicio.colores
          if (!branding.primary_color && ecommerceSettings.inicio?.colores) {
            branding.primary_color = ecommerceSettings.inicio.colores.primary_color;
            branding.secondary_color = ecommerceSettings.inicio.colores.secondary_color;
            branding.accent_color = ecommerceSettings.inicio.colores.accent_color;
          }

          // Fill missing fields with defaults
          branding.background_color = branding.background_color || '#F4F4F4';
          branding.surface_color = branding.surface_color || '#FFFFFF';
          branding.text_color = branding.text_color || '#222222';
          branding.text_secondary_color = branding.text_secondary_color || '#666666';
          branding.text_muted_color = branding.text_muted_color || '#999999';
        } else if (domain.app_type === 'STORE_ECOMMERCE' && ecommerceSettings?.inicio?.colores) {
          // Migration fallback: Use inicio.colores if no dedicated ecommerce branding exists
          branding = {
            primary_color: ecommerceSettings.inicio.colores.primary_color,
            secondary_color: ecommerceSettings.inicio.colores.secondary_color,
            accent_color: ecommerceSettings.inicio.colores.accent_color,
            background_color: '#F4F4F4',
            surface_color: '#FFFFFF',
            text_color: '#222222',
            text_secondary_color: '#666666',
            text_muted_color: '#999999',
            // Copy name and logo from store branding if available
            name: storeBranding?.name,
            logo_url: ecommerceSettings.inicio.logo_url || storeBranding?.logo_url,
            favicon_url: storeBranding?.favicon_url,
          };
        } else {
          // For non-ecommerce domains (STORE_ADMIN, etc.), use store branding
          branding = storeBranding;
        }

        // Sign branding images
        if (branding?.logo_url && !branding.logo_url.startsWith('http')) {
          branding.logo_url = await this.s3Service.signUrl(branding.logo_url);
        }
        if (branding?.favicon_url && !branding.favicon_url.startsWith('http')) {
          branding.favicon_url = await this.s3Service.signUrl(branding.favicon_url);
        }

        // Sign ecommerce images
        if (ecommerceSettings) {
          await this.signEcommerceImages(ecommerceSettings);
        }
      }
    }
    // 2. If it's an ORGANIZATION domain (no store_id) → read from organization_settings
    else if (domain.organization_id) {
      const orgSettings = await this.globalPrisma.organization_settings.findUnique({
        where: { organization_id: domain.organization_id },
      });

      if (orgSettings) {
        const settingsData = orgSettings.settings as any;
        branding = settingsData?.branding;
        fontsSettings = settingsData?.fonts;
        // Organizations don't have ecommerce/publication settings

        // Sign branding images
        if (branding?.logo_url && !branding.logo_url.startsWith('http')) {
          branding.logo_url = await this.s3Service.signUrl(branding.logo_url);
        }
        if (branding?.favicon_url && !branding.favicon_url.startsWith('http')) {
          branding.favicon_url = await this.s3Service.signUrl(branding.favicon_url);
        }
      }
    }

    // Legacy: Procesar config existente para compatibilidad
    const config = (domain.config as any) || {};

    // NUEVO: Inyectar nombre de la tienda en inicio si es necesario
    if (domain.store?.name && ecommerceSettings?.inicio) {
      if (
        !ecommerceSettings.inicio.titulo ||
        ecommerceSettings.inicio.titulo === 'Bienvenido a nuestra tienda' ||
        ecommerceSettings.inicio.titulo === 'Bienvenido a Vendix Shop'
      ) {
        ecommerceSettings.inicio.titulo = `Bienvenido a ${domain.store.name}`;
      }
    }

    // Legacy: También procesar config.inicio para compatibilidad
    if (domain.store?.name && config.inicio) {
      if (
        !config.inicio.titulo ||
        config.inicio.titulo === 'Bienvenido a nuestra tienda' ||
        config.inicio.titulo === 'Bienvenido a Vendix Shop'
      ) {
        config.inicio.titulo = `Bienvenido a ${domain.store.name}`;
      }
    }

    // Legacy: Firmar imágenes en config si existen (para compatibilidad)
    if (domain.domain_type === 'ecommerce' || domain.app_type === 'STORE_ECOMMERCE') {
      await this.signEcommerceImages(config);
    }

    return {
      id: domain.id,
      hostname: domain.hostname,
      organization_id: domain.organization_id!,
      store_id: domain.store_id ?? undefined,

      // NUEVO: app_type directo del domain (única fuente de verdad)
      app: domain.app_type,

      // NUEVO: Branding desde store_settings
      branding,
      fonts: fontsSettings,

      // NUEVO: Ecommerce settings desde store_settings
      ecommerce: ecommerceSettings,

      // NUEVO: Publication settings desde store_settings
      publication: publicationSettings,

      // Config sin app (app_type es campo directo)
      config: config || {},

      created_at: domain.created_at?.toISOString() || new Date().toISOString(),
      updated_at: domain.updated_at?.toISOString() || new Date().toISOString(),
      store_name: domain.store?.name,
      store_slug: domain.store?.slug,
      organization_name: domain.organization?.name,
      organization_slug: domain.organization?.slug,
      domain_type: domain.domain_type, // Legacy: mantener para compatibilidad
      status: domain.status,
      ssl_status: domain.ssl_status,
      is_primary: domain.is_primary,
      ownership: domain.ownership,
    };
  }

  /**
   * Firma recursivamente las URLs de imágenes en la configuración de ecommerce
   */
  private async signEcommerceImages(config: any) {
    if (!config) return;

    // 1. Firmar Slider
    if (config.slider?.photos && Array.isArray(config.slider.photos)) {
      for (const photo of config.slider.photos) {
        if (photo.url && !photo.url.startsWith('http')) {
          photo.url = await this.s3Service.signUrl(photo.url);
        }
      }
    }

    // 2. Firmar Logo en Inicio
    if (config.inicio?.logo_url && !config.inicio.logo_url.startsWith('http')) {
      config.inicio.logo_url = await this.s3Service.signUrl(
        config.inicio.logo_url,
      );
    }

    // 3. Firmar Logo en Branding (Source of Truth para el tema)
    if (
      config.branding?.logo_url &&
      !config.branding.logo_url.startsWith('http')
    ) {
      config.branding.logo_url = await this.s3Service.signUrl(
        config.branding.logo_url,
      );
    }

    // 4. Firmar Favicon en Branding
    if (
      config.branding?.favicon_url &&
      !config.branding.favicon_url.startsWith('http')
    ) {
      config.branding.favicon_url = await this.s3Service.signUrl(
        config.branding.favicon_url,
      );
    }
  }

  /**
   * Check if a hostname is available
   */
  async checkHostnameAvailability(hostname: string) {
    this.logger.log(`🔍 Checking hostname availability: ${hostname}`);

    const existing = await this.globalPrisma.domain_settings.findUnique({
      where: { hostname },
    });

    return {
      available: !existing,
      reason: existing ? 'Hostname already exists' : undefined,
    };
  }
}
