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

@Injectable()
export class EcommerceService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly brandingGeneratorHelper: BrandingGeneratorHelper,
    private readonly domainGeneratorHelper: DomainGeneratorHelper,
    private readonly configStandardizer: DomainConfigStandardizerHelper,
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

    return domain.config as any;
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
      const mergedRaw = {
        ...existingConfig,
        ...settings_with_defaults,
      };

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
   * This method will be implemented when S3Service is available
   */
  async uploadSliderImage(file: Buffer, filename: string) {
    // TODO: Implement S3 upload when S3Service is available
    // For now, return a mock response
    return {
      key: `https://s3.amazonaws.com/vendix-assets/ecommerce/slider/${filename}`,
      thumbKey: `https://s3.amazonaws.com/vendix-assets/ecommerce/slider/thumb_${filename}`,
    };
  }
}
