import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
  TaxCalculationDto,
  TaxCalculationResultDto,
} from './dto';

@Injectable()
export class TaxesService {
  constructor(private prisma: PrismaService) {}

  async create(createTaxCategoryDto: CreateTaxCategoryDto, user: any) {
    if (createTaxCategoryDto.store_id) {
      await this.validateStoreAccess(createTaxCategoryDto.store_id, user);
    }

    // Create only basic tax category (schema only has id, store_id, name, description)
    return await this.prisma.tax_categories.create({
      data: {
        name: createTaxCategoryDto.name,
        description: createTaxCategoryDto.description,
        store_id: createTaxCategoryDto.store_id,
      },
      include: {
        stores: { select: { id: true, name: true } },
        _count: { select: { product_tax_assignments: true } },
      },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      store_id,
      sort_by = 'name',
      sort_order = 'asc',
    } = query;

    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (store_id) {
      where.store_id = store_id;
    }

    const [taxCategories, total] = await Promise.all([
      this.prisma.tax_categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: { select: { id: true, name: true } },
          _count: { select: { product_tax_assignments: true } },
        },
      }),
      this.prisma.tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number, user: any) {
    const taxCategory = await this.prisma.tax_categories.findUnique({
      where: { id },
      include: {
        stores: { select: { id: true, name: true } },
        product_tax_assignments: {
          include: {
            products: { select: { id: true, name: true, sku: true } },
          },
        },
        tax_rates: true, // Include related tax rates
        _count: { select: { product_tax_assignments: true } },
      },
    });

    if (!taxCategory) {
      throw new NotFoundException('Tax category not found');
    }

    // Validate access if store_id exists
    if (taxCategory.store_id) {
      await this.validateStoreAccess(taxCategory.store_id, user);
    }

    return taxCategory;
  }

  async update(
    id: number,
    updateTaxCategoryDto: UpdateTaxCategoryDto,
    user: any,
  ) {
    const taxCategory = await this.prisma.tax_categories.findUnique({
      where: { id },
    });

    if (!taxCategory) {
      throw new NotFoundException('Tax category not found');
    }

    // Validate access if store_id exists
    if (taxCategory.store_id) {
      await this.validateStoreAccess(taxCategory.store_id, user);
    }

    // Only update fields that exist in the schema
    const updateData: any = {};
    if (updateTaxCategoryDto.name) updateData.name = updateTaxCategoryDto.name;
    if (updateTaxCategoryDto.description !== undefined)
      updateData.description = updateTaxCategoryDto.description;
    if (updateTaxCategoryDto.store_id)
      updateData.store_id = updateTaxCategoryDto.store_id;

    return await this.prisma.tax_categories.update({
      where: { id },
      data: updateData,
      include: {
        stores: { select: { id: true, name: true } },
        _count: { select: { product_tax_assignments: true } },
      },
    });
  }

  async remove(id: number, user: any) {
    const taxCategory = await this.prisma.tax_categories.findUnique({
      where: { id },
    });

    if (!taxCategory) {
      throw new NotFoundException('Tax category not found');
    }

    // Validate access if store_id exists
    if (taxCategory.store_id) {
      await this.validateStoreAccess(taxCategory.store_id, user);
    }

    // Check if tax category is used in products
    const productCount = await this.prisma.product_tax_assignments.count({
      where: { tax_category_id: id },
    });

    if (productCount > 0) {
      throw new ForbiddenException(
        'Tax category is assigned to products and cannot be deleted',
      );
    }

    await this.prisma.tax_categories.delete({ where: { id } });
    return { message: 'Tax category deleted successfully' };
  }

  async getByStore(storeId: number, user: any) {
    await this.validateStoreAccess(storeId, user);

    return await this.prisma.tax_categories.findMany({
      where: { store_id: storeId },
      include: {
        _count: { select: { product_tax_assignments: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async calculateTax(
    taxCalculationDto: TaxCalculationDto,
  ): Promise<TaxCalculationResultDto> {
    const { subtotal, store_id, product_id } = taxCalculationDto;

    // Get applicable tax categories for the product/store
    let taxCategories: any[] = [];

    if (product_id) {
      // Get tax categories assigned to the specific product
      const productTaxAssignments =
        await this.prisma.product_tax_assignments.findMany({
          where: { product_id },
          include: {
            tax_categories: {
              include: {
                tax_rates: true,
              },
            },
          },
        });
      taxCategories = productTaxAssignments.map((pta) => pta.tax_categories);
    } else {
      // Get all tax categories for the store
      taxCategories = await this.prisma.tax_categories.findMany({
        where: { store_id },
        include: {
          tax_rates: true,
        },
      });
    }

    let totalTax = 0;
    let runningTotal = subtotal;
    const taxBreakdown: any[] = [];

    // Calculate taxes using tax_rates table
    for (const taxCategory of taxCategories) {
      // Get tax rates for this category (sorted by priority)
      const taxRates = taxCategory.tax_rates.sort(
        (a: any, b: any) => (a.priority || 0) - (b.priority || 0),
      );

      for (const taxRate of taxRates) {
        const baseAmount = taxRate.is_compound ? runningTotal : subtotal;
        const taxAmount = (baseAmount * Number(taxRate.rate)) / 100;

        totalTax += taxAmount;

        taxBreakdown.push({
          tax_category_id: taxCategory.id,
          name: taxCategory.name,
          type: 'percentage', // Simplified - all rates are percentage based
          rate: Number(taxRate.rate),
          is_inclusive: false, // Simplified
          is_compound: taxRate.is_compound || false,
          tax_amount: Number(taxAmount.toFixed(2)),
        });

        if (taxRate.is_compound) {
          runningTotal += taxAmount;
        }
      }
    }

    return {
      subtotal,
      total_tax: Number(totalTax.toFixed(2)),
      total_amount: Number((subtotal + totalTax).toFixed(2)),
      tax_breakdown: taxBreakdown,
    };
  }

  async findByStore(storeId: number, query: TaxCategoryQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'name',
      sort_order = 'asc',
    } = query;

    const skip = (page - 1) * limit;
    const where: any = { store_id: storeId };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [taxCategories, total] = await Promise.all([
      this.prisma.tax_categories.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: {
          stores: { select: { id: true, name: true } },
          _count: { select: { product_tax_assignments: true } },
        },
      }),
      this.prisma.tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
  async activate(id: number, user: any) {
    const taxCategory = await this.findOne(id, user);

    // Since tax_categories don't have a status field in the schema, we'll just return the category
    // In a real implementation, you might want to add a status field to the schema
    return taxCategory;
  }

  async deactivate(id: number, user: any) {
    const taxCategory = await this.findOne(id, user);

    // Since tax_categories don't have a status field in the schema, we'll just return the category
    // In a real implementation, you might want to add a status field to the schema
    return taxCategory;
  }

  private async validateStoreAccess(storeId: number, user: any) {
    // Check if user has access to this store
    const storeAccess = await this.prisma.store_staff.findFirst({
      where: {
        store_id: storeId,
        user_id: user.id,
        is_active: true,
      },
    });

    if (!storeAccess && user.role !== 'system_admin') {
      throw new ForbiddenException('Access denied to this store');
    }
  }
}
