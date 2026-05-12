import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from '../../store/taxes/dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import {
  FiscalScopeService,
  OrganizationFiscalScope,
} from '@common/services/fiscal-scope.service';

/**
 * Organization-level twin of the store TaxesService.
 *
 * Since the `add_organization_id_to_tax_categories` migration, the
 * `tax_categories` table carries an `organization_id` column with a
 * CHECK constraint enforcing that exactly one of (store_id, organization_id)
 * is set. Org-level tax categories are stored with
 * `organization_id = <ctx.organization_id>` and `store_id = NULL`.
 *
 * `findAll` returns org-scoped rows only (organization_id matches).
 * Per-store rows belonging to stores of the org are managed by the
 * store-level service, not this one.
 */
@Injectable()
export class OrgTaxesService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private requireOrganizationId(): number {
    const context = RequestContextService.getContext();
    if (!context || typeof context.organization_id !== 'number') {
      throw new BadRequestException('Organization context is required');
    }
    return context.organization_id;
  }

  private async resolveTaxTarget(store_id?: number): Promise<{
    organization_id: number;
    fiscal_scope: OrganizationFiscalScope;
    store_id: number | null;
  }> {
    const organization_id = this.requireOrganizationId();
    const fiscal_scope =
      await this.fiscalScope.requireFiscalScope(organization_id);

    if (fiscal_scope === 'ORGANIZATION') {
      return { organization_id, fiscal_scope, store_id: null };
    }

    if (store_id) {
      const store = await this.prisma.withoutScope().stores.findFirst({
        where: { id: store_id, organization_id, is_active: true },
        select: { id: true },
      });
      if (!store) {
        throw new BadRequestException(
          'Store does not belong to the current organization',
        );
      }
      return { organization_id, fiscal_scope, store_id: store.id };
    }

    const stores = await this.prisma.withoutScope().stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
      take: 2,
    });
    if (stores.length === 1) {
      return { organization_id, fiscal_scope, store_id: stores[0].id };
    }

    throw new BadRequestException(
      'store_id is required when fiscal_scope is STORE',
    );
  }

  async create(dto: CreateTaxCategoryDto, _user: any) {
    const target = await this.resolveTaxTarget(dto.store_id);

    return this.prisma.withoutScope().tax_categories.create({
      data: {
        name: dto.name,
        description: dto.description,
        organization_id: target.store_id ? null : target.organization_id,
        store_id: target.store_id,
        tax_rates: {
          create: {
            name: dto.name,
            rate: Number(dto.rate) / 100,
            store_id: target.store_id,
            is_compound: dto.is_compound || false,
            priority: dto.sort_order || 0,
          },
        },
      },
      include: { tax_rates: true },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const target = await this.resolveTaxTarget(query.store_id);
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = target.store_id
      ? { store_id: target.store_id }
      : { organization_id: target.organization_id, store_id: null };

    if (search) {
      where.name = { contains: search, mode: 'insensitive' };
    }

    const [taxCategories, total] = await Promise.all([
      this.prisma.withoutScope().tax_categories.findMany({
        where,
        skip,
        take: limit,
        include: { tax_rates: true },
      }),
      this.prisma.withoutScope().tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, _user: any) {
    const organization_id = this.requireOrganizationId();
    const storeIds = await this.prisma.withoutScope().stores.findMany({
      where: { organization_id, is_active: true },
      select: { id: true },
    });
    const taxCategory = await this.prisma.withoutScope().tax_categories.findFirst({
      where: {
        id,
        OR: [
          { organization_id, store_id: null },
          { store_id: { in: storeIds.map((store) => store.id) } },
        ],
      },
      include: { tax_rates: true },
    });
    if (!taxCategory) throw new VendixHttpException(ErrorCodes.CAT_FIND_001);

    return taxCategory;
  }

  async update(id: number, dto: UpdateTaxCategoryDto, user: any) {
    await this.findOne(id, user);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;

    const updated = await this.prisma.withoutScope().tax_categories.update({
      where: { id },
      data,
      include: { tax_rates: true },
    });

    const rateData: any = {};
    if (dto.name !== undefined) rateData.name = dto.name;
    if (dto.rate !== undefined) rateData.rate = Number(dto.rate) / 100;
    if (dto.is_compound !== undefined) rateData.is_compound = dto.is_compound;
    if (dto.sort_order !== undefined) rateData.priority = dto.sort_order;

    if (Object.keys(rateData).length > 0) {
      await this.prisma.withoutScope().tax_rates.updateMany({
        where: { tax_category_id: id },
        data: rateData,
      });
      return this.findOne(id, user);
    }

    return updated;
  }

  async remove(id: number, user: any) {
    await this.findOne(id, user);
    return this.prisma.withoutScope().tax_categories.delete({ where: { id } });
  }
}
