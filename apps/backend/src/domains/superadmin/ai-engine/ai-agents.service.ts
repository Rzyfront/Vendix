import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { AIToolRegistry } from '../../../ai-engine/tools/ai-tool-registry';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import {
  CreateAIAgentDto,
  UpdateAIAgentDto,
  AIAgentQueryDto,
} from './dto';

/**
 * CRUD super-admin del catálogo configurable de agentes (F4).
 *
 * Replica el patrón de `AIEngineAppsService`: mismo guard/permiso en el
 * controller (`SUPER_ADMIN`), unicidad de `key`, paginación cruda para
 * `ResponseService.paginated()`.
 *
 * Decisiones de validación:
 * - `key` slug kebab-case único (el DTO impone el formato; acá la unicidad).
 * - `app_key` debe existir en `ai_engine_applications` (`AI_APP_001` si no):
 *   es una referencia a una app, y ese código ya dice exactamente eso.
 * - `allowed_tools` solo tiene validación BLANDA contra el catálogo vivo del
 *   registry: los nombres desconocidos se aceptan y se registran en warn. El
 *   catálogo vive en memoria y cambia con cada deploy/registro de dominio;
 *   rechazarlos acoplaría el admin al boot del backend.
 * - Los errores propios del agente (no encontrado, key duplicada) usan
 *   excepciones Nest planas: el catálogo `ErrorCodes` no tiene códigos de
 *   agente y ese archivo está fuera del scope F4.
 */
@Injectable()
export class AIAgentsService {
  private readonly logger = new Logger(AIAgentsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly toolRegistry: AIToolRegistry,
  ) {}

  async create(dto: CreateAIAgentDto) {
    const existing = await this.prisma.ai_agents.findUnique({
      where: { key: dto.key },
    });

    if (existing) {
      throw new ConflictException(
        `AI agent key '${dto.key}' already exists`,
      );
    }

    await this.assertAppExists(dto.app_key);
    this.warnUnknownTools(dto.key, dto.allowed_tools);

    return this.prisma.ai_agents.create({
      data: {
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        app_key: dto.app_key ?? null,
        system_prompt: dto.system_prompt ?? null,
        allowed_tools: dto.allowed_tools ?? [],
        max_iterations: dto.max_iterations ?? null,
        requires_confirmation_default:
          dto.requires_confirmation_default ?? false,
        is_active: dto.is_active ?? true,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: AIAgentQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      app_key,
      is_active,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);
    const where: Prisma.ai_agentsWhereInput = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { key: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (app_key) {
      where.app_key = app_key;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    const [data, total] = await Promise.all([
      this.prisma.ai_agents.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.ai_agents.count({ where }),
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
    const agent = await this.prisma.ai_agents.findUnique({
      where: { id },
    });

    if (!agent) {
      throw new NotFoundException('AI agent not found');
    }

    return agent;
  }

  async findByKey(key: string) {
    return this.prisma.ai_agents.findUnique({ where: { key } });
  }

  async update(id: number, dto: UpdateAIAgentDto) {
    const existing = await this.prisma.ai_agents.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('AI agent not found');
    }

    if (dto.key && dto.key !== existing.key) {
      const conflict = await this.prisma.ai_agents.findUnique({
        where: { key: dto.key },
      });
      if (conflict) {
        throw new ConflictException(
          `AI agent key '${dto.key}' already exists`,
        );
      }
    }

    if (dto.app_key !== undefined) {
      await this.assertAppExists(dto.app_key);
    }
    this.warnUnknownTools(dto.key ?? existing.key, dto.allowed_tools);

    // Spread directo: las props ausentes llegan `undefined` y Prisma las deja
    // intactas; un `null` explícito limpia la columna (desanclar `app_key` o
    // `system_prompt` es una acción legítima del operador).
    return this.prisma.ai_agents.update({
      where: { id },
      data: {
        ...dto,
        updated_at: new Date(),
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.ai_agents.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('AI agent not found');
    }

    await this.prisma.ai_agents.delete({ where: { id } });
  }

  private async assertAppExists(
    appKey: string | null | undefined,
  ): Promise<void> {
    if (!appKey) return;
    const app = await this.prisma.ai_engine_applications.findUnique({
      where: { key: appKey },
      select: { id: true },
    });
    if (!app) {
      throw new VendixHttpException(ErrorCodes.AI_APP_001);
    }
  }

  private warnUnknownTools(
    agentKey: string,
    allowedTools: string[] | undefined,
  ): void {
    if (!allowedTools?.length) return;
    const unknown = allowedTools.filter(
      (name) => !this.toolRegistry.get(this.toolRegistry.canonicalName(name)),
    );
    if (unknown.length) {
      this.logger.warn(
        `AI agent '${agentKey}' references unknown tools (soft validation, accepted): ${unknown.join(', ')}`,
      );
    }
  }
}
