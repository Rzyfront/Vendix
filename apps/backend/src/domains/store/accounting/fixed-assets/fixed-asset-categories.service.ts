import { Injectable, ConflictException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateFixedAssetCategoryDto } from './dto/create-category.dto';
import { UpdateFixedAssetCategoryDto } from './dto/update-category.dto';

@Injectable()
export class FixedAssetCategoriesService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll() {
    return this.prisma.fixed_asset_categories.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { fixed_assets: true },
        },
      },
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.fixed_asset_categories.findFirst({
      where: { id },
      include: {
        _count: {
          select: { fixed_assets: true },
        },
      },
    });

    if (!category) {
      throw new VendixHttpException(ErrorCodes.FIXED_ASSET_CATEGORY_NOT_FOUND);
    }

    return category;
  }

  async create(dto: CreateFixedAssetCategoryDto) {
    const context = this.getContext();

    return this.prisma.fixed_asset_categories.create({
      data: {
        organization_id: context.organization_id,
        name: dto.name,
        default_useful_life_months: dto.default_useful_life_months ?? 60,
        default_depreciation_method: (dto.default_depreciation_method as any) ?? 'straight_line',
        default_salvage_percentage: dto.default_salvage_percentage ?? 0,
        depreciation_account_code: dto.depreciation_account_code || null,
        expense_account_code: dto.expense_account_code || null,
      },
    });
  }

  async update(id: number, dto: UpdateFixedAssetCategoryDto) {
    await this.findOne(id);

    return this.prisma.fixed_asset_categories.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.default_depreciation_method && {
          default_depreciation_method: dto.default_depreciation_method as any,
        }),
        updated_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const category = await this.findOne(id);

    // Validate no active assets
    const active_assets_count = await this.prisma.fixed_assets.count({
      where: {
        category_id: id,
        status: 'active',
      },
    });

    if (active_assets_count > 0) {
      throw new ConflictException(
        'Cannot delete category with active fixed assets',
      );
    }

    await this.prisma.fixed_asset_categories.delete({
      where: { id },
    });
  }
}
