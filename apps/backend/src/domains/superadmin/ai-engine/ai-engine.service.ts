import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { AILoggingService } from '../../../ai-engine/ai-logging.service';
import { AIUsageStatsFilter } from '../../../ai-engine/interfaces/ai-log.interface';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateAIConfigDto, UpdateAIConfigDto, AIConfigQueryDto } from './dto';

/**
 * Model types that cannot be the platform-wide default configuration.
 *
 * A blacklist rather than a special case for `audio`: `defaultConfigId` is a
 * single value shared by every application whose `config_id` is NULL, and the
 * overwhelming majority of those applications need a text model. Any non-text
 * type in that slot breaks them. Listing the types that must never hold it
 * keeps a new `model_type` from silently becoming eligible.
 */
const NON_DEFAULTABLE_MODEL_TYPES = new Set([
  'audio',
  'speech',
  'transcription',
  'video',
  'rerank',
  'embedding',
]);

@Injectable()
export class AIEngineConfigService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
    private readonly aiLoggingService: AILoggingService,
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

    this.assertDefaultAllowed(dto.model_type, dto.is_default);

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
        base_url: this.cleanBaseUrl(dto.base_url) || null,
        api_key_ref: dto.api_key_ref || null,
        is_default: dto.is_default || false,
        is_active: dto.is_active ?? true,
        ...(dto.model_type !== undefined ? { model_type: dto.model_type } : {}),
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
      model_type,
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

    if (model_type) {
      where.model_type = model_type;
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
      (dto.provider !== existing.provider || dto.model_id !== existing.model_id)
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

    // Resolved against the persisted row, not just the payload: the likeliest
    // way to hit this is `PATCH {"is_default": true}` on a config that is
    // already audio, where the DTO carries no `model_type` at all.
    this.assertDefaultAllowed(
      dto.model_type ?? existing.model_type,
      dto.is_default ?? existing.is_default,
    );

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
        base_url:
          dto.base_url !== undefined
            ? this.cleanBaseUrl(dto.base_url) || null
            : undefined,
        model_type: dto.model_type !== undefined ? dto.model_type : undefined,
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

  async getUsageStats(filter: AIUsageStatsFilter) {
    return this.aiLoggingService.getUsageStats(filter);
  }

  async getUsageByTenant(orgId: number, dateFrom?: Date, dateTo?: Date) {
    return this.aiLoggingService.getUsageByTenant(orgId, dateFrom, dateTo);
  }

  private maskApiKey(config: any): any {
    if (!config.api_key_ref) return config;
    const masked =
      config.api_key_ref.length > 4
        ? '****' + config.api_key_ref.slice(-4)
        : '****';
    return { ...config, api_key_ref: masked };
  }

  private cleanBaseUrl(baseUrl?: string | null): string | undefined {
    if (!baseUrl) return undefined;

    return baseUrl.trim() || undefined;
  }

  /**
   * Only a text configuration may be the global default.
   *
   * `AIEngineService.loadConfigurations()` keeps a single `defaultConfigId`
   * without discriminating by `model_type`, and every application resolves as
   * `app.config_id || defaultConfigId`. Most seeded applications ship with
   * `config_id = null`, so making a non-text config the default silently
   * redirects every text and vision application to a provider that cannot
   * serve them.
   *
   * Enforced at the edge instead of relying on operator discipline, because the
   * failure is remote from its cause: the config saves fine and unrelated
   * applications break later.
   */
  private assertDefaultAllowed(
    modelType: string | null | undefined,
    isDefault: boolean | null | undefined,
  ): void {
    if (isDefault === true && NON_DEFAULTABLE_MODEL_TYPES.has(modelType ?? '')) {
      throw new VendixHttpException(ErrorCodes.AI_CONFIG_003);
    }
  }
}
