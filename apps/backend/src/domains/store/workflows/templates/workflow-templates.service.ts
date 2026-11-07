import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowDefinitionsService } from '../definitions/workflow-definitions.service';
import { WORKFLOW_TEMPLATES, WorkflowTemplate } from './workflow-templates.catalog';

export interface WorkflowTemplateStageSummary {
  key: string;
  name: string;
  type: string;
}

export interface WorkflowTemplateSummary {
  key: string;
  name: string;
  category: string;
  description: string;
  icon: string;
  stage_count: number;
  stages: WorkflowTemplateStageSummary[];
}

export interface WorkflowTemplateActivation {
  id: number;
  key: string;
  name: string;
  version: number;
  source_template_key: string;
}

/** Gallery of ready-made Administration flows and their one-click activation (P5.4). */
@Injectable()
export class WorkflowTemplatesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly definitions: WorkflowDefinitionsService,
  ) {}

  list(): WorkflowTemplateSummary[] {
    return WORKFLOW_TEMPLATES.map((t) => this.summarize(t));
  }

  get(key: string): WorkflowTemplateSummary & { definition: WorkflowTemplate['definition'] } {
    const template = this.find(key);
    return { ...this.summarize(template), definition: template.definition };
  }

  /**
   * Creates the flow in the current store and publishes v1 through the same
   * services the editor uses, so the industry gate, store scoping and the
   * publish validation apply exactly as for a manual flow. Never overwrites:
   * a taken key gets `-2`, `-3`…
   */
  async activate(key: string): Promise<WorkflowTemplateActivation> {
    const template = this.find(key);
    const storeId = RequestContextService.getContext()?.store_id;
    if (!storeId) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    const { flowKey, copy } = await this.freeKey(storeId, template.key);
    const name = copy > 1 ? `${template.name} (${copy})` : template.name;

    const created = await this.definitions.create({
      name,
      key: flowKey,
      description: template.description,
      category: template.category,
      definition: { ...template.definition, key: flowKey, name },
      source_template_key: template.key,
    });
    const published = await this.definitions.publish(created.id, {
      changelog: `Plantilla "${template.name}"`,
    });
    return {
      id: created.id,
      key: flowKey,
      name,
      version: published.version.version,
      source_template_key: template.key,
    };
  }

  private find(key: string): WorkflowTemplate {
    const template = WORKFLOW_TEMPLATES.find((t) => t.key === key);
    if (!template) throw new VendixHttpException(ErrorCodes.WORKFLOW_TEMPLATE_NOT_FOUND);
    return template;
  }

  private summarize(t: WorkflowTemplate): WorkflowTemplateSummary {
    const stages = t.definition.stages.map((s) => ({ key: s.key, name: s.name, type: s.type }));
    return {
      key: t.key,
      name: t.name,
      category: t.category,
      description: t.description,
      icon: t.icon,
      stage_count: stages.length,
      stages,
    };
  }

  private async freeKey(storeId: number, wanted: string): Promise<{ flowKey: string; copy: number }> {
    const taken = new Set<string>(
      (
        await this.prisma.workflow_definitions.findMany({
          where: { store_id: storeId, key: { startsWith: wanted } },
          select: { key: true },
        })
      ).map((r: { key: string }) => r.key),
    );
    if (!taken.has(wanted)) return { flowKey: wanted, copy: 1 };
    for (let n = 2; n < 1000; n++) {
      const candidate = `${wanted}-${n}`;
      if (!taken.has(candidate)) return { flowKey: candidate, copy: n };
    }
    throw new VendixHttpException(ErrorCodes.WORKFLOW_KEY_TAKEN);
  }
}
