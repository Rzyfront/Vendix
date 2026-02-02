import { Injectable, Logger } from '@nestjs/common';
import { GlobalPrismaService } from '../../prisma/services/global-prisma.service';
import { EmailBranding } from '../interfaces/branding.interface';

/**
 * Service to resolve branding for emails without HTTP context
 * Used by AuthService when sending welcome emails to staff and customers
 */
@Injectable()
export class EmailBrandingService {
  private readonly logger = new Logger(EmailBrandingService.name);

  constructor(private readonly globalPrisma: GlobalPrismaService) {}

  /**
   * Get branding for a store by ID
   * Used for staff and customer registration
   */
  async getStoreBranding(storeId: number): Promise<EmailBranding> {
    try {
      // Find domain_settings for the store
      const domain = await this.globalPrisma.domain_settings.findFirst({
        where: {
          store_id: storeId,
          status: 'active',
        },
        orderBy: { is_primary: 'desc' },
      });

      if (!domain) {
        this.logger.warn(`No domain settings found for store ${storeId}`);
        // Fallback: try organization branding
        return this.getOrganizationBrandingFromStore(storeId);
      }

      return this.extractBrandingFromConfig(domain.config as any);
    } catch (error) {
      this.logger.error(`Error fetching branding for store ${storeId}: ${error.message}`);
      return this.getDefaultBranding();
    }
  }

  /**
   * Get branding for an organization by ID
   * Used for staff registration at organization level
   *
   * Source of truth: organization_settings.settings.branding
   */
  async getOrganizationBranding(organizationId: number): Promise<EmailBranding> {
    try {
      // Read from organization_settings (source of truth)
      const orgSettings = await this.globalPrisma.organization_settings.findUnique({
        where: { organization_id: organizationId },
      });

      if (orgSettings?.settings) {
        const settings = orgSettings.settings as any;
        if (settings.branding) {
          return this.extractBrandingFromOrgSettings(settings.branding);
        }
      }

      this.logger.warn(`No organization settings found for organization ${organizationId}`);
      return this.getDefaultBranding();
    } catch (error) {
      this.logger.error(`Error fetching branding for organization ${organizationId}: ${error.message}`);
      return this.getDefaultBranding();
    }
  }

  /**
   * Extract branding from organization_settings.settings.branding
   */
  private extractBrandingFromOrgSettings(branding: any): EmailBranding {
    return {
      company_name: branding.name || 'Vendix',
      logo_url: branding.logo_url,
      favicon_url: branding.favicon_url,
      primary_color: branding.primary_color || '#7ED7A5',
      secondary_color: branding.secondary_color || '#2F6F4E',
      accent_color: branding.accent_color,
      background_color: branding.background_color,
      text_color: branding.text_color,
    };
  }

  /**
   * Get organization and store names for email personalization
   */
  async getNames(
    organizationId?: number,
    storeId?: number,
  ): Promise<{ organizationName?: string; storeName?: string }> {
    try {
      if (storeId) {
        const store = await this.globalPrisma.stores.findUnique({
          where: { id: storeId },
          select: {
            name: true,
            organizations: {
              select: { name: true },
            },
          },
        });
        return {
          storeName: store?.name,
          organizationName: store?.organizations?.name,
        };
      }

      if (organizationId) {
        const org = await this.globalPrisma.organizations.findUnique({
          where: { id: organizationId },
          select: { name: true },
        });
        return { organizationName: org?.name };
      }

      return {};
    } catch (error) {
      this.logger.error(`Error fetching names: ${error.message}`);
      return {};
    }
  }

  /**
   * Extract branding from domain_settings.config JSON
   */
  private extractBrandingFromConfig(config: any): EmailBranding {
    const branding = config?.branding || {};

    return {
      company_name: branding.company_name || branding.name,
      store_name: branding.store_name,
      logo_url: branding.logo_url,
      favicon_url: branding.favicon_url,
      primary_color: branding.primary_color,
      secondary_color: branding.secondary_color,
      accent_color: branding.accent_color,
      background_color: branding.background_color,
      text_color: branding.text_color,
    };
  }

  /**
   * Fallback: Get organization branding when store branding is not available
   */
  private async getOrganizationBrandingFromStore(storeId: number): Promise<EmailBranding> {
    try {
      const store = await this.globalPrisma.stores.findUnique({
        where: { id: storeId },
        select: { organizations: true },
      });

      if (store?.organizations) {
        return this.getOrganizationBranding(store.organizations.id);
      }

      return this.getDefaultBranding();
    } catch (error) {
      this.logger.error(`Error fetching organization branding from store ${storeId}: ${error.message}`);
      return this.getDefaultBranding();
    }
  }

  /**
   * Default Vendix branding
   * Used when no custom branding is configured
   */
  getDefaultBranding(): EmailBranding {
    return {
      company_name: 'Vendix',
      primary_color: '#7ED7A5',
      secondary_color: '#2F6F4E',
      accent_color: '#FFFFFF',
      background_color: '#F8FAFC',
      text_color: '#1F2937',
    };
  }
}
