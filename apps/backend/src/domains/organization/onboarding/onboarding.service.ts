import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  OrganizationOnboardingStatusDto,
  StoreOnboardingStatusDto,
  CompleteOrganizationOnboardingDto,
  CompleteStoreOnboardingDto,
} from './dto/onboarding-status.dto';

@Injectable()
export class OnboardingService {
  constructor(private readonly prismaService: OrganizationPrismaService) {}

  // ===== ORGANIZATION ONBOARDING METHODS =====

  async getOrganizationOnboardingStatus(
    organizationId: number,
  ): Promise<OrganizationOnboardingStatusDto> {
    const organization = await this.prismaService.organizations.findUnique({
      where: { id: organizationId },
      include: {
        stores: {
          select: {
            id: true,
            onboarding: true,
          },
        },
        addresses: {
          select: {
            id: true,
            type: true,
          },
        },
      },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const requirements =
      await this.validateOrganizationRequirements(organizationId);
    const nextStep = this.getNextOrganizationStep(requirements, organization);

    return {
      organization_id: organizationId,
      onboarding_completed: organization.onboarding,
      next_step: nextStep,
      requirements_met: requirements,
    };
  }

  async completeOrganizationOnboarding(
    organizationId: number,
    completeDto: CompleteOrganizationOnboardingDto = {},
  ): Promise<OrganizationOnboardingStatusDto> {
    const requirements = await this.validateOrganizationRequirements(
      organizationId,
      completeDto.skip_store_validation,
    );

    if (!requirements.every((req) => req === 'completed')) {
      throw new BadRequestException(
        'Cannot complete onboarding: Missing requirements',
      );
    }

    const updatedOrganization = await this.prismaService.organizations.update({
      where: { id: organizationId },
      data: {
        onboarding: true,
        state: 'active',
      },
    });

    return {
      organization_id: organizationId,
      onboarding_completed: updatedOrganization.onboarding,
      next_step: 'complete',
      requirements_met: requirements,
    };
  }

  async resetOrganizationOnboarding(
    organizationId: number,
  ): Promise<OrganizationOnboardingStatusDto> {
    const updatedOrganization = await this.prismaService.organizations.update({
      where: { id: organizationId },
      data: {
        onboarding: false,
        state: 'draft',
      },
    });

    return {
      organization_id: organizationId,
      onboarding_completed: updatedOrganization.onboarding,
      next_step: 'restart',
      requirements_met: [],
    };
  }

  // ===== STORE ONBOARDING METHODS =====

  async getStoreOnboardingStatus(
    storeId: number,
  ): Promise<StoreOnboardingStatusDto> {
    const store = await this.prismaService.stores.findUnique({
      where: { id: storeId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
        addresses: {
          select: {
            id: true,
            type: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const requirements = await this.validateStoreRequirements(storeId);
    const nextStep = this.getNextStoreStep(requirements, store);

    return {
      store_id: storeId,
      organization_id: store.organization_id,
      onboarding_completed: store.onboarding,
      next_step: nextStep,
      requirements_met: requirements,
    };
  }

  async completeStoreOnboarding(
    storeId: number,
    completeDto: CompleteStoreOnboardingDto,
  ): Promise<StoreOnboardingStatusDto> {
    const requirements = await this.validateStoreRequirements(
      storeId,
      completeDto.force_complete,
    );

    if (!requirements.every((req) => req === 'completed')) {
      throw new BadRequestException(
        'Cannot complete store onboarding: Missing requirements',
      );
    }

    const updatedStore = await this.prismaService.stores.update({
      where: { id: storeId },
      data: {
        onboarding: true,
      },
    });

    return {
      store_id: storeId,
      organization_id: updatedStore.organization_id,
      onboarding_completed: updatedStore.onboarding,
      next_step: 'complete',
      requirements_met: requirements,
    };
  }

  async resetStoreOnboarding(
    storeId: number,
  ): Promise<StoreOnboardingStatusDto> {
    const updatedStore = await this.prismaService.stores.update({
      where: { id: storeId },
      data: {
        onboarding: false,
      },
    });

    return {
      store_id: storeId,
      organization_id: updatedStore.organization_id,
      onboarding_completed: updatedStore.onboarding,
      next_step: 'restart',
      requirements_met: [],
    };
  }

  // ===== USER ONBOARDING STATUS (LEGACY SUPPORT) =====

  async getUserOnboardingStatus(userId: number): Promise<{
    email_verified: boolean;
    can_create_organization: boolean;
    has_organization: boolean;
    organization_id?: number;
    organization_onboarding_completed?: boolean;
    stores_onboarding_completed?: boolean;
    next_step: string;
  }> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        organizations: {
          include: {
            stores: {
              select: {
                id: true,
                onboarding: true,
              },
            },
          },
        },
        user_roles: {
          include: {
            roles: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const email_verified = user.email_verified;
    const has_organization = !!user.organization_id;
    const can_create_organization =
      await this.canUserCreateOrganization(userId);

    let organization_onboarding_completed = false;
    let stores_onboarding_completed = false;
    let next_step = '';

    if (email_verified) {
      if (!has_organization) {
        next_step = 'create_organization';
      } else if (user.organizations) {
        organization_onboarding_completed = user.organizations.onboarding;

        if (!organization_onboarding_completed) {
          next_step = 'complete_organization_onboarding';
        } else {
          // Check if all stores have completed onboarding
          const allStoresCompleted = user.organizations.stores.every(
            (store) => store.onboarding,
          );
          stores_onboarding_completed = allStoresCompleted;

          if (!allStoresCompleted) {
            next_step = 'complete_store_onboarding';
          } else {
            next_step = 'complete';
          }
        }
      }
    } else {
      next_step = 'verify_email';
    }

    return {
      email_verified,
      can_create_organization,
      has_organization,
      organization_id: user.organization_id || undefined,
      organization_onboarding_completed,
      stores_onboarding_completed,
      next_step,
    };
  }

  // ===== VALIDATION METHODS =====

  private async validateOrganizationRequirements(
    organizationId: number,
    skipStoreValidation = false,
  ): Promise<string[]> {
    const requirements: string[] = [];

    // Check if organization has basic info
    const org = await this.prismaService.organizations.findUnique({
      where: { id: organizationId },
      include: {
        addresses: true,
        stores: true,
      },
    });

    if (!org) {
      return ['organization_not_found'];
    }

    // Basic organization info
    if (org.name && org.email) {
      requirements.push('basic_info_completed');
    } else {
      requirements.push('basic_info_missing');
    }

    // Address requirement
    const hasAddress = org.addresses.length > 0;
    if (hasAddress) {
      requirements.push('address_completed');
    } else {
      requirements.push('address_missing');
    }

    // Store requirement (can be skipped for certain scenarios)
    if (skipStoreValidation) {
      requirements.push('store_validation_skipped');
    } else {
      const hasStores = org.stores.length > 0;
      if (hasStores) {
        requirements.push('store_created');
      } else {
        requirements.push('store_missing');
      }
    }

    return requirements;
  }

  private async validateStoreRequirements(
    storeId: number,
    forceComplete = false,
  ): Promise<string[]> {
    const requirements: string[] = [];

    if (forceComplete) {
      return ['forced_completion'];
    }

    const store = await this.prismaService.stores.findUnique({
      where: { id: storeId },
      include: {
        addresses: true,
      },
    });

    if (!store) {
      return ['store_not_found'];
    }

    // Basic store info
    if (store.name && store.slug) {
      requirements.push('basic_info_completed');
    } else {
      requirements.push('basic_info_missing');
    }

    // Address requirement
    const hasAddress = store.addresses.length > 0;
    if (hasAddress) {
      requirements.push('address_completed');
    } else {
      requirements.push('address_missing');
    }

    return requirements;
  }

  private getNextOrganizationStep(
    requirements: string[],
    organization: any,
  ): string {
    if (organization.onboarding) {
      return 'complete';
    }

    if (!requirements.includes('basic_info_completed')) {
      return 'setup_basic_info';
    }

    if (!requirements.includes('address_completed')) {
      return 'setup_address';
    }

    if (!requirements.includes('store_created')) {
      return 'create_store';
    }

    return 'ready_to_complete';
  }

  private getNextStoreStep(requirements: string[], store: any): string {
    if (store.onboarding) {
      return 'complete';
    }

    if (!requirements.includes('basic_info_completed')) {
      return 'setup_basic_info';
    }

    if (!requirements.includes('address_completed')) {
      return 'setup_address';
    }

    return 'ready_to_complete';
  }

  private async canUserCreateOrganization(userId: number): Promise<boolean> {
    const user = await this.prismaService.users.findUnique({
      where: { id: userId },
      include: {
        user_roles: {
          include: {
            roles: true,
          },
        },
        organizations: {
          where: {
            onboarding: false,
          },
        },
      },
    });

    if (!user || !user.email_verified) {
      return false;
    }

    // User cannot create organization if they have any organization with pending onboarding
    if (user.organizations && user.organizations.length > 0) {
      return false;
    }

    // Check if user is already an owner
    const isOwner = user.user_roles?.some(
      (userRole) => userRole.roles?.name === 'owner',
    );

    return !isOwner;
  }
}
