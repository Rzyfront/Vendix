import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { DepreciationCalculatorService } from './depreciation-calculator.service';
import { CreateFixedAssetDto } from './dto/create-fixed-asset.dto';
import { UpdateFixedAssetDto } from './dto/update-fixed-asset.dto';
import { QueryFixedAssetsDto } from './dto/query-fixed-assets.dto';
import { DisposeAssetDto } from './dto/dispose-asset.dto';
import { RunDepreciationDto } from './dto/run-depreciation.dto';

@Injectable()
export class FixedAssetsService {
  private readonly logger = new Logger(FixedAssetsService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly calculator: DepreciationCalculatorService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryFixedAssetsDto) {
    const {
      search,
      status,
      category_id,
      page = 1,
      limit = 20,
    } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.fixed_assetsWhereInput = {
      ...(search && {
        OR: [
          { name: { contains: search, mode: 'insensitive' as const } },
          { asset_number: { contains: search, mode: 'insensitive' as const } },
          { description: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(category_id && { category_id }),
      // store_id filter dropped (phase3-round2): StorePrismaService auto-scopes.
    };

    const [data, total] = await Promise.all([
      this.prisma.fixed_assets.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        include: {
          category: {
            select: { id: true, name: true },
          },
        },
      }),
      this.prisma.fixed_assets.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const asset = await this.prisma.fixed_assets.findFirst({
      where: { id },
      include: {
        category: {
          select: { id: true, name: true },
        },
        depreciation_entries: {
          orderBy: { period_date: 'desc' },
          take: 12,
        },
      },
    });

    if (!asset) {
      throw new VendixHttpException(ErrorCodes.FIXED_ASSET_NOT_FOUND);
    }

    return asset;
  }

  async create(dto: CreateFixedAssetDto) {
    const context = this.getContext();

    // Generate asset number: FA-YYYY-NNNNNN
    const year = new Date().getFullYear();
    const prefix = `FA-${year}-`;

    const latest = await this.prisma.fixed_assets.findFirst({
      where: {
        asset_number: { startsWith: prefix },
      },
      orderBy: { asset_number: 'desc' },
    });

    let sequence = 1;
    if (latest) {
      const last_number = parseInt(latest.asset_number.replace(prefix, ''), 10);
      if (!isNaN(last_number)) {
        sequence = last_number + 1;
      }
    }
    const asset_number = `${prefix}${String(sequence).padStart(6, '0')}`;

    // Set depreciation_start_date to acquisition_date if not provided
    const depreciation_start_date = dto.depreciation_start_date
      ? new Date(dto.depreciation_start_date)
      : new Date(dto.acquisition_date);

    // Validate category if provided
    if (dto.category_id) {
      const category = await this.prisma.fixed_asset_categories.findFirst({
        where: { id: dto.category_id },
      });
      if (!category) {
        throw new VendixHttpException(
          ErrorCodes.FIXED_ASSET_CATEGORY_NOT_FOUND,
        );
      }
    }

    const asset = await this.prisma.fixed_assets.create({
      data: {
        organization_id: context.organization_id,
        store_id: dto.store_id || null,
        category_id: dto.category_id || null,
        asset_number,
        name: dto.name,
        description: dto.description || null,
        acquisition_date: new Date(dto.acquisition_date),
        acquisition_cost: new Prisma.Decimal(dto.acquisition_cost),
        salvage_value: new Prisma.Decimal(dto.salvage_value),
        useful_life_months: dto.useful_life_months,
        depreciation_method: dto.depreciation_method as any,
        depreciation_start_date,
        notes: dto.notes || null,
        created_by_user_id: context.user_id || null,
      },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    });

    return asset;
  }

  async update(id: number, dto: UpdateFixedAssetDto) {
    const asset = await this.findOne(id);

    if (asset.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.FIXED_ASSET_ALREADY_DISPOSED);
    }

    // Validate category if changing
    if (dto.category_id) {
      const category = await this.prisma.fixed_asset_categories.findFirst({
        where: { id: dto.category_id },
      });
      if (!category) {
        throw new VendixHttpException(
          ErrorCodes.FIXED_ASSET_CATEGORY_NOT_FOUND,
        );
      }
    }

    const update_data: any = {
      updated_at: new Date(),
    };

    if (dto.name !== undefined) update_data.name = dto.name;
    if (dto.description !== undefined)
      update_data.description = dto.description;
    if (dto.category_id !== undefined)
      update_data.category_id = dto.category_id;
    if (dto.acquisition_date !== undefined)
      update_data.acquisition_date = new Date(dto.acquisition_date);
    if (dto.acquisition_cost !== undefined)
      update_data.acquisition_cost = new Prisma.Decimal(dto.acquisition_cost);
    if (dto.salvage_value !== undefined)
      update_data.salvage_value = new Prisma.Decimal(dto.salvage_value);
    if (dto.useful_life_months !== undefined)
      update_data.useful_life_months = dto.useful_life_months;
    if (dto.depreciation_method !== undefined)
      update_data.depreciation_method = dto.depreciation_method as any;
    if (dto.depreciation_start_date !== undefined)
      update_data.depreciation_start_date = new Date(
        dto.depreciation_start_date,
      );
    if (dto.notes !== undefined) update_data.notes = dto.notes;
    if (dto.store_id !== undefined) update_data.store_id = dto.store_id;

    return this.prisma.fixed_assets.update({
      where: { id },
      data: update_data,
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    });
  }

  async retire(id: number) {
    const asset = await this.findOne(id);

    if (asset.status !== 'active' && asset.status !== 'fully_depreciated') {
      throw new VendixHttpException(ErrorCodes.FIXED_ASSET_ALREADY_DISPOSED);
    }

    return this.prisma.fixed_assets.update({
      where: { id },
      data: {
        status: 'retired',
        retirement_date: new Date(),
        updated_at: new Date(),
      },
    });
  }

  async dispose(id: number, dto: DisposeAssetDto) {
    const asset = await this.findOne(id);
    const context = this.getContext();

    if (asset.status === 'disposed') {
      throw new VendixHttpException(ErrorCodes.FIXED_ASSET_ALREADY_DISPOSED);
    }

    const disposal_amount = dto.disposal_amount || 0;
    const book_value =
      Number(asset.acquisition_cost) - Number(asset.accumulated_depreciation);
    const gain_loss = disposal_amount - book_value;

    const updated = await this.prisma.fixed_assets.update({
      where: { id },
      data: {
        status: 'disposed',
        disposal_date: new Date(dto.disposal_date),
        disposal_amount: new Prisma.Decimal(disposal_amount),
        updated_at: new Date(),
      },
    });

    // Emit disposal event for auto-entry
    this.event_emitter.emit('disposal.fixed_asset', {
      asset_id: id,
      asset_number: asset.asset_number,
      organization_id: asset.organization_id,
      store_id: asset.store_id,
      acquisition_cost: Number(asset.acquisition_cost),
      accumulated_depreciation: Number(asset.accumulated_depreciation),
      disposal_amount,
      book_value,
      gain_loss,
      user_id: context.user_id,
    });

    return updated;
  }

  async getDepreciationSchedule(id: number) {
    const asset = await this.findOne(id);

    return this.calculator.generateSchedule({
      acquisition_cost: Number(asset.acquisition_cost),
      salvage_value: Number(asset.salvage_value),
      useful_life_months: asset.useful_life_months,
      depreciation_method: asset.depreciation_method,
      depreciation_start_date: asset.depreciation_start_date,
      accumulated_depreciation: Number(asset.accumulated_depreciation),
    });
  }

  async getDepreciationHistory(id: number) {
    await this.findOne(id); // Validate exists

    return this.prisma.depreciation_entries.findMany({
      where: { fixed_asset_id: id },
      orderBy: { period_date: 'desc' },
    });
  }

  async runMonthlyDepreciation(dto: RunDepreciationDto) {
    const context = this.getContext();
    const { year, month } = dto;
    const period_date = new Date(year, month - 1, 1); // First day of the month

    // Find all active assets for this organization
    const active_assets = await this.prisma.fixed_assets.findMany({
      where: {
        status: 'active',
        depreciation_start_date: { lte: period_date },
      },
    });

    const results: Array<{
      asset_id: number;
      asset_number: string;
      amount: number;
    }> = [];

    for (const asset of active_assets) {
      // Check if entry already exists for this period
      const existing = await this.prisma.depreciation_entries.findFirst({
        where: {
          fixed_asset_id: asset.id,
          period_date,
        },
      });

      if (existing) {
        this.logger.warn(
          `Depreciation entry already exists for asset ${asset.asset_number} period ${year}-${month}`,
        );
        continue;
      }

      // Calculate monthly amount
      const monthly_amount = this.calculator.calculateMonthlyAmount({
        acquisition_cost: Number(asset.acquisition_cost),
        salvage_value: Number(asset.salvage_value),
        useful_life_months: asset.useful_life_months,
        depreciation_method: asset.depreciation_method,
        accumulated_depreciation: Number(asset.accumulated_depreciation),
      });

      if (monthly_amount <= 0) continue;

      const new_accumulated =
        Number(asset.accumulated_depreciation) + monthly_amount;
      const new_book_value = Number(asset.acquisition_cost) - new_accumulated;

      // Create depreciation entry and update asset in transaction
      await this.prisma.$transaction(async (tx: any) => {
        await tx.depreciation_entries.create({
          data: {
            fixed_asset_id: asset.id,
            period_date,
            depreciation_amount: new Prisma.Decimal(monthly_amount),
            accumulated_total: new Prisma.Decimal(new_accumulated),
            book_value: new Prisma.Decimal(new_book_value),
            status: 'posted',
          },
        });

        const update_data: any = {
          accumulated_depreciation: new Prisma.Decimal(new_accumulated),
          updated_at: new Date(),
        };

        // Mark as fully depreciated if book value equals salvage
        if (new_book_value <= Number(asset.salvage_value)) {
          update_data.status = 'fully_depreciated';
        }

        await tx.fixed_assets.update({
          where: { id: asset.id },
          data: update_data,
        });
      });

      // Emit event for auto accounting entry
      this.event_emitter.emit('depreciation.posted', {
        asset_id: asset.id,
        asset_number: asset.asset_number,
        organization_id: asset.organization_id,
        store_id: asset.store_id,
        amount: monthly_amount,
        period_date,
        user_id: context.user_id,
      });

      results.push({
        asset_id: asset.id,
        asset_number: asset.asset_number,
        amount: monthly_amount,
      });
    }

    this.logger.log(
      `Monthly depreciation run complete for ${year}-${month}: ${results.length} assets processed`,
    );

    return {
      period: `${year}-${String(month).padStart(2, '0')}`,
      assets_processed: results.length,
      total_depreciation: results.reduce((sum, r) => sum + r.amount, 0),
      details: results,
    };
  }

  async getAssetReport() {
    const assets = await this.prisma.fixed_assets.findMany({
      orderBy: { asset_number: 'asc' },
      include: {
        category: {
          select: { id: true, name: true },
        },
      },
    });

    return assets.map((asset) => ({
      asset_number: asset.asset_number,
      name: asset.name,
      category: asset.category?.name || null,
      acquisition_cost: Number(asset.acquisition_cost),
      accumulated_depreciation: Number(asset.accumulated_depreciation),
      book_value:
        Number(asset.acquisition_cost) - Number(asset.accumulated_depreciation),
      status: asset.status,
    }));
  }
}
