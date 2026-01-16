import { Injectable, NotFoundException } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EcommerceSettingsDto } from './dto/ecommerce-settings.dto';

@Injectable()
export class EcommerceService {
  constructor(
    private readonly prisma: StorePrismaService,
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
      return this.prisma.domain_settings.update({
        where: { id: existingDomain.id },
        data: {
          config: configWithApp as any,
          updated_at: new Date(),
        },
      });
    } else {
      // MODO CREACIÓN: crear nuevo domain
      // StorePrismaService auto-injecta store_id, pero necesitamos el valor para el hostname
      const context = this.prisma as any;
      const store_id = context?.['_context']?.store_id || Math.floor(Math.random() * 10000);

      return this.prisma.domain_settings.create({
        data: {
          hostname: `${store_id}-ecommerce.vendix.com`,
          domain_type: 'ecommerce',
          is_primary: false,
          ownership: 'vendix_subdomain',
          config: configWithApp as any,
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
