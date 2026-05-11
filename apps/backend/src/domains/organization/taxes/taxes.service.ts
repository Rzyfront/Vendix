import { BadRequestException, Injectable } from '@nestjs/common';
import { OrganizationPrismaService } from '../../../prisma/services/organization-prisma.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from '../../store/taxes/dto';
import { RequestContextService } from '@common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';

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
  constructor(private readonly prisma: OrganizationPrismaService) {}

  private requireOrganizationId(): number {
    const context = RequestContextService.getContext();
    if (!context || typeof context.organization_id !== 'number') {
      throw new BadRequestException('Organization context is required');
    }
    return context.organization_id;
  }

  async create(dto: CreateTaxCategoryDto, _user: any) {
    const organization_id = this.requireOrganizationId();

    return this.prisma.withoutScope().tax_categories.create({
      data: {
        name: dto.name,
        description: dto.description,
        organization_id,
        store_id: null,
        tax_rates: {
          create: {
            name: dto.name,
            rate: Number(dto.rate) / 100,
            store_id: null,
            is_compound: dto.is_compound || false,
            priority: dto.sort_order || 0,
          },
        },
      },
      include: { tax_rates: true },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const organization_id = this.requireOrganizationId();
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = { organization_id };

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
    const taxCategory = await this.prisma.withoutScope().tax_categories.findFirst({
      where: { id, organization_id },
      include: { tax_rates: true },
    });
    if (!taxCategory) throw new VendixHttpException(ErrorCodes.CAT_FIND_001);

    return taxCategory;
  }

  async update(id: number, dto: UpdateTaxCategoryDto, user: any) {
    await this.findOne(id, user);

    const { store_id: _ignored_store_id, organization_id: _ignored_org_id, ...rest } =
      dto as any;

    return this.prisma.withoutScope().tax_categories.update({
      where: { id },
      data: rest,
    });
  }

  async remove(id: number, user: any) {
    await this.findOne(id, user);
    return this.prisma.withoutScope().tax_categories.delete({ where: { id } });
  }
}
