import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { SetupUserWizardDto } from './dto/setup-user-wizard.dto';
import { SetupOrganizationWizardDto } from './dto/setup-organization-wizard.dto';
import { SetupStoreWizardDto } from './dto/setup-store-wizard.dto';
import { SetupAppConfigWizardDto } from './dto/setup-app-config-wizard.dto';
import { SelectAppTypeDto } from './dto/select-app-type.dto';
import { DomainConfigService } from '@common/config/domain.config';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';

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
  constructor(
    private readonly prismaService: OrganizationPrismaService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
  ) { }

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
      user_settings: user.user_settings, // Include user settings for app type
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
      selection_notes: selectAppTypeDto.notes || '',
      selected_at: new Date().toISOString(),
    };

    if (user.user_settings) {
      // Get existing config or empty object
      const existingConfig = user.user_settings.config || {};

      await this.prismaService.user_settings.update({
        where: { user_id: userId },
        data: {
          config: {
            ...existingConfig,
            ...config,
          },
          updated_at: new Date(),
        },
      });
    } else {
      await this.prismaService.user_settings.create({
        data: {
          user_id: userId,
          config: config as any,
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

    const { password, ...userWithoutPassword } = updatedUser;
    return userWithoutPassword;
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

    // Generate unique slug from name
    const slug = await this.generateUniqueStoreSlug(
      setupStoreDto.name,
      user.organization_id,
    );

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
          type: 'store_physical',
          is_primary: true,
        },
      });
    }

    // Associate user with store - Note: store_users association may not be needed for owners during onboarding

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
        organizations: { select: { slug: true, name: true } },
      },
    });

    if (!user?.organization_id) {
      throw new BadRequestException('User has no organization');
    }

    // 1. Handle Automatic Subdomain (ALWAYS created/updated as primary initially)
    let autoSubdomain: string;

    // Check if we already have an auto-domain for this org
    const existingAutoDomain = await this.prismaService.domain_settings.findFirst({
      where: {
        organization_id: user.organization_id,
        ownership: 'vendix_subdomain',
      },
    });

    if (existingAutoDomain) {
      autoSubdomain = existingAutoDomain.hostname;

      // Ensure it is set as primary/active
      await this.prismaService.domain_settings.update({
        where: { id: existingAutoDomain.id },
        data: {
          is_primary: true,
          status: 'active',
          updated_at: new Date(),
        },
      });
    } else {
      // Generate and create new unique subdomain
      autoSubdomain = await this.generateUniqueSubdomain(
        user.organizations?.slug || 'org',
        setupAppConfigDto.app_type,
      );

      // Create new domain config
      const palette = this.generateColorPalette(
        setupAppConfigDto.primary_color,
        setupAppConfigDto.secondary_color,
      );

      await this.prismaService.domain_settings.create({
        data: {
          hostname: autoSubdomain,
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
          is_primary: true, // Auto domain is primary by default until custom is verified
          ownership: 'vendix_subdomain',
          status: 'active',
          created_at: new Date(),
          updated_at: new Date(),
        },
      });
    }

    // 2. Handle Custom Domain (Optional)
    let customDomainRecord = null;
    if (setupAppConfigDto.use_custom_domain && setupAppConfigDto.custom_domain) {
      const customDomain = setupAppConfigDto.custom_domain.toLowerCase().trim();

      // Check for ownership conflict
      const existingCustom = await this.prismaService.domain_settings.findUnique({
        where: { hostname: customDomain },
      });

      if (existingCustom && existingCustom.organization_id !== user.organization_id) {
        throw new ConflictException(`The domain ${customDomain} is already in use by another organization.`);
      }

      const palette = this.generateColorPalette(
        setupAppConfigDto.primary_color,
        setupAppConfigDto.secondary_color,
      );

      if (existingCustom) {
        // Update existing record for this org
        customDomainRecord = await this.prismaService.domain_settings.update({
          where: { id: existingCustom.id },
          data: {
            config: {
              branding: {
                primaryColor: setupAppConfigDto.primary_color,
                secondaryColor: setupAppConfigDto.secondary_color,
                palette: palette,
              },
              app_type: setupAppConfigDto.app_type,
            },
            is_primary: false, // Custom domain starts as non-primary (pending)
            status: 'pending_dns',
            updated_at: new Date(),
          },
        });
      } else {
        // Create new custom domain record
        customDomainRecord = await this.prismaService.domain_settings.create({
          data: {
            hostname: customDomain,
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
            is_primary: false,
            ownership: 'custom_domain', // Using enum value 'custom_domain' not 'custom'
            status: 'pending_dns',
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
      }
    }

    // Update user settings using centralized service
    const existingSettings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });

    const config = await this.defaultPanelUIService.generatePanelUI(setupAppConfigDto.app_type);

    if (existingSettings) {
      await this.prismaService.user_settings.update({
        where: { user_id: userId },
        data: {
          config: config,
          updated_at: new Date(),
        },
      });
    } else {
      await this.prismaService.user_settings.create({
        data: {
          user_id: userId,
          config: config,
        },
      });
    }

    return {
      auto_domain: autoSubdomain,
      custom_domain: customDomainRecord,
      subdomain: autoSubdomain, // Legacy support
      needs_dns_verification: !!customDomainRecord,
      panel_ui: config.panel_ui,
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

        // Setup base payment methods for the store and organization
        await this.setupBasePaymentMethods(user.organization_id, store.id);
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

  /**
   * Setup base payment methods (cash and vouchers) for an organization and store
   */
  private async setupBasePaymentMethods(
    organizationId: number,
    storeId: number,
  ) {
    try {
      // 1. Get base payment methods from system
      const baseMethods =
        await this.prismaService.system_payment_methods.findMany({
          where: {
            name: { in: ['cash', 'payment_vouchers'] },
            is_active: true,
          },
        });

      if (baseMethods.length === 0) return;

      const methodIds = baseMethods.map((m) => m.id.toString());

      // 2. Setup Organization Payment Policy
      await this.prismaService.organization_payment_policies.upsert({
        where: { organization_id: organizationId },
        update: {
          allowed_methods: methodIds,
          updated_at: new Date(),
        },
        create: {
          organization_id: organizationId,
          allowed_methods: methodIds,
          enforce_policies: false,
          allow_store_overrides: true,
        },
      });

      // 3. Enable methods for the store
      for (const method of baseMethods) {
        await this.prismaService.store_payment_methods.upsert({
          where: {
            store_id_system_payment_method_id: {
              store_id: storeId,
              system_payment_method_id: method.id,
            },
          },
          update: {
            state: 'enabled',
            updated_at: new Date(),
          },
          create: {
            store_id: storeId,
            system_payment_method_id: method.id,
            display_name: method.display_name,
            custom_config: method.default_config || {},
            state: 'enabled',
            display_order: 0,
          },
        });
      }
    } catch (error) {
      // Don't block onboarding if payment setup fails, but log it
      console.error(
        'Error setting up base payment methods during onboarding:',
        error,
      );
    }
  }

  // ===== HELPER METHODS =====

  /**
   * Determine current wizard step (1-7)
   * Returns steps that match the frontend flow:
   * - STORE_ADMIN: 1-6 steps
   * - ORG_ADMIN: 1-7 steps
   */
  private determineCurrentStep(user: any): number {
    const userConfig = user.user_settings?.config || {};
    const selectedAppType = userConfig?.selected_app_type;

    // Step 1: App type selection
    if (!selectedAppType) return 1;

    // Step 2: Email verification
    if (!user.email_verified) return 2;

    // Step 3: User setup with address
    const hasUserData = !!(user.first_name && user.last_name);
    const hasUserAddress = user.addresses && user.addresses.length > 0;
    if (!hasUserData || !hasUserAddress) return 3;

    // Conditional flow based on app type
    if (selectedAppType === 'STORE_ADMIN') {
      // Store first flow (6 steps total)
      // Step 4: Store setup
      const hasStore =
        user.organizations?.stores && user.organizations.stores.length > 0;
      if (!hasStore) return 4;

      // Step 5: App config
      const hasAppConfig =
        user.organizations?.domain_settings &&
        user.organizations.domain_settings.length > 0;
      if (!hasAppConfig) return 5;

      // Step 6: Completion
      if (!user.organizations?.onboarding) return 6;

      // All completed
      return 6;
    } else if (selectedAppType === 'ORG_ADMIN') {
      // Organization first flow (7 steps total)
      // Step 4: Organization setup
      const hasOrganization = !!user.organizations?.name;
      if (!hasOrganization) return 4;

      // Step 5: Store setup (preloaded)
      const hasStore =
        user.organizations?.stores && user.organizations.stores.length > 0;
      if (!hasStore) return 5;

      // Step 6: App config
      const hasAppConfig =
        user.organizations?.domain_settings &&
        user.organizations.domain_settings.length > 0;
      if (!hasAppConfig) return 6;

      // Step 7: Completion
      if (!user.organizations?.onboarding) return 7;

      // All completed
      return 7;
    }

    // Fallback to step 1 if app type is unknown
    return 1;
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
        user_settings: {
          select: {
            config: true,
          },
        },
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

    // Get app type from user settings to match determineCurrentStep logic
    const userConfig = user?.user_settings?.config || {};
    const selectedAppType = userConfig?.selected_app_type;

    // If user has organization and store, they're good to go regardless of app_type
    // This makes validation more flexible and prevents blocking on minor config issues
    const hasBasicSetup =
      user?.organizations?.name && user?.organizations?.stores?.length > 0;

    if (!selectedAppType && !hasBasicSetup) {
      // Only require app_type if they don't have basic setup completed
      missingSteps.push('app_type_selection');
    }

    // Validate core requirements regardless of app type
    if (!user?.organizations?.name) {
      missingSteps.push('organization_setup');
    }

    if (!user?.organizations?.stores?.length) {
      missingSteps.push('store_setup');
    }

    // Domain settings are optional - don't block completion on this
    // if (!user?.organizations?.domain_settings?.length) {
    //   missingSteps.push('app_configuration');
    // }

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
   * Generate unique subdomain with availability check
   */
  private async generateUniqueSubdomain(
    orgSlug: string,
    appType?: string,
    customSuffix?: string,
  ): Promise<string> {
    const baseName = orgSlug
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let subdomain: string;

      if (attempt === 1) {
        // First attempt: direct slug using configured base domain
        subdomain = DomainConfigService.generateSubdomain(baseName, false);
      } else {
        // Subsequent attempts: append random string
        subdomain = DomainConfigService.generateSubdomain(baseName, true);
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
    return `${baseName}-${timestamp}.${DomainConfigService.getBaseDomain()}`;
  }

  /**
   * Generate a unique slug for stores within an organization
   */
  private async generateUniqueStoreSlug(
    storeName: string,
    organizationId: number,
  ): Promise<string> {
    const baseName = this.generateSlug(storeName);
    const maxAttempts = 10;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let slug: string;

      if (attempt === 1) {
        // First attempt: direct slug
        slug = baseName;
      } else {
        // Subsequent attempts: append random string
        const randomString = this.generateRandomString(4);
        slug = `${baseName}-${randomString}`;
      }

      // Check if slug is available within this organization
      const existing = await this.prismaService.stores.findFirst({
        where: {
          slug: slug,
        },
      });

      if (!existing) {
        return slug;
      }
    }

    // Fallback to timestamp-based generation
    const timestamp = Date.now().toString(36);
    return `${baseName}-${timestamp}`;
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
    return `${cleanName}-${timestamp}.${DomainConfigService.getBaseDomain()}`;
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
