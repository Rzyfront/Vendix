import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EcommerceSettingsDto } from './dto/ecommerce-settings.dto';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';
import { DomainGeneratorHelper, DomainContext } from '../../../common/helpers/domain-generator.helper';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class EcommerceService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly brandingGeneratorHelper: BrandingGeneratorHelper,
    private readonly domainGeneratorHelper: DomainGeneratorHelper,
  ) { }

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
    const templateName = type === 'basic' ? 'ecommerce_basic' : 'ecommerce_advanced';

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
    // Always ensure app field is set
    const configWithApp = {
      ...ecommerceDto,
      app: 'STORE_ECOMMERCE',
    };

    // Buscar domain existente de tipo ecommerce
    const existingDomain = await this.prisma.domain_settings.findFirst({
      where: {
        domain_type: 'ecommerce',
      },
    });

    if (existingDomain) {
      // MODO EDICIÓN: actualizar domain existente
      // Preserve existing branding if not provided in update (unlikely for now as DTO doesn't have it)
      // Ideally we merge with existing config
      const existingConfig: any = existingDomain.config;
      const mergedConfig = {
        ...existingConfig,
        ...configWithApp,
        // Ensure branding persists if we overwrite config
        branding: existingConfig.branding || (configWithApp as any).branding
      };

      return this.prisma.domain_settings.update({
        where: { id: existingDomain.id },
        data: {
          config: mergedConfig,
          updated_at: new Date(),
        },
      });
    } else {
      // MODO CREACIÓN: crear nuevo domain
      // StorePrismaService auto-injecta store_id, pero necesitamos el valor para el hostname
      const store_id = RequestContextService.getStoreId();
      if (!store_id) throw new Error('Store ID not found in context');

      // Get store info for branding
      const store = await this.prisma.stores.findUnique({
        where: { id: store_id },
        include: { organizations: true }
      });

      // Get org branding
      // Since StorePrismaService handles scoping, we might need a way to get org info
      // Or just use defaults if not found.
      const orgDomain = await this.prisma.domain_settings.findFirst({
        where: {
          organization_id: store?.organization_id,
          ownership: 'vendix_subdomain',
          domain_type: 'organization'
        }
      });
      const orgBranding = (orgDomain?.config as any)?.branding || null;

      // Generate branding
      const branding = this.brandingGeneratorHelper.generateBranding({
        name: store?.name || 'Vendix Shop',
        primaryColor: orgBranding?.primary_color,
        secondaryColor: orgBranding?.secondary_color,
        theme: 'light',
        logoUrl: orgBranding?.logo_url,
        faviconUrl: orgBranding?.favicon_url,
      });

      // Generate hostname
      // We can use the helper, but we need standard slug based on store slug if possible
      // Store slug might be stored in store record.
      const slug = store?.slug || `${store_id}`;

      // We need to check existing hostnames to generate unique
      const existingDomains = await this.prisma.domain_settings.findMany({ select: { hostname: true } });
      const existingHostnames: Set<string> = new Set(existingDomains.map((d) => d.hostname as string));

      const hostname = this.domainGeneratorHelper.generateUnique(
        slug,
        DomainContext.ECOMMERCE,
        existingHostnames
      );

      return this.prisma.domain_settings.create({
        data: {
          hostname,
          domain_type: 'ecommerce',
          is_primary: false,
          ownership: 'vendix_subdomain',
          config: {
            ...configWithApp,
            branding,
          },
        },
      });
    }
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
