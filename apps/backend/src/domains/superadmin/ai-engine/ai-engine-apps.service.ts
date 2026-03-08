import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIEngineService } from '../../../ai-engine/ai-engine.service';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateAIAppDto, UpdateAIAppDto, AIAppQueryDto } from './dto';

@Injectable()
export class AIEngineAppsService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly aiEngine: AIEngineService,
  ) {}

  async create(dto: CreateAIAppDto) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_002);
    }

    // Validate config_id exists if provided
    if (dto.config_id) {
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: dto.config_id },
      });
      if (!config) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
      }
    }

    return this.prisma.ai_engine_applications.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description,
        config_id: dto.config_id || null,
        system_prompt: dto.system_prompt,
        prompt_template: dto.prompt_template,
        temperature: dto.temperature,
        max_tokens: dto.max_tokens,
        output_format: dto.output_format || 'text',
        rate_limit: dto.rate_limit as any,
        retry_config: dto.retry_config as any,
        is_active: dto.is_active ?? true,
        metadata: dto.metadata as any,
        updated_at: new Date(),
      },
      include: {
        config: {
          select: { id: true, label: true, provider: true, model_id: true },
        },
      },
    });
  }

  async findAll(query: AIAppQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      output_format,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.ai_engine_applicationsWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (output_format) {
      where.output_format = output_format;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_engine_applications.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
        include: {
          config: {
            select: { id: true, label: true, provider: true, model_id: true },
          },
        },
      }),
      this.prisma.ai_engine_applications.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    };
  }

  async findOne(id: number) {
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
      include: {
        config: {
          select: { id: true, label: true, provider: true, model_id: true },
        },
      },
    });

    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    return app;
  }

  async update(id: number, dto: UpdateAIAppDto) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    // Check key uniqueness if changing
    if (dto.key && dto.key !== existing.key) {
      const conflict = await this.prisma.ai_engine_applications.findUnique({
        where: { key: dto.key },
      });
      if (conflict) {
        throw new VendixHttpException(ErrorCodes.AI_APP_002);
      }
    }

    // Validate config_id if provided
    if (dto.config_id) {
      const config = await this.prisma.ai_engine_configs.findUnique({
        where: { id: dto.config_id },
      });
      if (!config) {
        throw new VendixHttpException(ErrorCodes.AI_CONFIG_001);
      }
    }

    return this.prisma.ai_engine_applications.update({
      where: { id },
      data: {
        ...dto,
        temperature: dto.temperature,
        rate_limit: dto.rate_limit as any,
        retry_config: dto.retry_config as any,
        metadata: dto.metadata as any,
        updated_at: new Date(),
      },
      include: {
        config: {
          select: { id: true, label: true, provider: true, model_id: true },
        },
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.ai_engine_applications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }

    await this.prisma.ai_engine_applications.delete({ where: { id } });
  }

  async testApplication(id: number) {
    const app = await this.findOne(id);

    // Build a minimal test using the app's template
    const testVars: Record<string, string> = { name: 'Test', context: 'Testing' };

    const response = await this.aiEngine.run(app.key, testVars);
    return {
      success: response.success,
      content: response.content,
      usage: response.usage,
      error: response.error,
    };
  }

  async getDashboardStats() {
    const [totalApps, activeApps, appsByFormat, appsByConfig] =
      await Promise.all([
        this.prisma.ai_engine_applications.count(),
        this.prisma.ai_engine_applications.count({
          where: { is_active: true },
        }),
        this.prisma.ai_engine_applications.groupBy({
          by: ['output_format'],
          _count: true,
        }),
        this.prisma.ai_engine_applications.groupBy({
          by: ['config_id'],
          _count: true,
        }),
      ]);

    return {
      totalApps,
      activeApps,
      inactiveApps: totalApps - activeApps,
      appsByFormat: appsByFormat.reduce(
        (acc, item) => {
          acc[item.output_format] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      usingDefaultConfig: appsByConfig.find((c) => c.config_id === null)?._count || 0,
      usingCustomConfig: appsByConfig.filter((c) => c.config_id !== null)
        .reduce((sum, c) => sum + c._count, 0),
    };
  }
}
