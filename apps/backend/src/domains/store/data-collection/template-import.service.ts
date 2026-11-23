import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../common/errors';
import { TemplatesService } from './templates.service';
import {
  CreateTemplateDto,
  CreateTemplateItemDto,
  CreateTemplateSectionDto,
} from './dto/create-template.dto';
import {
  TemplateJson,
  TemplateJsonError,
  TemplateJsonItem,
  TemplateJsonSection,
  resolveDocumentConfig,
  validateTemplateJson,
} from './template-json/template-json.contract';

export interface ImportFieldPlan {
  key: string;
  entity_type: string;
  type: string;
  status: 'new' | 'reuse';
}

interface ResolvedField extends ImportFieldPlan {
  id?: number;
  label: string;
  description?: string;
  options?: string[];
}

interface ExistingField {
  id: number;
  entity_type: string;
  field_key: string;
  field_type: string;
  is_active: boolean;
}

const fieldRef = (entityType: string, key: string) => `${entityType}:${key}`;

/**
 * Imports a template from the portable JSON contract
 * (`vendix.data-collection-template/v1`). Fields are resolved by
 * (store, entity_type, field_key); the template is always created as an
 * inactive draft for the admin to review.
 */
@Injectable()
export class TemplateImportService {
  private readonly logger = new Logger(TemplateImportService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly templates: TemplatesService,
  ) {}

  async import(body: unknown, dryRun = false) {
    const parsed = validateTemplateJson(body);
    if (!parsed.ok) this.throwErrors(parsed.errors);
    const json = (parsed as { ok: true; value: TemplateJson }).value;

    const { fields, errors } = await this.resolveFields(json);
    if (errors.length) this.throwErrors(errors);

    const plan = [...fields.values()];
    if (dryRun) {
      return {
        valid: true,
        fields: plan.map(({ key, entity_type, type, status }) => ({
          key,
          entity_type,
          type,
          status,
        })),
      };
    }

    for (const field of plan) {
      if (field.status !== 'new') continue;
      const created = await this.prisma.entity_metadata_fields.create({
        data: {
          entity_type: field.entity_type as never,
          field_key: field.key,
          field_type: field.type as never,
          label: field.label,
          description: field.description,
          options: field.options ?? undefined,
          display_mode: 'detail',
        },
      });
      field.id = created.id;
    }

    const dto = this.toDto(json, fields);
    this.logger.log(`Importing template "${json.name}" (${plan.length} fields)`);
    return this.templates.createTemplate(dto);
  }

  private throwErrors(errors: TemplateJsonError[]): never {
    throw new VendixHttpException(
      ErrorCodes.DCOL_IMPORT_001,
      'La plantilla JSON tiene errores',
      { errors },
    );
  }

  private entityOf(json: TemplateJson, item: TemplateJsonItem): string {
    return item.field.entity_type ?? json.entity_type;
  }

  /** Visits every item with the same path the contract reports errors at. */
  private walk(
    json: TemplateJson,
    visit: (item: TemplateJsonItem, path: string) => void,
  ) {
    const section = (s: TemplateJsonSection, p: string) => {
      (s.items ?? []).forEach((item, j) => visit(item, `${p}.items[${j}]`));
      (s.child_sections ?? []).forEach((c, k) =>
        section(c, `${p}.child_sections[${k}]`),
      );
    };
    (json.tabs ?? []).forEach((tab, t) =>
      tab.sections.forEach((s, i) => section(s, `tabs[${t}].sections[${i}]`)),
    );
    (json.sections ?? []).forEach((s, i) => section(s, `sections[${i}]`));
  }

  private async resolveFields(json: TemplateJson) {
    const items: Array<{ item: TemplateJsonItem; path: string }> = [];
    this.walk(json, (item, path) => items.push({ item, path }));

    const existing: ExistingField[] = items.length
      ? await this.prisma.entity_metadata_fields.findMany({
          where: {
            field_key: { in: [...new Set(items.map((i) => i.item.field.key))] },
          },
          select: {
            id: true,
            entity_type: true,
            field_key: true,
            field_type: true,
            is_active: true,
          },
        })
      : [];
    const byRef = new Map(
      existing.map((row) => [fieldRef(row.entity_type, row.field_key), row]),
    );

    const fields = new Map<string, ResolvedField>();
    const errors: TemplateJsonError[] = [];
    for (const { item, path } of items) {
      const entityType = this.entityOf(json, item);
      const ref = fieldRef(entityType, item.field.key);
      const row = byRef.get(ref);
      if (row && row.field_type !== item.field.type) {
        errors.push({
          path: `${path}.field.type`,
          message: `La clave "${item.field.key}" ya existe en la tienda como tipo "${row.field_type}".`,
        });
        continue;
      }
      if (row && !row.is_active) {
        errors.push({
          path: `${path}.field.key`,
          message: `La clave "${item.field.key}" existe en la tienda pero está inactiva. Actívala o usa otra clave.`,
        });
        continue;
      }
      if (fields.has(ref)) continue;
      fields.set(ref, {
        id: row?.id,
        key: item.field.key,
        entity_type: entityType,
        type: item.field.type,
        status: row ? 'reuse' : 'new',
        label: item.field.label,
        description: item.field.description,
        options: item.field.type === 'select' ? item.field.options : undefined,
      });
    }
    return { fields, errors };
  }

  private toDto(
    json: TemplateJson,
    fields: Map<string, ResolvedField>,
  ): CreateTemplateDto {
    const mapItem = (
      item: TemplateJsonItem,
      index: number,
    ): CreateTemplateItemDto => {
      const field = fields.get(fieldRef(this.entityOf(json, item), item.field.key));
      return {
        metadata_field_id: field!.id as number,
        sort_order: index,
        is_required: item.required,
        include_in_summary: item.include_in_summary,
        help_text: item.help_text,
        placeholder: item.placeholder,
        width: item.width,
        icon: item.icon,
        ...(item.field.type === 'file'
          ? {
              validation_rules: {
                documents: item.documents ?? resolveDocumentConfig(undefined),
              },
            }
          : {}),
      };
    };
    const mapSection = (
      s: TemplateJsonSection,
      index: number,
    ): CreateTemplateSectionDto => ({
      title: s.title,
      description: s.description,
      icon: s.icon,
      sort_order: index,
      items: (s.items ?? []).map(mapItem),
      child_sections: (s.child_sections ?? []).map(mapSection),
    });

    return {
      name: json.name,
      description: json.description,
      icon: json.icon,
      entity_type: json.entity_type,
      status: 'inactive',
      ...(json.tabs
        ? {
            tabs: json.tabs.map((tab, t) => ({
              title: tab.title,
              icon: tab.icon,
              sort_order: t,
              sections: tab.sections.map(mapSection),
            })),
          }
        : {}),
      ...(json.sections ? { sections: json.sections.map(mapSection) } : {}),
    };
  }
}
