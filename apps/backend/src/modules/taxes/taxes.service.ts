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
} from './dto';

@Injectable()
export class TaxesService {
  constructor(private prisma: PrismaService) {}

  async create(createTaxCategoryDto: CreateTaxCategoryDto, user: any) {
    if (createTaxCategoryDto.store_id) {
      await this.validateStoreAccess(createTaxCategoryDto.store_id, user);
    }

    return this.prisma.tax_categories.create({
      data: {
        name: createTaxCategoryDto.name,
        description: createTaxCategoryDto.description,
        store_id: createTaxCategoryDto.store_id,
      },
    });
  }

  async findAll(query: TaxCategoryQueryDto) {
    const { page = 1, limit = 10, search, store_id } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search)
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
    if (store_id) where.store_id = store_id;

    const [taxCategories, total] = await Promise.all([
      this.prisma.tax_categories.findMany({ where, skip, take: limit }),
      this.prisma.tax_categories.count({ where }),
    ]);

    return {
      data: taxCategories,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async findOne(id: number, user: any) {
    const taxCategory = await this.prisma.tax_categories.findUnique({
      where: { id },
    });
    if (!taxCategory) throw new NotFoundException('Tax category not found');
    if (taxCategory.store_id)
      await this.validateStoreAccess(taxCategory.store_id, user);
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

  private async validateStoreAccess(storeId: number, user: any) {
    const store = await this.prisma.stores.findUnique({
      where: { id: storeId },
    });
    if (!store) throw new NotFoundException('Store not found');
    if (
      store.organization_id !== user.organizationId &&
      user.role !== 'super_admin'
    ) {
      throw new ForbiddenException('Access denied to this store');
    }
  }
}
