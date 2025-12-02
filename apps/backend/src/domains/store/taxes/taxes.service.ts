import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { AccessValidationService } from '@common/services/access-validation.service';
import {
  CreateTaxCategoryDto,
  UpdateTaxCategoryDto,
  TaxCategoryQueryDto,
} from './dto';

@Injectable()
export class TaxesService {
  constructor(
    private prisma: StorePrismaService,
    private accessValidation: AccessValidationService,
  ) {}

  async create(createTaxCategoryDto: CreateTaxCategoryDto, user: any) {
    if (createTaxCategoryDto.store_id) {
      await this.accessValidation.validateStoreAccess(
        createTaxCategoryDto.store_id,
        user,
      );
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
    const { page = 1, limit = 10, search } = query;
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search)
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];

    // ✅ BYPASS MANUAL ELIMINADO - ahora usa scoping automático de PrismaService
    // El filtro store_id se aplica automáticamente según el contexto del usuario
    // Los usuarios solo pueden ver tax_categories de su store actual

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
      await this.accessValidation.validateStoreAccess(
        taxCategory.store_id,
        user,
      );
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
