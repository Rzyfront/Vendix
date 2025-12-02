import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import {
  CreateOrganizationPaymentPolicyDto,
  UpdateOrganizationPaymentPolicyDto,
} from '../dto/organization-payment-policy.dto';

@Injectable()
export class OrganizationPaymentPoliciesService {
  constructor(private prisma: StorePrismaService) {}

  /**
   * Create payment policy for an organization
   */
  async create(
    organizationId: number,
    createDto: CreateOrganizationPaymentPolicyDto,
  ) {
    // Check if organization exists
    const organization = await this.prisma.organizations.findUnique({
      where: { id: organizationId },
    });

    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    // Check if policy already exists for this organization
    const existingPolicy =
      await this.prisma.organization_payment_policies.findFirst({
        where: { organization_id: organizationId },
      });

    if (existingPolicy) {
      throw new ConflictException(
        'Payment policy already exists for this organization',
      );
    }

    // Validate allowed methods exist
    if (createDto.allowed_methods && createDto.allowed_methods.length > 0) {
      const validMethods = await this.prisma.system_payment_methods.findMany({
        where: {
          id: { in: createDto.allowed_methods.map((id) => parseInt(id)) },
          is_active: true,
        },
      });

      if (validMethods.length !== createDto.allowed_methods.length) {
        throw new BadRequestException(
          'One or more payment methods are invalid or inactive',
        );
      }
    }

    return this.prisma.organization_payment_policies.create({
      data: {
        organization_id: organizationId,
        allowed_methods: createDto.allowed_methods || [],
        default_config: createDto.default_config || {},
        enforce_policies: createDto.enforce_policies ?? false,
        allow_store_overrides: createDto.allow_store_overrides ?? true,
        min_order_amount: createDto.min_order_amount,
        max_order_amount: createDto.max_order_amount,
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Get payment policy for an organization
   */
  async findOne(organizationId: number) {
    const policy = await this.prisma.organization_payment_policies.findFirst({
      where: { organization_id: organizationId },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!policy) {
      throw new NotFoundException(
        'Payment policy not found for this organization',
      );
    }

    return policy;
  }

  /**
   * Update payment policy for an organization
   */
  async update(
    organizationId: number,
    updateDto: UpdateOrganizationPaymentPolicyDto,
  ) {
    const policy = await this.prisma.organization_payment_policies.findFirst({
      where: { organization_id: organizationId },
    });

    if (!policy) {
      throw new NotFoundException(
        'Payment policy not found for this organization',
      );
    }

    // Validate allowed methods if being updated
    if (updateDto.allowed_methods && updateDto.allowed_methods.length > 0) {
      const validMethods = await this.prisma.system_payment_methods.findMany({
        where: {
          id: { in: updateDto.allowed_methods.map((id) => parseInt(id)) },
          is_active: true,
        },
      });

      if (validMethods.length !== updateDto.allowed_methods.length) {
        throw new BadRequestException(
          'One or more payment methods are invalid or inactive',
        );
      }
    }

    return this.prisma.organization_payment_policies.update({
      where: { id: policy.id },
      data: {
        allowed_methods: updateDto.allowed_methods,
        default_config: updateDto.default_config,
        enforce_policies: updateDto.enforce_policies,
        allow_store_overrides: updateDto.allow_store_overrides,
        min_order_amount: updateDto.min_order_amount,
        max_order_amount: updateDto.max_order_amount,
        updated_at: new Date(),
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  }

  /**
   * Delete payment policy for an organization
   */
  async remove(organizationId: number) {
    const policy = await this.prisma.organization_payment_policies.findFirst({
      where: { organization_id: organizationId },
    });

    if (!policy) {
      throw new NotFoundException(
        'Payment policy not found for this organization',
      );
    }

    await this.prisma.organization_payment_policies.delete({
      where: { id: policy.id },
    });

    return { success: true, message: 'Payment policy deleted successfully' };
  }

  /**
   * Get effective payment methods for a store considering organization policies
   */
  async getEffectivePaymentMethods(storeId: number) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      include: {
        organizations: {
          include: {
            organization_payment_policies: true,
          },
        },
      },
    });

    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const organizationPolicy =
      store.organizations.organization_payment_policies;

    // If no organization policy exists, return all store payment methods
    if (!organizationPolicy) {
      return this.prisma.store_payment_methods.findMany({
        where: {
          store_id: storeId,
          state: 'enabled',
        },
        include: {
          system_payment_method: true,
        },
        orderBy: { display_order: 'asc' },
      });
    }

    // If organization enforces policies, filter by allowed methods
    if (organizationPolicy.enforce_policies) {
      return this.prisma.store_payment_methods.findMany({
        where: {
          store_id: storeId,
          state: 'enabled',
          system_payment_method_id: {
            in: organizationPolicy.allowed_methods.map((id: string) =>
              parseInt(id),
            ),
          },
        },
        include: {
          system_payment_method: true,
        },
        orderBy: { display_order: 'asc' },
      });
    }

    // If organization doesn't enforce policies, return all enabled methods
    return this.prisma.store_payment_methods.findMany({
      where: {
        store_id: storeId,
        state: 'enabled',
      },
      include: {
        system_payment_method: true,
      },
      orderBy: { display_order: 'asc' },
    });
  }

  /**
   * Validate if a payment method can be enabled for a store based on organization policies
   */
  async validatePaymentMethodForStore(
    storeId: number,
    systemPaymentMethodId: number,
  ): Promise<{ valid: boolean; reason?: string }> {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
      include: {
        organizations: {
          include: {
            organization_payment_policies: true,
          },
        },
      },
    });

    if (!store) {
      return { valid: false, reason: 'Store not found' };
    }

    const organizationPolicy =
      store.organizations.organization_payment_policies;

    // If no organization policy, allow all methods
    if (!organizationPolicy) {
      return { valid: true };
    }

    // If organization enforces policies, check if method is allowed
    if (
      organizationPolicy.enforce_policies &&
      !organizationPolicy.allowed_methods.includes(
        systemPaymentMethodId.toString(),
      )
    ) {
      return {
        valid: false,
        reason: 'This payment method is not allowed by organization policy',
      };
    }

    return { valid: true };
  }
}
