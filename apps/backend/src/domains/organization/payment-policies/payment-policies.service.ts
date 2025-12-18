import { Injectable, NotFoundException } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import { UpdatePaymentPoliciesDto } from './dto';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class PaymentPoliciesService {
  constructor(private prisma: OrganizationPrismaService) {}

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
}
