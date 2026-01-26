import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from './dto';
import { RequestContextService } from '@common/context/request-context.service';

@Injectable()
export class TaxesService {
  constructor(
    private prisma: StorePrismaService,
  ) { }

  /**
   * Calculates taxes for a product based on its assignments.
   * Logic: Sums all tax rates from assigned categories.
   */
  async calculateProductTaxes(productId: number, basePrice: number) {
    const assignments = await this.prisma.product_tax_assignments.findMany({
      where: { product_id: productId },
      include: {
        tax_categories: {
          include: {
            tax_rates: {
              where: {
                // In a multi-tenant environment, rates should belong to the store or be global.
                // StorePrismaService filters by store_id automatically.
              },
            },
          },
        },
      },
    });

    let totalRate = 0;
    const taxes: { tax_rate_id: number; name: string; rate: number; amount: number }[] = [];

    for (const assignment of assignments) {
      if (assignment.tax_categories?.tax_rates) {
        for (const rate of assignment.tax_categories.tax_rates) {
          const rateVal = Number(rate.rate);
          const amount = basePrice * rateVal;
          totalRate += rateVal;
          taxes.push({
            tax_rate_id: rate.id,
            name: rate.name,
            rate: rateVal,
            amount,
          });
        }
      }
    }

    return {
      total_rate: totalRate,
      total_tax_amount: basePrice * totalRate,
      taxes,
    };
  }

  async create(createTaxCategoryDto: CreateTaxCategoryDto, user: any) {
    const context = RequestContextService.getContext();
    const store_id = context?.store_id;

    if (!store_id) {
      throw new ForbiddenException('Store context required');
    }

    return this.prisma.tax_categories.create({
      data: {
        name: createTaxCategoryDto.name,
        description: createTaxCategoryDto.description,
        store_id: store_id,
        tax_rates: {
          create: {
            name: createTaxCategoryDto.name,
            rate: Number(createTaxCategoryDto.rate) / 100,
            store_id: store_id,
            is_compound: createTaxCategoryDto.is_compound || false,
            priority: createTaxCategoryDto.sort_order || 0,
          },
        },
      },
      include: {
        tax_rates: true,
      },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search)
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];

    // ✅ BYPASS MANUAL ELIMINADO - ahora usa scoping automático de PrismaService
    // El filtro store_id se aplica automáticamente según el contexto del usuario
    // Los usuarios solo pueden ver tax_categories de su store actual

    const [taxCategories, total] = await Promise.all([
      this.prisma.tax_categories.findMany({ where, skip, take: limit, include: { tax_rates: true } }),
      this.prisma.tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, user: any) {
    // Auto-scoped by StorePrismaService
    const taxCategory = await this.prisma.tax_categories.findFirst({
      where: { id },
    });
    if (!taxCategory) throw new NotFoundException('Tax category not found');

    return taxCategory;
  }

  async update(
    id: number,
    updateTaxCategoryDto: UpdateTaxCategoryDto,
    user: any,
  ) {
    await this.findOne(id, user);
    return this.prisma.tax_categories.update({
      where: { id },
      data: updateTaxCategoryDto,
    });
  }

  async remove(id: number, user: any) {
    await this.findOne(id, user);
    return this.prisma.tax_categories.delete({ where: { id } });
  }
}
