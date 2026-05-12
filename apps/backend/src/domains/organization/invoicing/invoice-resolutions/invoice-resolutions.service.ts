import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';

import { RequestContextService } from '@common/context/request-context.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { CreateOrgInvoiceResolutionDto } from './dto/create-org-invoice-resolution.dto';
import { UpdateOrgInvoiceResolutionDto } from './dto/update-org-invoice-resolution.dto';

@Injectable()
export class OrgInvoiceResolutionsService {
  private readonly logger = new Logger(OrgInvoiceResolutionsService.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private requireOrganizationId(): number {
    const organization_id = RequestContextService.getOrganizationId();
    if (!organization_id) {
      throw new ForbiddenException('Organization context is required');
    }
    return organization_id;
  }

  async findAll(store_id?: number) {
    const organization_id = this.requireOrganizationId();
    const where: any = { organization_id };
    if (typeof store_id === 'number') where.store_id = store_id;

    return this.prisma.invoice_resolutions.findMany({
      where,
      orderBy: [{ is_active: 'desc' }, { valid_to: 'desc' }],
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
        _count: { select: { invoices: true } },
      },
    });
  }

  async findOne(id: number) {
    const organization_id = this.requireOrganizationId();
    const resolution = await this.prisma.invoice_resolutions.findFirst({
      where: { id, organization_id },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
        _count: { select: { invoices: true } },
      },
    });

    if (!resolution) {
      throw new NotFoundException('Invoice resolution not found');
    }

    return resolution;
  }

  async create(dto: CreateOrgInvoiceResolutionDto) {
    const organization_id = this.requireOrganizationId();
    const store_id = await this.resolveStoreIdForWrite(organization_id, dto.store_id);
    const accounting_entity =
      await this.fiscalScope.resolveAccountingEntityForFiscal({
        organization_id,
        store_id,
      });

    const existing = await this.prisma.invoice_resolutions.findFirst({
      where: {
        organization_id,
        accounting_entity_id: accounting_entity.id,
        prefix: dto.prefix,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException(
        'An invoice resolution with this prefix already exists for the fiscal entity',
      );
    }

    const resolution = await this.prisma.withoutScope().invoice_resolutions.create({
      data: {
        organization_id,
        store_id,
        accounting_entity_id: accounting_entity.id,
        resolution_number: dto.resolution_number,
        resolution_date: new Date(dto.resolution_date),
        prefix: dto.prefix,
        range_from: dto.range_from,
        range_to: dto.range_to,
        current_number: dto.range_from - 1,
        valid_from: new Date(dto.valid_from),
        valid_to: new Date(dto.valid_to),
        is_active: dto.is_active ?? true,
        technical_key: dto.technical_key,
      },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
      },
    });

    this.logger.log(
      `Org invoice resolution ${resolution.id} created for org ${organization_id}, entity ${accounting_entity.id}`,
    );

    return resolution;
  }

  async update(id: number, dto: UpdateOrgInvoiceResolutionDto) {
    const resolution = await this.findOne(id);
    const update_data: any = {};

    if (dto.resolution_number !== undefined) {
      update_data.resolution_number = dto.resolution_number;
    }
    if (dto.resolution_date !== undefined) {
      update_data.resolution_date = new Date(dto.resolution_date);
    }
    if (dto.prefix !== undefined) update_data.prefix = dto.prefix;
    if (dto.range_from !== undefined) update_data.range_from = dto.range_from;
    if (dto.range_to !== undefined) update_data.range_to = dto.range_to;
    if (dto.valid_from !== undefined) {
      update_data.valid_from = new Date(dto.valid_from);
    }
    if (dto.valid_to !== undefined) update_data.valid_to = new Date(dto.valid_to);
    if (dto.is_active !== undefined) update_data.is_active = dto.is_active;
    if (dto.technical_key !== undefined) {
      update_data.technical_key = dto.technical_key;
    }

    if (dto.store_id !== undefined) {
      const store_id = await this.resolveStoreIdForWrite(
        resolution.organization_id,
        dto.store_id,
      );
      const accounting_entity =
        await this.fiscalScope.resolveAccountingEntityForFiscal({
          organization_id: resolution.organization_id,
          store_id,
        });
      update_data.store_id = store_id;
      update_data.accounting_entity_id = accounting_entity.id;
    }

    return this.prisma.withoutScope().invoice_resolutions.update({
      where: { id },
      data: update_data,
      include: {
        store: { select: { id: true, name: true, slug: true } },
        accounting_entity: {
          select: { id: true, name: true, fiscal_scope: true, store_id: true },
        },
      },
    });
  }

  async remove(id: number) {
    const resolution = await this.findOne(id);
    if (resolution._count.invoices > 0) {
      throw new ConflictException(
        'Cannot delete resolution with associated invoices. Deactivate it instead.',
      );
    }

    await this.prisma.withoutScope().invoice_resolutions.delete({
      where: { id },
    });
  }

  private async resolveStoreIdForWrite(
    organization_id: number,
    requested_store_id?: number | null,
  ): Promise<number | null> {
    const fiscal_scope = await this.fiscalScope.requireFiscalScope(organization_id);

    if (fiscal_scope === 'ORGANIZATION') {
      return null;
    }

    if (typeof requested_store_id !== 'number') {
      throw new BadRequestException(
        'store_id is required when fiscal_scope=STORE',
      );
    }

    const store = await this.prisma.stores.findFirst({
      where: {
        id: requested_store_id,
        organization_id,
        is_active: true,
      },
      select: { id: true },
    });

    if (!store) {
      throw new ForbiddenException(
        'Store does not belong to the current organization',
      );
    }

    return store.id;
  }
}
