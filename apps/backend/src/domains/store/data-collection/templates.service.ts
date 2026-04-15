import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { CreateTemplateDto, CreateTemplateSectionDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  private readonly TEMPLATE_INCLUDE = {
    tabs: {
      include: {
        sections: {
          include: {
            items: {
              include: { metadata_field: true },
              orderBy: { sort_order: 'asc' as const },
            },
            child_sections: {
              include: {
                items: {
                  include: { metadata_field: true },
                  orderBy: { sort_order: 'asc' as const },
                },
              },
              orderBy: { sort_order: 'asc' as const },
            },
          },
          where: { parent_section_id: null },
          orderBy: { sort_order: 'asc' as const },
        },
      },
      orderBy: { sort_order: 'asc' as const },
    },
    sections: {
      include: {
        items: {
          include: { metadata_field: true },
          orderBy: { sort_order: 'asc' as const },
        },
        child_sections: {
          include: {
            items: {
              include: { metadata_field: true },
              orderBy: { sort_order: 'asc' as const },
            },
          },
          orderBy: { sort_order: 'asc' as const },
        },
      },
      where: { tab_id: null, parent_section_id: null },
      orderBy: { sort_order: 'asc' as const },
    },
    products: { include: { product: { select: { id: true, name: true, slug: true } } } },
  };

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createTemplate(dto: CreateTemplateDto) {
    const template = await this.prisma.data_collection_templates.create({
      data: {
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        status: (dto.status as any) ?? 'active',
        entity_type: (dto.entity_type as any) ?? 'booking',
        is_default: dto.is_default ?? false,
      },
    });

    // Create tabs with their sections
    if (dto.tabs?.length) {
      for (let tIdx = 0; tIdx < dto.tabs.length; tIdx++) {
        const tabDto = dto.tabs[tIdx];
        const tab = await this.prisma.data_collection_tabs.create({
          data: {
            template_id: template.id,
            title: tabDto.title,
            icon: tabDto.icon,
            sort_order: tabDto.sort_order ?? tIdx,
          },
        });

        if (tabDto.sections?.length) {
          await this.createSections(template.id, tab.id, tabDto.sections);
        }
      }
    }

    // Create standalone sections (no tab)
    if (dto.sections?.length) {
      await this.createSections(template.id, null, dto.sections);
    }

    this.logger.log(`Created template: ${template.name} (id=${template.id})`);
    return this.findOne(template.id);
  }

  async updateTemplate(templateId: number, dto: UpdateTemplateDto) {
    const existing = await this.prisma.data_collection_templates.findUnique({ where: { id: templateId } });
    if (!existing) throw new VendixHttpException(ErrorCodes.DCOL_FIND_001);

    // If tabs or sections are provided, delete existing structure and recreate
    if (dto.tabs !== undefined || dto.sections !== undefined) {
      // Delete tabs (cascades to tab-linked sections → items)
      await this.prisma.data_collection_tabs.deleteMany({ where: { template_id: templateId } });
      // Delete remaining standalone sections (no tab)
      await this.prisma.data_collection_sections.deleteMany({ where: { template_id: templateId } });
    }

    await this.prisma.data_collection_templates.update({
      where: { id: templateId },
      data: {
        name: dto.name,
        description: dto.description,
        icon: dto.icon,
        status: dto.status as any,
        entity_type: dto.entity_type as any,
        is_default: dto.is_default,
        updated_at: new Date(),
      },
    });

    // Recreate tabs
    if (dto.tabs?.length) {
      for (let tIdx = 0; tIdx < dto.tabs.length; tIdx++) {
        const tabDto = dto.tabs[tIdx];
        const tab = await this.prisma.data_collection_tabs.create({
          data: {
            template_id: templateId,
            title: tabDto.title,
            icon: tabDto.icon,
            sort_order: tabDto.sort_order ?? tIdx,
          },
        });

        if (tabDto.sections?.length) {
          await this.createSections(templateId, tab.id, tabDto.sections);
        }
      }
    }

    // Recreate standalone sections
    if (dto.sections?.length) {
      await this.createSections(templateId, null, dto.sections);
    }

    return this.findOne(templateId);
  }

  async findAll(status?: string) {
    const where: any = {};
    if (status) where.status = status;

    return this.prisma.data_collection_templates.findMany({
      where,
      include: this.TEMPLATE_INCLUDE,
      orderBy: { created_at: 'desc' },
    });
  }

  async findOne(templateId: number) {
    const template = await this.prisma.data_collection_templates.findUnique({
      where: { id: templateId },
      include: this.TEMPLATE_INCLUDE,
    });
    if (!template) throw new VendixHttpException(ErrorCodes.DCOL_FIND_001);
    return template;
  }

  async getTemplateForProduct(productId: number) {
    const productTemplate = await this.prisma.data_collection_template_products.findFirst({
      where: { product_id: productId },
      include: { template: { include: this.TEMPLATE_INCLUDE } },
    });

    if (productTemplate) return productTemplate.template;

    const defaultTemplate = await this.prisma.data_collection_templates.findFirst({
      where: { is_default: true, status: 'active' },
      include: this.TEMPLATE_INCLUDE,
    });

    return defaultTemplate;
  }

  async duplicateTemplate(templateId: number) {
    const source = await this.findOne(templateId);

    return this.createTemplate({
      name: `${source.name} (copia)`,
      description: source.description,
      icon: (source as any).icon,
      entity_type: source.entity_type,
      tabs: (source as any).tabs?.map((t: any, tIdx: number) => ({
        title: t.title,
        icon: t.icon,
        sort_order: t.sort_order ?? tIdx,
        sections: t.sections?.map((s: any, sIdx: number) => this.mapSectionForDuplicate(s, sIdx)),
      })),
      sections: source.sections.map((s: any, sIdx: number) => this.mapSectionForDuplicate(s, sIdx)),
    });
  }

  async assignProducts(templateId: number, productIds: number[]) {
    const existing = await this.prisma.data_collection_templates.findUnique({ where: { id: templateId } });
    if (!existing) throw new VendixHttpException(ErrorCodes.DCOL_FIND_001);

    await this.prisma.data_collection_template_products.deleteMany({
      where: { template_id: templateId },
    });

    if (productIds.length > 0) {
      await this.prisma.data_collection_template_products.createMany({
        data: productIds.map(productId => ({
          template_id: templateId,
          product_id: productId,
        })),
      });
    }

    return this.findOne(templateId);
  }

  // --- Private helpers ---

  private async createSections(
    templateId: number,
    tabId: number | null,
    sections: CreateTemplateSectionDto[],
  ) {
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sectionDto = sections[sIdx];
      const section = await this.prisma.data_collection_sections.create({
        data: {
          template_id: templateId,
          tab_id: tabId,
          title: sectionDto.title,
          description: sectionDto.description,
          icon: sectionDto.icon,
          sort_order: sectionDto.sort_order ?? sIdx,
        },
      });

      // Create items for this section
      if (sectionDto.items?.length) {
        await this.prisma.data_collection_items.createMany({
          data: sectionDto.items.map((item, iIdx) => ({
            section_id: section.id,
            metadata_field_id: item.metadata_field_id,
            sort_order: item.sort_order ?? iIdx,
            is_required: item.is_required ?? false,
            include_in_summary: item.include_in_summary ?? false,
            help_text: item.help_text,
            placeholder: item.placeholder,
            validation_rules: item.validation_rules ?? undefined,
            width: item.width,
            icon: item.icon,
          })),
        });
      }

      // Create child sections (1 level of nesting)
      if (sectionDto.child_sections?.length) {
        for (let cIdx = 0; cIdx < sectionDto.child_sections.length; cIdx++) {
          const childDto = sectionDto.child_sections[cIdx];
          const childSection = await this.prisma.data_collection_sections.create({
            data: {
              template_id: templateId,
              tab_id: tabId,
              parent_section_id: section.id,
              title: childDto.title,
              description: childDto.description,
              icon: childDto.icon,
              sort_order: childDto.sort_order ?? cIdx,
            },
          });

          if (childDto.items?.length) {
            await this.prisma.data_collection_items.createMany({
              data: childDto.items.map((item, iIdx) => ({
                section_id: childSection.id,
                metadata_field_id: item.metadata_field_id,
                sort_order: item.sort_order ?? iIdx,
                is_required: item.is_required ?? false,
                include_in_summary: item.include_in_summary ?? false,
                help_text: item.help_text,
                placeholder: item.placeholder,
                validation_rules: item.validation_rules ?? undefined,
                width: item.width,
            icon: item.icon,
              })),
            });
          }
        }
      }
    }
  }

  private mapSectionForDuplicate(s: any, idx: number) {
    return {
      title: s.title,
      description: s.description,
      icon: s.icon,
      sort_order: s.sort_order ?? idx,
      items: s.items?.map((i: any) => ({
        metadata_field_id: i.metadata_field_id,
        sort_order: i.sort_order,
        is_required: i.is_required,
        include_in_summary: i.include_in_summary,
        help_text: i.help_text,
        placeholder: i.placeholder,
        validation_rules: i.validation_rules,
        width: i.width,
        icon: i.icon,
      })),
      child_sections: s.child_sections?.map((cs: any, cIdx: number) => ({
        title: cs.title,
        description: cs.description,
        icon: cs.icon,
        sort_order: cs.sort_order ?? cIdx,
        items: cs.items?.map((i: any) => ({
          metadata_field_id: i.metadata_field_id,
          sort_order: i.sort_order,
          is_required: i.is_required,
          include_in_summary: i.include_in_summary,
          help_text: i.help_text,
          placeholder: i.placeholder,
          validation_rules: i.validation_rules,
          width: i.width,
        icon: i.icon,
        })),
      })),
    };
  }
}
