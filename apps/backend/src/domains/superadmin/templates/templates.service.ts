import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import { CreateTemplateDto, UpdateTemplateDto, TemplateQueryDto } from './dto';
import { Prisma, template_config_type_enum } from '@prisma/client';
import { DefaultPanelUIService } from '../../../common/services/default-panel-ui.service';

@Injectable()
export class TemplatesService {
  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly defaultPanelUIService: DefaultPanelUIService,
  ) {}

  async create(createTemplateDto: CreateTemplateDto) {
    // Check if template_name already exists
    const existingTemplate = await this.prisma.default_templates.findUnique({
      where: { template_name: createTemplateDto.template_name },
    });

    if (existingTemplate) {
      throw new ConflictException(
        `Template with name '${createTemplateDto.template_name}' already exists`,
      );
    }

    // Validate JSON structure for template_data
    this.validateTemplateData(
      createTemplateDto.configuration_type,
      createTemplateDto.template_data,
    );

    return this.prisma.default_templates.create({
      data: {
        ...createTemplateDto,
        template_data: createTemplateDto.template_data as any,
        updated_at: new Date(),
      },
    });
  }

  async findAll(query: TemplateQueryDto) {
    const {
      page = 1,
      limit = 10,
      search,
      configuration_type,
      is_active,
      is_system,
      sort_by = 'created_at',
      sort_order = 'desc',
    } = query;

    const skip = (page - 1) * Number(limit);

    const where: Prisma.default_templatesWhereInput = {};

    if (search) {
      where.OR = [
        { template_name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (configuration_type) {
      where.configuration_type = configuration_type;
    }

    if (is_active !== undefined) {
      where.is_active = is_active;
    }

    if (is_system !== undefined) {
      where.is_system = is_system;
    }

    const [data, total] = await Promise.all([
      this.prisma.default_templates.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { [sort_by]: sort_order },
      }),
      this.prisma.default_templates.count({ where }),
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
    const template = await this.prisma.default_templates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException('Template not found');
    }

    return template;
  }

  async update(id: number, updateTemplateDto: UpdateTemplateDto) {
    const existingTemplate = await this.prisma.default_templates.findUnique({
      where: { id },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Template not found');
    }

    // Check if template_name is being changed and if it conflicts
    if ((updateTemplateDto as any).template_name &&
        (updateTemplateDto as any).template_name !== existingTemplate.template_name) {
      const nameConflict = await this.prisma.default_templates.findUnique({
        where: { template_name: (updateTemplateDto as any).template_name },
      });

      if (nameConflict) {
        throw new ConflictException(
          `Template with name '${(updateTemplateDto as any).template_name}' already exists`,
        );
      }
    }

    // Validate template_data if provided
    if ((updateTemplateDto as any).template_data) {
      this.validateTemplateData(
        (updateTemplateDto as any).configuration_type || existingTemplate.configuration_type,
        (updateTemplateDto as any).template_data,
      );
    }

    // Update template
    const updatedTemplate = await this.prisma.default_templates.update({
      where: { id },
      data: {
        ...updateTemplateDto,
        template_data: (updateTemplateDto as any).template_data as any,
        updated_at: new Date(),
      },
    });

    // Invalidate DefaultPanelUIService cache if user_settings template was updated
    if (existingTemplate.configuration_type === 'user_settings') {
      this.defaultPanelUIService.invalidateCache();
    }

    return updatedTemplate;
  }

  async remove(id: number) {
    const existingTemplate = await this.prisma.default_templates.findUnique({
      where: { id },
    });

    if (!existingTemplate) {
      throw new NotFoundException('Template not found');
    }

    return this.prisma.default_templates.delete({
      where: { id },
    });
  }

  async getDashboardStats() {
    const [
      totalTemplates,
      activeTemplates,
      systemTemplates,
      customTemplates,
      templatesByType,
      recentTemplates,
    ] = await Promise.all([
      this.prisma.default_templates.count(),
      this.prisma.default_templates.count({ where: { is_active: true } }),
      this.prisma.default_templates.count({ where: { is_system: true } }),
      this.prisma.default_templates.count({ where: { is_system: false } }),
      this.prisma.default_templates.groupBy({
        by: ['configuration_type'],
        _count: true,
      }),
      this.prisma.default_templates.findMany({
        take: 5,
        orderBy: { created_at: 'desc' },
        select: {
          id: true,
          template_name: true,
          configuration_type: true,
          created_at: true,
        },
      }),
    ]);

    return {
      totalTemplates,
      activeTemplates,
      systemTemplates,
      customTemplates,
      templatesByType: templatesByType.reduce(
        (acc: Record<string, number>, item: any) => {
          acc[item.configuration_type] = item._count;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentTemplates,
    };
  }

  private validateTemplateData(
    configurationType: template_config_type_enum,
    templateData: Record<string, any>,
  ): void {
    // Basic JSON validation
    if (!templateData || typeof templateData !== 'object') {
      throw new BadRequestException('template_data must be a valid JSON object');
    }

    // Type-specific validation can be added here
    // For now, we'll do basic structure validation
    try {
      JSON.stringify(templateData);
    } catch (error) {
      throw new BadRequestException('template_data contains invalid JSON');
    }
  }
}
