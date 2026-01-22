import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EcommerceSettingsDto } from './dto/ecommerce-settings.dto';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import {
  DomainGeneratorHelper,
  DomainContext,
} from '../../../common/helpers/domain-generator.helper';
import { DomainConfigStandardizerHelper } from '../../../common/helpers/domain-config-standardizer.helper';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class EcommerceService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly brandingGeneratorHelper: BrandingGeneratorHelper,
    private readonly domainGeneratorHelper: DomainGeneratorHelper,
    private readonly configStandardizer: DomainConfigStandardizerHelper,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Get e-commerce settings from domain_settings
   * Returns null if no ecommerce domain exists (setup mode)
   */
  async getSettings() {
    // Buscar domain de tipo ecommerce para la tienda actual
    const domain = await this.prisma.domain_settings.findFirst({
      where: {
        domain_type: 'ecommerce',
      },
    });

    if (!domain) {
      // Retornar null indica modo setup (no hay configuración)
      return null;
    }

    const config = domain.config as any;

    // Firmar URLs del slider para que sean visibles en el frontend
    if (config.slider?.photos) {
      for (const photo of config.slider.photos) {
        if (photo.url && !photo.url.startsWith('http')) {
          // Si la URL es una key de S3, la firmamos
          photo.url = await this.s3Service.signUrl(photo.url);
        }
      }
    }

    // Firmar logo_url en inicio y branding si es necesario
    if (config.inicio?.logo_url && !config.inicio.logo_url.startsWith('http')) {
      const signedLogo = await this.s3Service.signUrl(config.inicio.logo_url);
      config.inicio.logo_url = signedLogo;

      // Sincronizar con branding para visualización
      if (config.branding) {
        config.branding.logo_url = signedLogo;
      }
    } else if (
      config.branding?.logo_url &&
      !config.branding.logo_url.startsWith('http')
    ) {
      // Si solo está en branding (migración), firmarlo también
      config.branding.logo_url = await this.s3Service.signUrl(
        config.branding.logo_url,
      );
    }

    return config;
  }

  /**
   * Get default template for e-commerce configuration
   */
  async getDefaultTemplate(type: 'basic' | 'advanced' = 'basic') {
    // Siempre retorna la plantilla default
    const templateName = 'ecommerce_default_settings';

    const template = await this.prisma.default_templates.findUnique({
      where: { template_name: templateName },
    });

    if (!template) {
      throw new NotFoundException(`Template '${templateName}' not found`);
    }

    return template.template_data as any;
  }

  /**
   * Update or create e-commerce settings
   * Creates domain if doesn't exist (setup mode)
   * Updates domain if exists (edit mode)
   */
  async updateSettings(ecommerceDto: EcommerceSettingsDto) {
    const appType = 'STORE_ECOMMERCE';

    // Aplicar auto-relleno si es necesario
    const settings_with_defaults = this.applyDefaultValues(ecommerceDto);

    // Buscar domain existente de tipo ecommerce
    const existingDomain = await this.prisma.domain_settings.findFirst({
      where: {
        domain_type: 'ecommerce',
      },
    });

    if (existingDomain) {
      // MODO EDICIÓN: actualizar domain existente
      const existingConfig: any = existingDomain.config;

      // Mezclamos la configuración existente con los nuevos cambios
      // Importante: No sobreescribir con arrays vacíos si el DTO no los trae
      const mergedRaw = {
        ...existingConfig,
        ...settings_with_defaults,
        slider: {
          ...existingConfig.slider,
          ...settings_with_defaults.slider,
        },
        inicio: {
          ...existingConfig.inicio,
          ...settings_with_defaults.inicio,
        },
      };

      // Limpiar y asegurar persistencia de KEYS de S3 en lugar de URLs firmadas
      if (mergedRaw.slider?.photos && Array.isArray(mergedRaw.slider.photos)) {
        mergedRaw.slider.photos = mergedRaw.slider.photos.map((photo: any) => {
          const persistedPhoto = { ...photo };
          // Si el frontend envió una KEY, esa es la que DEBE quedar en el campo 'url' de la DB
          if (photo.key) {
            persistedPhoto.url = photo.key;
          } else if (photo.url && photo.url.includes('?X-Amz-Algorithm')) {
            // Si es una URL firmada, buscamos la key en la config anterior
            const oldPhoto = existingConfig.slider?.photos?.find(
              (p: any) =>
                p.key === photo.key ||
                (p.title === photo.title && p.caption === photo.caption),
            );
            if (oldPhoto) persistedPhoto.url = oldPhoto.url || oldPhoto.key;
          }
          return persistedPhoto;
        });
      }

      // Lo mismo para el logo_url
      if (
        mergedRaw.inicio?.logo_url &&
        mergedRaw.inicio.logo_url.includes('?X-Amz-Algorithm')
      ) {
        // Intentar mantener el logo anterior si el nuevo es solo una firma temporal
        mergedRaw.inicio.logo_url =
          existingConfig.inicio?.logo_url || mergedRaw.inicio.logo_url;
      }

      // Sincronizar colores de inicio.colores con branding en modo edición
      if (mergedRaw.inicio?.colores) {
        if (!mergedRaw.branding) {
          mergedRaw.branding = {};
        }

        // Actualizar colores en branding
        mergedRaw.branding.primary_color =
          mergedRaw.inicio.colores.primary_color ||
          mergedRaw.branding.primary_color;
        mergedRaw.branding.secondary_color =
          mergedRaw.inicio.colores.secondary_color ||
          mergedRaw.branding.secondary_color;
        mergedRaw.branding.accent_color =
          mergedRaw.inicio.colores.accent_color ||
          mergedRaw.branding.accent_color;
      }

      // Estandarizamos para asegurar que branding y app sean correctos
      const standardizedConfig = this.configStandardizer.standardize(
        mergedRaw,
        appType,
      );

      return this.prisma.domain_settings.update({
        where: { id: existingDomain.id },
        data: {
          config: standardizedConfig,
          updated_at: new Date(),
        },
      });
    } else {
      // MODO CREACIÓN: crear nuevo domain
      const store_id = RequestContextService.getStoreId();
      if (!store_id) throw new Error('Store ID not found in context');

      const store = await this.prisma.stores.findUnique({
        where: { id: store_id },
        include: { organizations: true },
      });

      const orgDomain = await this.prisma.domain_settings.findFirst({
        where: {
          organization_id: store?.organization_id,
          ownership: 'vendix_subdomain',
          domain_type: 'organization',
        },
      });
      const orgBranding = (orgDomain?.config as any)?.branding || null;

      const branding = this.brandingGeneratorHelper.generateBranding({
        name: store?.name || 'Vendix Shop',
        primaryColor:
          settings_with_defaults.inicio?.colores?.primary_color ||
          orgBranding?.primary_color,
        secondaryColor:
          settings_with_defaults.inicio?.colores?.secondary_color ||
          orgBranding?.secondary_color,
        theme: 'light',
        logoUrl:
          settings_with_defaults.inicio?.logo_url || orgBranding?.logo_url,
        faviconUrl: orgBranding?.favicon_url,
      });

      // Si hay accent_color en inicio.colores, agregarlo al branding
      if (settings_with_defaults.inicio?.colores?.accent_color) {
        branding.accent_color =
          settings_with_defaults.inicio.colores.accent_color;
      }

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

      // Estandarizamos la configuración inicial
      const standardizedConfig = this.configStandardizer.standardize(
        {
          ...settings_with_defaults,
          branding,
        },
        appType,
      );

      return this.prisma.domain_settings.create({
        data: {
          hostname,
          domain_type: 'ecommerce',
          is_primary: false,
          ownership: 'vendix_subdomain',
          config: standardizedConfig,
        },
      });
    }
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

      // Sincronizar colores de inicio.colores con branding
      if (settings.inicio.colores) {
        // Asegurar que branding existe
        if (!settings.branding) {
          settings.branding = {};
        }

        // Sincronizar colores
        if (settings.inicio.colores.primary_color) {
          settings.branding.primary_color =
            settings.inicio.colores.primary_color;
        }
        if (settings.inicio.colores.secondary_color) {
          settings.branding.secondary_color =
            settings.inicio.colores.secondary_color;
        }
        if (settings.inicio.colores.accent_color) {
          settings.branding.accent_color = settings.inicio.colores.accent_color;
        }
      }
    }

    return settings;
  }

  /**
   * Upload slider image to S3
   */
  async uploadSliderImage(file: Buffer, filename: string) {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new Error('Store ID not found in context');

    // Generar path organizado por tienda
    const timestamp = Date.now();
    const clean_filename = filename.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
    const key = `stores/${store_id}/ecommerce/slider/${timestamp}-${clean_filename}`;

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
}
