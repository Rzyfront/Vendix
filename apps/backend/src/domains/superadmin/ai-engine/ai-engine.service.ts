import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateAIConfigDto, UpdateAIConfigDto, AIConfigQueryDto } from './dto';

@Injectable()
export class AIEngineConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
  ) {}

  async create(dto: CreateAIConfigDto) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: {
        provider_model_id: {
          provider: dto.provider,
          model_id: dto.model_id,
        },
      },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_002);
    }

    // If setting as default, unset previous default
    if (dto.is_default) {
      await this.prisma.ai_engine_configs.updateMany({
        where: { is_default: true },
        data: { is_default: false },
      });
    }

    const config = await this.prisma.ai_engine_configs.create({
      data: {
        provider: dto.provider,
        sdk_type: dto.sdk_type,
        label: dto.label,
        model_id: dto.model_id,
        base_url: dto.base_url || null,
        api_key_ref: dto.api_key_ref || null,
        is_default: dto.is_default || false,
        is_active: dto.is_active ?? true,
        settings: dto.settings as any,
        updated_at: new Date(),
      },
    });

    await this.aiEngine.reloadConfigurations();
    return this.maskApiKey(config);
  }

  async findAll(query: AIConfigQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sdk_type,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.ai_engine_configsWhereInput = {};

    if (search) {
      where.OR = [
        { label: { contains: search, mode: 'insensitive' } },
        { provider: { contains: search, mode: 'insensitive' } },
        { model_id: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (sdk_type) {
      where.sdk_type = sdk_type;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_engine_configs.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.ai_engine_configs.count({ where }),
    ]);

    return {
      data: data.map((c) => this.maskApiKey(c)),
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const config = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!config) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    return this.maskApiKey(config);
  }

  async update(id: number, dto: UpdateAIConfigDto) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    // Check for duplicate provider+model_id
    if (
      (dto.provider || dto.model_id) &&
      (dto.provider !== existing.provider ||
        dto.model_id !== existing.model_id)
    ) {
      const conflict = await this.prisma.ai_engine_configs.findUnique({
        where: {
          provider_model_id: {
            provider: dto.provider || existing.provider,
            model_id: dto.model_id || existing.model_id,
          },
        },
      });
      if (conflict && conflict.id !== id) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_002);
      }
    }

    // If setting as default, unset previous default
    if (dto.is_default) {
      await this.prisma.ai_engine_configs.updateMany({
        where: { is_default: true, id: { not: id } },
        data: { is_default: false },
      });
    }

    const updated = await this.prisma.ai_engine_configs.update({
      where: { id },
      data: {
        ...dto,
        settings: dto.settings as any,
        updated_at: new Date(),
      },
    });

    await this.aiEngine.reloadConfigurations();
    return this.maskApiKey(updated);
  }

  async remove(id: number) {
    const existing = await this.prisma.ai_engine_configs.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
    }

    await this.prisma.ai_engine_configs.delete({ where: { id } });
    await this.aiEngine.reloadConfigurations();
  }

  async getDashboardStats() {
    const [
      totalConfigs,
      activeConfigs,
      inactiveConfigs,
      configsBySdkType,
      configsByProvider,
      defaultConfig,
    ] = await Promise.all([
      this.prisma.ai_engine_configs.count(),
      this.prisma.ai_engine_configs.count({ where: { is_active: true } }),
      this.prisma.ai_engine_configs.count({ where: { is_active: false } }),
      this.prisma.ai_engine_configs.groupBy({
        by: ['sdk_type'],
        _count: true,
      }),
      this.prisma.ai_engine_configs.groupBy({
        by: ['provider'],
        _count: true,
      }),
      this.prisma.ai_engine_configs.findFirst({
        where: { is_default: true },
        select: { id: true, label: true, provider: true, model_id: true },
      }),
    ]);

    return {
      totalConfigs,
      activeConfigs,
      inactiveConfigs,
      configsBySdkType: configsBySdkType.reduce(
        (acc, item) => {
          acc[item.sdk_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      configsByProvider: configsByProvider.reduce(
        (acc, item) => {
          acc[item.provider] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      defaultConfig,
    };
  }

  async testConnection(id: number) {
    return this.aiEngine.testProvider(id);
  }

  private maskApiKey(config: any): any {
    if (!config.api_key_ref) return config;
    const masked =
      config.api_key_ref.length > 4
        ? '****' + config.api_key_ref.slice(-4)
        : '****';
    return { ...config, api_key_ref: masked };
  }
}
