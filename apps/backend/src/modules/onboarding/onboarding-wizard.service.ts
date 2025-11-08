import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SetupUserWizardDto } from './dto/setup-user-wizard.dto';
import { SetupOrganizationWizardDto } from './dto/setup-organization-wizard.dto';
import { SetupStoreWizardDto } from './dto/setup-store-wizard.dto';
import { SetupAppConfigWizardDto } from './dto/setup-app-config-wizard.dto';
import { SelectAppTypeDto } from './dto/select-app-type.dto';

interface ColorPalette {
  primary: string;
  secondary: string;
  primaryLight: string;
  primaryDark: string;
  secondaryLight: string;
  secondaryDark: string;
  accent: string;
  background: string;
  text: string;
  border: string;
}

interface WizardValidation {
  isValid: boolean;
  missingSteps: string[];
}

@Injectable()
export class OnboardingWizardService {
  constructor(private readonly prismaService: PrismaService) {}

  /**
   * Get wizard status for a user
   */
  async getWizardStatus(userId: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        organizations: {
          include: {
            addresses: true,
            stores: {
              include: {
                addresses: true,
              },
            },
            domain_settings: true,
          },
        },
        addresses: true,
        user_settings: true,
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      user_id: userId,
      email_verified: user.email_verified,
      onboarding_completed: user.organizations?.onboarding || false,
      has_user_data: !!(user.first_name && user.last_name),
      has_user_address: user.addresses && user.addresses.length > 0,
      has_organization: !!user.organizations,
      has_organization_address:
        user.organizations?.addresses &&
        user.organizations.addresses.length > 0,
      has_store:
        user.organizations?.stores && user.organizations.stores.length > 0,
      has_store_address:
        user.organizations?.stores?.[0]?.addresses &&
        user.organizations.stores[0].addresses.length > 0,
      has_app_config:
        user.organizations?.domain_settings &&
        user.organizations.domain_settings.length > 0,
      current_step: this.determineCurrentStep(user),
    };
  }

  /**
   * Check email verification status
   */
  async checkEmailVerification(userId: number) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: { email_verified: true, state: true, email: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return {
      verified: user.email_verified || false,
      state: user.state || 'pending',
      email: user.email,
    };
  }

  /**
   * Select application type for the user
   */
  async selectAppType(userId: number, selectAppTypeDto: SelectAppTypeDto) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { user_settings: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Update or create user_settings with selected app type
    const config = {
      selected_app_type: selectAppTypeDto.app_type,
      selection_notes: selectAppTypeDto.notes,
      selected_at: new Date().toISOString(),
    };

    if (user.user_settings) {
      await this.prismaService.user_settings.update({
        where: { user_id: userId },
        data: {
          config: {
            ...user.user_settings.config as any,
            ...config,
          },
          updated_at: new Date(),
        },
      });
    } else {
      await this.prismaService.user_settings.create({
        data: {
          user_id: userId,
          config,
        },
      });
    }

    return {
      success: true,
      app_type: selectAppTypeDto.app_type,
      message: 'Application type selected successfully',
    };
  }

  /**
   * Setup user with address
   */
  async setupUser(userId: number, setupUserDto: SetupUserWizardDto) {
    // Update user data
    const updatedUser = await this.prismaService.users.update({
      where: { id: userId },
      data: {
        first_name: setupUserDto.first_name,
        last_name: setupUserDto.last_name,
        phone: setupUserDto.phone,
        updated_at: new Date(),
      },
    });

    // Create or update user address if provided
    if (setupUserDto.address_line1) {
      const existingAddress = await this.prismaService.addresses.findFirst({
        where: {
          user_id: userId,
          type: 'home',
        },
      });

      if (existingAddress) {
        await this.prismaService.addresses.update({
          where: { id: existingAddress.id },
          data: {
            address_line1: setupUserDto.address_line1,
            address_line2: setupUserDto.address_line2,
            city: setupUserDto.city,
            state_province: setupUserDto.state_province,
            postal_code: setupUserDto.postal_code,
            country_code: setupUserDto.country_code || 'MX',
            is_primary: true,
            updated_at: new Date(),
          },
        });
      } else {
        await this.prismaService.addresses.create({
          data: {
            user_id: userId,
            address_line1: setupUserDto.address_line1,
            address_line2: setupUserDto.address_line2,
            city: setupUserDto.city,
            state_province: setupUserDto.state_province,
            postal_code: setupUserDto.postal_code,
            country_code: setupUserDto.country_code || 'MX',
            type: 'home',
            is_primary: true,
          },
        });
      }
    }

    return updatedUser;
  }

  /**
   * Setup organization with address
   */
  async setupOrganization(
    userId: number,
    setupOrgDto: SetupOrganizationWizardDto,
  ) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    });

    if (!user?.organization_id) {
      throw new BadRequestException('User has no organization');
    }

    // Update organization
    const updatedOrg = await this.prismaService.organizations.update({
      where: { id: user.organization_id },
      data: {
        name: setupOrgDto.name,
        description: setupOrgDto.description,
        email: setupOrgDto.email,
        phone: setupOrgDto.phone,
        website: setupOrgDto.website,
        tax_id: setupOrgDto.tax_id,
        updated_at: new Date(),
      },
    });

    // Create or update organization address if provided
    if (setupOrgDto.address_line1) {
      const existingAddress = await this.prismaService.addresses.findFirst({
        where: {
          organization_id: user.organization_id,
          type: 'billing',
        },
      });

      if (existingAddress) {
        await this.prismaService.addresses.update({
          where: { id: existingAddress.id },
          data: {
            address_line1: setupOrgDto.address_line1,
            address_line2: setupOrgDto.address_line2,
            city: setupOrgDto.city,
            state_province: setupOrgDto.state_province,
            postal_code: setupOrgDto.postal_code,
            country_code: setupOrgDto.country_code || 'MX',
            is_primary: true,
            updated_at: new Date(),
          },
        });
      } else {
        await this.prismaService.addresses.create({
          data: {
            organization_id: user.organization_id,
            address_line1: setupOrgDto.address_line1,
            address_line2: setupOrgDto.address_line2,
            city: setupOrgDto.city,
            state_province: setupOrgDto.state_province,
            postal_code: setupOrgDto.postal_code,
            country_code: setupOrgDto.country_code || 'MX',
            type: 'billing',
            is_primary: true,
          },
        });
      }
    }

    return updatedOrg;
  }

  /**
   * Setup store with address
   */
  async setupStore(userId: number, setupStoreDto: SetupStoreWizardDto) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    });

    if (!user?.organization_id) {
      throw new BadRequestException('User has no organization');
    }

    // Generate slug from name
    const slug = this.generateSlug(setupStoreDto.name);

    // Create store
    const store = await this.prismaService.stores.create({
      data: {
        name: setupStoreDto.name,
        slug: slug,
        store_type: setupStoreDto.store_type || 'physical',
        timezone: setupStoreDto.timezone || 'America/Mexico_City',
        organization_id: user.organization_id,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Create store address if provided
    if (setupStoreDto.address_line1) {
      await this.prismaService.addresses.create({
        data: {
          store_id: store.id,
          address_line1: setupStoreDto.address_line1,
          address_line2: setupStoreDto.address_line2,
          city: setupStoreDto.city,
          state_province: setupStoreDto.state_province,
          postal_code: setupStoreDto.postal_code,
          country_code: setupStoreDto.country_code || 'MX',
          type: 'store',
          is_primary: true,
        },
      });
    }

    // Associate user with store
    await this.prismaService.store_users.create({
      data: {
        store_id: store.id,
        user_id: userId,
        createdAt: new Date(),
      },
    });

    return store;
  }

  /**
   * Setup app configuration and domain
   */
  async setupAppConfig(
    userId: number,
    setupAppConfigDto: SetupAppConfigWizardDto,
  ) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: {
        organization_id: true,
        organizations: { select: { name: true } },
      },
    });

    if (!user?.organization_id) {
      throw new BadRequestException('User has no organization');
    }

    // Generate subdomain if not provided
    const subdomain =
      setupAppConfigDto.subdomain ||
      await this.generateUniqueSubdomain(
        user.organizations?.slug || 'org',
        setupAppConfigDto.app_type,
      );

    // Generate color palette
    const palette = this.generateColorPalette(
      setupAppConfigDto.primary_color,
      setupAppConfigDto.secondary_color,
    );

    // Create domain configuration
    const domainConfig = await this.prismaService.domain_settings.create({
      data: {
        hostname: setupAppConfigDto.use_custom_domain
          ? setupAppConfigDto.custom_domain
          : subdomain,
        organization_id: user.organization_id,
        config: {
          branding: {
            primaryColor: setupAppConfigDto.primary_color,
            secondaryColor: setupAppConfigDto.secondary_color,
            palette: palette,
          },
          app_type: setupAppConfigDto.app_type,
        },
        domain_type: 'organization',
        is_primary: true,
        ownership: setupAppConfigDto.use_custom_domain
          ? 'custom'
          : 'vendix_subdomain',
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    // Update user settings
    const existingSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });

    const panelUI = this.generatePanelUI(setupAppConfigDto.app_type);

    if (existingSettings) {
      await this.prismaService.user_settings.update({
        where: { user_id: userId },
        data: {
          config: {
            app: setupAppConfigDto.app_type,
            panel_ui: panelUI,
          },
          updated_at: new Date(),
        },
      });
    } else {
      await this.prismaService.user_settings.create({
        data: {
          user_id: userId,
          config: {
            app: setupAppConfigDto.app_type,
            panel_ui: panelUI,
          },
        },
      });
    }

    return {
      domain: domainConfig,
      subdomain: subdomain,
      needs_dns_verification: setupAppConfigDto.use_custom_domain,
      panel_ui: panelUI,
    };
  }

  /**
   * Complete wizard and activate all entities
   */
  async completeWizard(userId: number) {
    // Validate completion
    const validation = await this.validateWizardCompletion(userId);
    if (!validation.isValid) {
      throw new BadRequestException(
        `Cannot complete wizard. Missing steps: ${validation.missingSteps.join(', ')}`,
      );
    }

    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      select: { organization_id: true },
    });

    // Mark organization as onboarded and activate it
    if (user?.organization_id) {
      await this.prismaService.organizations.update({
        where: { id: user.organization_id },
        data: {
          onboarding: true,
          state: 'active',
          updated_at: new Date(),
        },
      });

      // Mark first store as onboarded
      const store = await this.prismaService.stores.findFirst({
        where: { organization_id: user.organization_id },
      });

      if (store) {
        await this.prismaService.stores.update({
          where: { id: store.id },
          data: {
            onboarding: true,
            updated_at: new Date(),
          },
        });
      }
    }

    // Update user settings
    await this.prismaService.user_settings.update({
      where: { user_id: userId },
      data: {
        config: {
          ...(await this.getUserSettingsConfig(userId)),
          onboarding_completed: true,
        },
        updated_at: new Date(),
      },
    });

    return {
      onboarding_completed: true,
      redirect_to: '/admin/dashboard',
    };
  }

  // ===== HELPER METHODS =====

  /**
   * Determine current wizard step
   */
  private determineCurrentStep(user: any): number {
    const userConfig = user.user_settings?.config as any || {};
    const selectedAppType = userConfig.selected_app_type;

    // New 7-step flow
    if (!selectedAppType) return 1; // App type selection
    if (!user.email_verified) return 2; // Email verification
    if (!user.first_name || !user.last_name) return 3; // User setup with address

    // Conditional flow based on app type
    if (selectedAppType === 'STORE_ADMIN') {
      // Store first flow
      if (!user.organizations?.stores?.length) return 4; // Store setup
      if (!user.organizations?.name) return 5; // Auto-generated organization
      if (!user.organizations?.domain_settings?.length) return 6; // App config
      if (!user.organizations?.onboarding) return 7; // Completion
    } else if (selectedAppType === 'ORG_ADMIN') {
      // Organization first flow
      if (!user.organizations?.name) return 4; // Organization setup
      if (!user.organizations?.stores?.length) return 5; // Store setup (preloaded)
      if (!user.organizations?.domain_settings?.length) return 6; // App config
      if (!user.organizations?.onboarding) return 7; // Completion
    }

    return 8; // Done
  }

  /**
   * Validate wizard completion
   */
  private async validateWizardCompletion(
    userId: number,
  ): Promise<WizardValidation> {
    const missingSteps: string[] = [];

    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        organizations: {
          include: {
            addresses: true,
            stores: {
              include: {
                addresses: true,
              },
            },
            domain_settings: true,
          },
        },
      },
    });

    if (!user?.email_verified) {
      missingSteps.push('email_verification');
    }

    if (!user?.organizations?.name) {
      missingSteps.push('organization_setup');
    }

    if (!user?.organizations?.stores?.length) {
      missingSteps.push('store_setup');
    }

    if (!user?.organizations?.domain_settings?.length) {
      missingSteps.push('app_configuration');
    }

    return {
      isValid: missingSteps.length === 0,
      missingSteps,
    };
  }

  /**
   * Generate color palette from primary and secondary colors
   */
  private generateColorPalette(
    primary: string,
    secondary: string,
  ): ColorPalette {
    return {
      primary,
      secondary,
      primaryLight: this.lightenColor(primary, 20),
      primaryDark: this.darkenColor(primary, 20),
      secondaryLight: this.lightenColor(secondary, 20),
      secondaryDark: this.darkenColor(secondary, 20),
      accent: this.generateAccentColor(primary, secondary),
      background: '#FFFFFF',
      text: '#1F2937',
      border: '#E5E7EB',
    };
  }

  /**
   * Generate panel UI configuration based on app type
   */
  private generatePanelUI(appType: string): Record<string, boolean> {
    if (appType === 'ORG_ADMIN') {
      return {
        stores: true,
        users: true,
        dashboard: true,
        orders: true,
        analytics: true,
        reports: true,
        inventory: true,
        billing: true,
        ecommerce: true,
        audit: true,
        settings: true,
      };
    } else {
      return {
        pos: true,
        users: true,
        dashboard: true,
        analytics: true,
        reports: true,
        billing: true,
        ecommerce: true,
        settings: true,
      };
    }
  }

  /**
   * Generate unique subdomain with availability check
   */
  private async generateUniqueSubdomain(
    orgSlug: string,
    appType?: string,
    customSuffix?: string
  ): Promise<string> {
    const baseName = orgSlug
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const suffix = customSuffix || 'vendix';
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let subdomain: string;

      if (attempt === 1) {
        // First attempt: direct slug
        subdomain = `${baseName}.${suffix}`;
      } else {
        // Subsequent attempts: append random string
        const randomString = this.generateRandomString(4);
        subdomain = `${baseName}-${randomString}.${suffix}`;
      }

      // Check if subdomain is available
      const existing = await this.prismaService.domain_settings.findFirst({
        where: { hostname: subdomain },
      });

      if (!existing) {
        return subdomain;
      }
    }

    // Fallback to timestamp-based generation
    const timestamp = Date.now().toString(36);
    return `${baseName}-${timestamp}.${suffix}`;
  }

  /**
   * Generate random string for subdomain uniqueness
   */
  private generateRandomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Legacy method for backward compatibility
   */
  private generateSubdomain(orgName: string, appType: string): string {
    const cleanName = orgName
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const timestamp = Date.now().toString(36);
    return `${cleanName}-${timestamp}.vendix.com`;
  }

  /**
   * Generate slug from name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Lighten a hex color
   */
  private lightenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = ((num >> 8) & 0x00ff) + amt;
    const B = (num & 0x0000ff) + amt;
    return `#${(
      0x1000000 +
      (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
      (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
      (B < 255 ? (B < 1 ? 0 : B) : 255)
    )
      .toString(16)
      .slice(1)
      .toUpperCase()}`;
  }

  /**
   * Darken a hex color
   */
  private darkenColor(color: string, percent: number): string {
    const num = parseInt(color.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) - amt;
    const G = ((num >> 8) & 0x00ff) - amt;
    const B = (num & 0x0000ff) - amt;
    return `#${(
      0x1000000 +
      (R > 0 ? R : 0) * 0x10000 +
      (G > 0 ? G : 0) * 0x100 +
      (B > 0 ? B : 0)
    )
      .toString(16)
      .slice(1)
      .toUpperCase()}`;
  }

  /**
   * Generate accent color from primary and secondary
   */
  private generateAccentColor(primary: string, secondary: string): string {
    // Simple blend - in production you might want a more sophisticated algorithm
    return secondary;
  }

  /**
   * Get user settings config
   */
  private async getUserSettingsConfig(userId: number): Promise<any> {
    const settings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });
    return settings?.config || {};
  }
}
