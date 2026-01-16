import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  UpdatePaymentPoliciesDto,
  PaymentMethodDto,
  UpdatePaymentMethodsDto,
} from './dto';
import { RequestContextService } from '@common/context/request-context.service';
import { S3Service } from '@common/services/s3.service';

@Injectable()
export class PaymentPoliciesService {
  constructor(
    private prisma: OrganizationPrismaService,
    private s3Service: S3Service,
  ) {}

  async findOne() {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new NotFoundException('Organization context is required');
    }

    const policy = await this.prisma.organization_payment_policies.findUnique({
      where: { organization_id: organizationId },
    });

    if (!policy) {
      throw new NotFoundException('Organization payment policies not found');
    }

    return policy;
  }

  async update(updateDto: UpdatePaymentPoliciesDto) {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new NotFoundException('Organization context is required');
    }

    const existing = await this.prisma.organization_payment_policies.findUnique(
      {
        where: { organization_id: organizationId },
      },
    );

    if (existing) {
      return this.prisma.organization_payment_policies.update({
        where: { organization_id: organizationId },
        data: {
          ...updateDto,
          updated_at: new Date(),
        },
      });
    } else {
      return this.prisma.organization_payment_policies.create({
        data: {
          organization_id: organizationId,
          ...updateDto,
        },
      });
    }
  }

  async createDefault(organizationId: number) {
    return this.prisma.organization_payment_policies.create({
      data: {
        organization_id: organizationId,
        allowed_methods: ['stripe'], // Default allowed methods
        default_config: {},
        enforce_policies: false,
        allow_store_overrides: true,
      },
    });
  }

  async getAvailableMethods(): Promise<PaymentMethodDto[]> {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new NotFoundException('Organization context is required');
    }

    // Get current policies
    const policies = await this.prisma.organization_payment_policies.findUnique(
      {
        where: { organization_id: organizationId },
      },
    );

    const allowedMethods = policies?.allowed_methods || [];

    // Get all active system payment methods
    const systemMethods = await this.prisma.system_payment_methods.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
    });

    // Sign URLs and mark as allowed
    const methodsWithUrls = await Promise.all(
      systemMethods.map(async (method) => ({
        id: method.id,
        name: method.name,
        display_name: method.display_name,
        description: method.description,
        type: method.type,
        provider: method.provider,
        logo_url: method.logo_url
          ? await this.s3Service.signUrl(method.logo_url)
          : null,
        is_active: method.is_active,
        is_allowed: allowedMethods.includes(method.name),
        requires_config: method.requires_config,
        supported_currencies: method.supported_currencies,
        min_amount: method.min_amount ? Number(method.min_amount) : undefined,
        max_amount: method.max_amount ? Number(method.max_amount) : undefined,
      })),
    );

    return methodsWithUrls;
  }

  async updatePaymentMethods(updateDto: UpdatePaymentMethodsDto) {
    const organizationId = RequestContextService.getOrganizationId();
    if (!organizationId) {
      throw new NotFoundException('Organization context is required');
    }

    const existing = await this.prisma.organization_payment_policies.findUnique(
      {
        where: { organization_id: organizationId },
      },
    );

    if (existing) {
      return this.prisma.organization_payment_policies.update({
        where: { organization_id: organizationId },
        data: {
          allowed_methods: updateDto.allowed_methods,
          updated_at: new Date(),
        },
      });
    } else {
      return this.prisma.organization_payment_policies.create({
        data: {
          organization_id: organizationId,
          allowed_methods: updateDto.allowed_methods,
          enforce_policies: false,
          allow_store_overrides: true,
        },
      });
    }
  }
}
