import {
  Injectable,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { SetupUserWizardDto } from './dto/setup-user-wizard.dto';
import { SetupOrganizationWizardDto } from './dto/setup-organization-wizard.dto';
import { SetupStoreWizardDto } from './dto/setup-store-wizard.dto';
import { SetupAppConfigWizardDto } from './dto/setup-app-config-wizard.dto';
import { SelectAppTypeDto } from './dto/select-app-type.dto';
import { DomainConfigService } from '@common/config/domain.config';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';
import {
  DomainGeneratorHelper,
  DomainContext,
} from '../../../common/helpers/domain-generator.helper';
import { BrandingGeneratorHelper } from '../../../common/helpers/branding-generator.helper';

interface WizardValidation {
  isValid: boolean;
  missingSteps: string[];
}

@Injectable()
export class OnboardingWizardService {
  constructor(
    private readonly prismaService: OrganizationPrismaService,
    private readonly globalPrisma: GlobalPrismaService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
    private readonly domainGeneratorHelper: DomainGeneratorHelper,
    private readonly brandingGeneratorHelper: BrandingGeneratorHelper,
  ) {}

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

    const userConfig = user.user_settings?.config as any;

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
      step_app_config_completed: !!userConfig?.step_app_config_completed,
      onboarding_data: userConfig?.onboarding_data || null,
      current_step: this.determineCurrentStep(user),
      user_settings: user.user_settings,
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
   * Also sets the organization's account_type based on selection
   */
  async selectAppType(userId: number, selectAppTypeDto: SelectAppTypeDto) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { user_settings: true },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    // Map app_type to organization account_type
    const accountType =
      selectAppTypeDto.app_type === 'ORG_ADMIN'
        ? 'MULTI_STORE_ORG'
        : 'SINGLE_STORE';

    // Check if already selected the same type
    const userConfig = user.user_settings?.config as any;
    if (userConfig?.selected_app_type === selectAppTypeDto.app_type) {
      return {
        success: true,
        app_type: selectAppTypeDto.app_type,
        account_type: accountType,
        message: 'Application type already selected',
        already_completed: true,
      };
    }

    // Update organization's account_type if user has an organization
    if (user.organization_id) {
      await this.prismaService.organizations.update({
        where: { id: user.organization_id },
        data: {
          account_type: accountType,
          updated_at: new Date(),
        },
      });
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
      account_type: accountType,
      message: 'Application type selected successfully',
    };
  }

  /**
   * Setup user with address
   */
  async setupUser(userId: number, setupUserDto: SetupUserWizardDto) {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: { addresses: { where: { type: 'home' } } },
    });

    if (!user) throw new BadRequestException('User not found');

    const isSameUserData =
      user.first_name === setupUserDto.first_name &&
      user.last_name === setupUserDto.last_name &&
      user.phone === setupUserDto.phone;

    const existingAddress = user.addresses?.[0];
    const isSameAddress =
      !setupUserDto.address_line1 ||
      (existingAddress &&
        existingAddress.address_line1 === setupUserDto.address_line1 &&
        existingAddress.city === setupUserDto.city &&
        existingAddress.postal_code === setupUserDto.postal_code);

    if (isSameUserData && isSameAddress) {
      const { password, ...userWithoutPassword } = user;
      return { ...userWithoutPassword, already_completed: true };
    }

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

    const organization = await this.prismaService.organizations.findUnique({
      where: { id: user.organization_id },
      include: { addresses: { where: { type: 'billing' } } },
    });

    if (organization) {
      const isSameOrgData =
        organization.name === setupOrgDto.name &&
        organization.tax_id === setupOrgDto.tax_id &&
        organization.email === setupOrgDto.email;

      const existingAddress = organization.addresses?.[0];
      const isSameAddress =
        !setupOrgDto.address_line1 ||
        (existingAddress &&
          existingAddress.address_line1 === setupOrgDto.address_line1 &&
          existingAddress.city === setupOrgDto.city);

      if (isSameOrgData && isSameAddress) {
        return { ...organization, already_completed: true };
      }
    }

    // Check if tax_id is already in use by another organization
    if (setupOrgDto.tax_id) {
      const existingOrgWithTaxId =
        await this.prismaService.organizations.findFirst({
          where: {
            tax_id: setupOrgDto.tax_id,
            id: { not: user.organization_id }, // Exclude current organization
          },
        });

      if (existingOrgWithTaxId) {
        throw new ConflictException(
          `El identificador fiscal (tax_id) '${setupOrgDto.tax_id}' ya está en uso por otra organización. Por favor verifica el RFC o utiliza uno diferente.`,
        );
      }
    }

    // Update organization
    // Note: This step is only for ORG_ADMIN flow, so ensure account_type is MULTI_STORE_ORG
    let updatedOrg;
    try {
      updatedOrg = await this.prismaService.organizations.update({
        where: { id: user.organization_id },
        data: {
          name: setupOrgDto.name,
          description: setupOrgDto.description,
          email: setupOrgDto.email,
          phone: setupOrgDto.phone,
          website: setupOrgDto.website,
          tax_id: setupOrgDto.tax_id,
          account_type: 'MULTI_STORE_ORG', // Ensure multi-store for organization flow
          updated_at: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        // Handle unique constraint violations
        if (error.code === 'P2002') {
          const target = (error.meta?.target as string[]) || [];
          if (target.includes('tax_id')) {
            throw new ConflictException(
              `El identificador fiscal (tax_id) '${setupOrgDto.tax_id}' ya está en uso. Por favor utiliza un RFC diferente o verifica la información.`,
            );
          }
          if (target.includes('slug')) {
            throw new ConflictException(
              `El slug de la organización ya está en uso. Por favor intenta con un nombre diferente.`,
            );
          }
          throw new ConflictException(
            `Ya existe una organización con alguno de estos datos únicos. Por favor verifica la información proporcionada.`,
          );
        }
      }
      throw error;
    }

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
   * Create a domain for a store
   * Generates hostname: {slug}-store.vendix.com
   */
  private async createStoreDomainInternal(
    storeId: number,
    storeSlug: string,
  ): Promise<void> {
    // Get all existing hostnames to check for uniqueness
    const existingDomains = await this.prismaService.domain_settings.findMany({
      select: { hostname: true },
    });
    const existingHostnames: Set<string> = new Set(
      existingDomains.map((d) => d.hostname as string),
    );

    // Generate unique hostname for store
    const hostname = this.domainGeneratorHelper.generateUnique(
      storeSlug,
      DomainContext.STORE,
      existingHostnames,
    );

    // Ensure only one active domain of this type
    await this.prismaService.domain_settings.updateMany({
      where: {
        store_id: storeId,
        domain_type: 'store',
        status: 'active',
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });

    // Create domain settings for the store
    await this.prismaService.domain_settings.create({
      data: {
        hostname,
        store_id: storeId,
        domain_type: 'store',
        is_primary: true,
        ownership: 'vendix_subdomain',
        status: 'active',
        ssl_status: 'none',
        config: {},
        created_at: new Date(),
        updated_at: new Date(),
      },
    });
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

    // Check if store already exists for this organization
    const existingStore = await this.prismaService.stores.findFirst({
      where: { organization_id: user.organization_id },
      include: { addresses: { where: { type: 'store_physical' } } },
    });

    if (existingStore) {
      const isSameStoreData = existingStore.name === setupStoreDto.name;
      // You might want more strict check here, but name is the main one in DTO

      if (isSameStoreData) {
        return { ...existingStore, already_completed: true };
      }

      // If name changed, update it
      const updatedStore = await this.prismaService.stores.update({
        where: { id: existingStore.id },
        data: {
          name: setupStoreDto.name,
          store_type: setupStoreDto.store_type || 'physical',
          updated_at: new Date(),
        },
      });
      return { ...updatedStore, updated: true };
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

    // NOTE: Store domain is NOT created here because we need branding info (colors, app_type)
    // which is provided later in setupAppConfig. The domain will be created there.

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

    // Get the store to create its domain with branding config
    const store = await this.prismaService.stores.findFirst({
      where: { organization_id: user.organization_id },
    });

    if (!store) {
      throw new BadRequestException(
        'Store not found. Please complete store setup first.',
      );
    }

    // 1. Handle Automatic Subdomain (ALWAYS created/updated as primary initially)
    let autoSubdomain: string;

    // Check if we already have an auto-domain for this org
    const existingAutoDomain =
      await this.prismaService.domain_settings.findFirst({
        where: {
          organization_id: user.organization_id,
          // Removed ownership constraint to find any active/inactive org domain
        },
      });

    if (existingAutoDomain) {
      // Check if the existing domain has the correct suffix (-org)
      const hasCorrectSuffix = existingAutoDomain.hostname.includes('-org.');
      autoSubdomain = existingAutoDomain.hostname;

      if (!hasCorrectSuffix) {
        // Domain exists but has OLD format (without -org suffix)
        // Generate new hostname with correct suffix
        const newHostname = this.domainGeneratorHelper.generate(
          user.organizations?.slug || 'org',
          DomainContext.ORGANIZATION,
        );

        // Check if new hostname is available
        const newHostnameExists =
          await this.prismaService.domain_settings.findFirst({
            where: { hostname: newHostname },
          });

        if (!newHostnameExists) {
          // Update existing domain to new format
          await this.prismaService.domain_settings.update({
            where: { id: existingAutoDomain.id },
            data: {
              hostname: newHostname,
              is_primary: true,
              status: 'active',
              updated_at: new Date(),
            },
          });
          autoSubdomain = newHostname;
        } else {
          // New hostname already taken, try with unique
          const existingDomains =
            await this.prismaService.domain_settings.findMany({
              select: { hostname: true },
            });
          const existingHostnames: Set<string> = new Set(
            existingDomains.map((d) => d.hostname as string),
          );
          const uniqueHostname = this.domainGeneratorHelper.generateUnique(
            user.organizations?.slug || 'org',
            DomainContext.ORGANIZATION,
            existingHostnames,
          );

          await this.prismaService.domain_settings.update({
            where: { id: existingAutoDomain.id },
            data: {
              hostname: uniqueHostname,
              is_primary: true,
              status: 'active',
              updated_at: new Date(),
            },
          });
          autoSubdomain = uniqueHostname;
        }
      } else {
        // Domain already has correct format, just ensure it's primary/active
        await this.prismaService.domain_settings.update({
          where: { id: existingAutoDomain.id },
          data: {
            is_primary: true,
            status: 'active',
            updated_at: new Date(),
          },
        });
      }
    } else {
      // Generate and create new unique subdomain
      autoSubdomain = await this.generateUniqueSubdomain(
        user.organizations?.slug || 'org',
        setupAppConfigDto.app_type,
      );

      // Generate standardized branding config
      const branding = this.brandingGeneratorHelper.generateBranding({
        name: user.organizations?.name || 'Organization',
        primaryColor: setupAppConfigDto.primary_color,
        secondaryColor: setupAppConfigDto.secondary_color,
        accentColor: setupAppConfigDto.accent_color,
        theme: 'light',
      });

      // Ensure only one active domain of this type
      await this.prismaService.domain_settings.updateMany({
        where: {
          organization_id: user.organization_id,
          domain_type: 'organization',
          status: 'active',
        },
        data: {
          status: 'disabled',
          is_primary: false,
          updated_at: new Date(),
        },
      });

      await this.prismaService.domain_settings.create({
        data: {
          hostname: autoSubdomain,
          organization_id: user.organization_id,
          config: {
            app:
              setupAppConfigDto.app_type === 'ORG_ADMIN'
                ? 'ORG_LANDING'
                : 'STORE_LANDING',
            branding: branding,
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

    // 3. Create/Update Store Domain with branding config
    let storeDomainRecord = null;
    if (store) {
      const existingStoreDomain =
        await this.prismaService.domain_settings.findFirst({
          where: {
            store_id: store.id,
            domain_type: 'store',
            // Removed ownership constraint to find any active/inactive store domain
          },
        });

      // Generate standardized branding config for store
      const storeBranding = this.brandingGeneratorHelper.generateBranding({
        name: store.name,
        primaryColor: setupAppConfigDto.primary_color,
        secondaryColor: setupAppConfigDto.secondary_color,
        accentColor: setupAppConfigDto.accent_color,
        theme: 'light',
      });

      if (existingStoreDomain) {
        // Update existing store domain with branding config
        storeDomainRecord = await this.prismaService.domain_settings.update({
          where: { id: existingStoreDomain.id },
          data: {
            config: {
              app: 'STORE_LANDING',
              branding: storeBranding,
            },
            is_primary: true,
            status: 'active',
            updated_at: new Date(),
          },
        });
      } else {
        // Generate new store domain hostname
        const existingDomains =
          await this.prismaService.domain_settings.findMany({
            select: { hostname: true },
          });
        const existingHostnames: Set<string> = new Set(
          existingDomains.map((d) => d.hostname as string),
        );
        const storeHostname = this.domainGeneratorHelper.generateUnique(
          store.slug,
          DomainContext.STORE,
          existingHostnames,
        );

        // Ensure only one active domain of this type
        await this.prismaService.domain_settings.updateMany({
          where: {
            store_id: store.id,
            domain_type: 'store',
            status: 'active',
          },
          data: {
            status: 'disabled',
            is_primary: false,
            updated_at: new Date(),
          },
        });

        // Create new store domain with branding config
        // Check if hostname already exists (to handle retries/back navigation)
        const collidingDomain =
          await this.prismaService.domain_settings.findUnique({
            where: { hostname: storeHostname },
          });

        if (collidingDomain && collidingDomain.store_id === store.id) {
          // Domain exists and belongs to this store -> Update it
          storeDomainRecord = await this.prismaService.domain_settings.update({
            where: { id: collidingDomain.id },
            data: {
              config: {
                app: 'STORE_LANDING',
                branding: storeBranding,
              },
              is_primary: true,
              ownership: 'vendix_subdomain',
              status: 'active',
              updated_at: new Date(),
            },
          });
        } else {
          // Create new store domain with branding config
          let finalHostname = storeHostname;

          // If collision exists (but belongs to someone else), regenerate!
          if (collidingDomain) {
            const latestDomains =
              await this.prismaService.domain_settings.findMany({
                select: { hostname: true },
              });
            const latestHostnames: Set<string> = new Set(
              latestDomains.map((d) => d.hostname as string),
            );

            finalHostname = this.domainGeneratorHelper.generateUnique(
              store.slug,
              DomainContext.STORE,
              latestHostnames,
            );
          }

          storeDomainRecord = await this.prismaService.domain_settings.create({
            data: {
              hostname: finalHostname,
              store_id: store.id,
              domain_type: 'store',
              config: {
                app: 'STORE_LANDING',
                branding: storeBranding,
              },
              is_primary: true,
              ownership: 'vendix_subdomain',
              status: 'active',
              ssl_status: 'none',
              created_at: new Date(),
              updated_at: new Date(),
            },
          });
        }
      }
    }

    // 4. Handle Custom Domain (Optional)
    let customDomainRecord = null;
    if (
      setupAppConfigDto.use_custom_domain &&
      setupAppConfigDto.custom_domain
    ) {
      const customDomain = setupAppConfigDto.custom_domain.toLowerCase().trim();

      // Check for ownership conflict
      const existingCustom =
        await this.prismaService.domain_settings.findUnique({
          where: { hostname: customDomain },
        });

      if (
        existingCustom &&
        existingCustom.organization_id !== user.organization_id
      ) {
        throw new ConflictException(
          `The domain ${customDomain} is already in use by another organization.`,
        );
      }

      // Generate standardized branding config for custom domain
      const customBranding = this.brandingGeneratorHelper.generateBranding({
        name: user.organizations?.name || 'Organization',
        primaryColor: setupAppConfigDto.primary_color,
        secondaryColor: setupAppConfigDto.secondary_color,
        accentColor: setupAppConfigDto.accent_color,
        theme: 'light',
      });

      if (existingCustom) {
        // Update existing record for this org
        customDomainRecord = await this.prismaService.domain_settings.update({
          where: { id: existingCustom.id },
          data: {
            config: {
              branding: customBranding,
              app:
                setupAppConfigDto.app_type === 'ORG_ADMIN'
                  ? 'ORG_LANDING'
                  : 'STORE_LANDING',
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
              branding: customBranding,
              app:
                setupAppConfigDto.app_type === 'ORG_ADMIN'
                  ? 'ORG_LANDING'
                  : 'STORE_LANDING',
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

    const uiConfig = await this.defaultPanelUIService.generatePanelUI(
      setupAppConfigDto.app_type,
    );

    const updatedConfig = {
      ...uiConfig,
      step_app_config_completed: true,
      onboarding_data: setupAppConfigDto,
    };

    if (existingSettings) {
      await this.prismaService.user_settings.update({
        where: { user_id: userId },
        data: {
          config: updatedConfig,
          updated_at: new Date(),
        },
      });
    } else {
      await this.prismaService.user_settings.create({
        data: {
          user_id: userId,
          config: updatedConfig,
        },
      });
    }

    return {
      auto_domain: autoSubdomain,
      store_domain: storeDomainRecord,
      custom_domain: customDomainRecord,
      subdomain: autoSubdomain, // Legacy support
      needs_dns_verification: !!customDomainRecord,
      panel_ui: uiConfig.panel_ui,
    };
  }

  /**
   * Complete wizard and activate all entities
   */
  async completeWizard(userId: number) {
    // ✅ NUEVO: Verificar términos OBLIGATORIOS antes de completar
    const termsCheck = await this.globalPrisma.legal_documents.findMany({
      where: {
        is_system: true,
        document_type: {
          in: ['TERMS_OF_SERVICE', 'PRIVACY_POLICY'],
        },
        is_active: true,
        organization_id: null,
        store_id: null,
      },
    });

    // Verificar aceptaciones para cada documento requerido
    for (const document of termsCheck) {
      const acceptance = await this.globalPrisma.document_acceptances.findFirst(
        {
          where: {
            user_id: userId,
            document_id: document.id,
            acceptance_version: document.version,
          },
        },
      );

      if (!acceptance) {
        throw new BadRequestException(
          `Debe aceptar los ${document.title} (versión ${document.version}) antes de completar la configuración`,
        );
      }
    }

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
   * Generate unique subdomain with availability check
   * Uses DomainGeneratorHelper for standardized suffix-based generation
   */
  private async generateUniqueSubdomain(
    orgSlug: string,
    appType?: string,
  ): Promise<string> {
    // Determine context based on app type
    // Default to ORGANIZATION context for org domains
    const context = DomainContext.ORGANIZATION;

    // Get all existing hostnames to check for uniqueness
    const existingDomains = await this.prismaService.domain_settings.findMany({
      select: { hostname: true },
    });
    const existingHostnames: Set<string> = new Set(
      existingDomains.map((d) => d.hostname as string),
    );

    // Generate unique hostname using helper
    return this.domainGeneratorHelper.generateUnique(
      orgSlug,
      context,
      existingHostnames,
    );
  }

  /**
   * Create an e-commerce domain for a store
   * Generates hostname: {slug}-shop.vendix.com
   */
  async createEcommerceDomain(
    storeId: number,
    storeSlug: string,
  ): Promise<string> {
    // Get all existing hostnames to check for uniqueness
    const existingDomains = await this.prismaService.domain_settings.findMany({
      select: { hostname: true },
    });
    const existingHostnames: Set<string> = new Set(
      existingDomains.map((d) => d.hostname as string),
    );

    // Generate unique hostname for e-commerce
    const hostname = this.domainGeneratorHelper.generateUnique(
      storeSlug,
      DomainContext.ECOMMERCE,
      existingHostnames,
    );

    // Ensure only one active domain of this type
    await this.prismaService.domain_settings.updateMany({
      where: {
        store_id: storeId,
        domain_type: 'ecommerce',
        status: 'active',
      },
      data: {
        status: 'disabled',
        is_primary: false,
        updated_at: new Date(),
      },
    });

    // Create domain settings for e-commerce
    await this.prismaService.domain_settings.create({
      data: {
        hostname,
        store_id: storeId,
        domain_type: 'ecommerce',
        is_primary: false, // E-commerce domains are not primary (store domain is primary)
        ownership: 'vendix_subdomain',
        status: 'active',
        ssl_status: 'none',
        config: {},
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return hostname;
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
   * Get user settings config
   */
  private async getUserSettingsConfig(userId: number): Promise<any> {
    const settings = await this.prismaService.user_settings.findUnique({
      where: { user_id: userId },
    });
    return settings?.config || {};
  }
}
