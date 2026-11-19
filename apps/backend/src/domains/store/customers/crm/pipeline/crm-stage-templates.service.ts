import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import {
  ErrorCodeEntry,
  ErrorCodes,
  VendixHttpException,
} from '../../../../../common/errors';
import {
  DEFAULT_CRM_PIPELINE,
  StoreBootstrapHelper,
} from '../../../../../common/helpers/store-bootstrap.helper';
import { CrmViewer, resolveCrmViewer } from '../shared/crm-access';
import { STAGE_SELECT } from './crm-pipeline.service';
import {
  CRM_STAGE_KINDS,
  CreateCrmPipelineDto,
  CreateCrmStageTemplateDto,
  CrmStageKind,
  CrmStageTemplateStageDto,
  UpdateCrmStageTemplateDto,
} from './dto/crm-pipeline.dto';

/** Name of the template every store starts with. */
export const INITIAL_STAGE_TEMPLATE_NAME = 'Embudo estándar';
const MAX_TEMPLATE_STAGES = 20;

export interface CrmStageTemplateStage {
  name: string;
  kind: CrmStageKind;
  color: string | null;
  probability: number | null;
}

type TemplateRow = {
  id: number;
  name: string;
  stages: Prisma.JsonValue;
  created_at: Date;
  updated_at: Date;
};

type PipelineStage = Prisma.crm_pipeline_stagesGetPayload<{
  select: typeof STAGE_SELECT;
}>;

/**
 * Stage templates (QUI-1043 H3). A template is a reusable, ordered list of
 * stages. It is copied into a pipeline, never linked: editing a template does
 * not touch the pipelines it was applied to.
 *
 * Applying a template reconciles the pipeline's stages by name, so the
 * opportunities keep their stage:
 *  - a template stage that matches an existing one (same name, case
 *    insensitive) updates its kind, color, probability and order and is
 *    reactivated;
 *  - a template stage without a match is created;
 *  - an existing stage that is not in the template is deactivated.
 * It refuses (409) when a stage left out still has open opportunities, or when
 * a stage with opportunities would change kind (its status would no longer
 * match its stage).
 *
 * Editing templates and pipelines is store configuration: see-all only.
 */
@Injectable()
export class CrmStageTemplatesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: AuditService,
    private readonly bootstrap: StoreBootstrapHelper,
  ) {}

  /** Templates of the store; seeds the initial one when there is none. */
  async list() {
    const viewer = this.viewer();
    let rows = await this.readTemplates();
    if (!rows.length) {
      await this.seedInitialTemplate(viewer);
      rows = await this.readTemplates();
    }
    return rows.map((row) => this.toTemplate(row));
  }

  async create(dto: CreateCrmStageTemplateDto) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const stages = this.normalizeStages(dto.stages);
    try {
      const row = await this.prisma.crm_stage_templates.create({
        data: {
          store_id: viewer.store_id,
          name: dto.name.trim(),
          stages: stages as unknown as Prisma.InputJsonValue,
        },
      });
      return this.toTemplate(row);
    } catch (error) {
      throw this.mapUnique(error, ErrorCodes.CRM_STAGE_TEMPLATE_002);
    }
  }

  async update(id: number, dto: UpdateCrmStageTemplateDto) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    await this.findTemplate(id);
    const data: Prisma.crm_stage_templatesUpdateManyMutationInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.stages !== undefined) {
      data.stages = this.normalizeStages(
        dto.stages,
      ) as unknown as Prisma.InputJsonValue;
    }
    if (Object.keys(data).length) {
      try {
        await this.prisma.crm_stage_templates.updateMany({
          where: { id },
          data,
        });
      } catch (error) {
        throw this.mapUnique(error, ErrorCodes.CRM_STAGE_TEMPLATE_002);
      }
    }
    return this.toTemplate(await this.findTemplate(id));
  }

  async remove(id: number) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const current = await this.findTemplate(id);
    await this.prisma.crm_stage_templates.deleteMany({ where: { id } });
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'DELETE',
      resource: 'crm_stage_templates',
      resourceId: id,
      oldValues: this.toTemplate(current),
    });
    return { id };
  }

  /** New pipeline with the stages of a template. */
  async createPipeline(dto: CreateCrmPipelineDto) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const template = await this.findTemplate(dto.template_id);
    const stages = this.parseStages(template.stages);
    // The store keeps its default pipeline: the new one is never the default.
    await this.bootstrap.ensureDefaultCrmPipeline({
      store_id: viewer.store_id,
    });
    let created: { id: number };
    try {
      created = await this.prisma.crm_pipelines.create({
        data: {
          store_id: viewer.store_id,
          name: dto.name.trim(),
          is_default: false,
          stages: {
            create: stages.map((stage, index) => ({
              store_id: viewer.store_id,
              name: stage.name,
              kind: stage.kind,
              color: stage.color,
              probability: stage.probability,
              sort_order: index,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error) {
      throw this.mapUnique(error, ErrorCodes.CRM_PIPELINE_009);
    }
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'CREATE',
      resource: 'crm_pipelines',
      resourceId: created.id,
      newValues: { name: dto.name.trim(), template_id: template.id, stages },
    });
    return this.readPipeline(created.id);
  }

  /** Reconciles the pipeline's stages with the template (see class doc). */
  async applyTemplate(pipelineId: number, templateId: number) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const pipeline = await this.readPipeline(pipelineId);
    const template = await this.findTemplate(templateId);
    const wanted = this.parseStages(template.stages);

    const usage = await this.stageUsage(pipeline.id);
    const plan = this.planReconcile(pipeline.stages, wanted);

    for (const { stage, target } of plan.matched) {
      if (stage.kind !== target.kind && usage.total.get(stage.id)) {
        throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_008);
      }
    }
    for (const stage of plan.surplus) {
      if (stage.is_active && usage.open.get(stage.id)) {
        throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_006);
      }
    }

    const storeId = viewer.store_id;
    try {
      // The tx client is unscoped: every write names the pipeline's stage ids
      // read above (scoped) or the store explicitly.
      await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        for (const { stage, target, index } of plan.matched) {
          await tx.crm_pipeline_stages.updateMany({
            where: { id: stage.id, pipeline_id: pipeline.id, store_id: storeId },
            data: {
              kind: target.kind,
              color: target.color,
              probability: target.probability,
              sort_order: index,
              is_active: true,
            },
          });
        }
        for (const { target, index } of plan.created) {
          await tx.crm_pipeline_stages.create({
            data: {
              store_id: storeId,
              pipeline_id: pipeline.id,
              name: target.name,
              kind: target.kind,
              color: target.color,
              probability: target.probability,
              sort_order: index,
            },
          });
        }
        let next = wanted.length;
        for (const stage of plan.surplus) {
          await tx.crm_pipeline_stages.updateMany({
            where: { id: stage.id, pipeline_id: pipeline.id, store_id: storeId },
            data: { is_active: false, sort_order: next++ },
          });
        }
      });
    } catch (error) {
      throw this.mapUnique(error, ErrorCodes.CRM_PIPELINE_005);
    }

    const result = await this.readPipeline(pipeline.id);
    await this.audit.log({
      userId: viewer.user_id,
      storeId,
      action: 'UPDATE',
      resource: 'crm_pipelines',
      resourceId: pipeline.id,
      oldValues: { stages: pipeline.stages },
      newValues: { template_id: template.id, stages: result.stages },
      metadata: { reason: 'crm_apply_stage_template' },
    });
    return result;
  }

  /**
   * Pairs each template stage with an existing stage: exact name first, then
   * case insensitive. Existing names are kept (no rename).
   */
  private planReconcile(
    existing: PipelineStage[],
    wanted: CrmStageTemplateStage[],
  ) {
    const free = new Set(existing.map((stage) => stage.id));
    const pick = (match: (stage: PipelineStage) => boolean) => {
      const found = existing.find((stage) => free.has(stage.id) && match(stage));
      if (found) free.delete(found.id);
      return found;
    };
    const pairs = wanted.map((target, index) => ({
      target,
      index,
      stage: pick((stage) => stage.name === target.name),
    }));
    for (const pair of pairs) {
      pair.stage ??= pick(
        (stage) => stage.name.toLowerCase() === pair.target.name.toLowerCase(),
      );
    }
    return {
      matched: pairs.filter(
        (pair): pair is typeof pair & { stage: PipelineStage } => !!pair.stage,
      ),
      created: pairs.filter((pair) => !pair.stage),
      surplus: existing.filter((stage) => free.has(stage.id)),
    };
  }

  /** Opportunities per stage of the pipeline: all and open ones. */
  private async stageUsage(pipelineId: number) {
    const rows = await this.prisma.crm_opportunities.findMany({
      where: { pipeline_id: pipelineId },
      select: { stage_id: true, status: true },
    });
    const total = new Map<number, number>();
    const open = new Map<number, number>();
    for (const row of rows) {
      total.set(row.stage_id, (total.get(row.stage_id) ?? 0) + 1);
      if (row.status === 'open') {
        open.set(row.stage_id, (open.get(row.stage_id) ?? 0) + 1);
      }
    }
    return { total, open };
  }

  /**
   * The initial template is the store's current funnel: the active stages of
   * its default pipeline, or the stages every store is born with.
   */
  private async seedInitialTemplate(viewer: CrmViewer) {
    const pipeline = await this.prisma.crm_pipelines.findFirst({
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: {
        stages: {
          where: { is_active: true },
          select: STAGE_SELECT,
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const current = (pipeline?.stages ?? []).map((stage) => ({
      name: stage.name,
      kind: stage.kind as CrmStageKind,
      color: stage.color,
      probability: stage.probability,
    }));
    let stages: CrmStageTemplateStage[];
    try {
      stages = this.normalizeStages(current);
    } catch {
      stages = DEFAULT_CRM_PIPELINE.stages.map((stage) => ({
        name: stage.name,
        kind: stage.kind,
        color: null,
        probability: null,
      }));
    }
    try {
      await this.prisma.crm_stage_templates.create({
        data: {
          store_id: viewer.store_id,
          name: INITIAL_STAGE_TEMPLATE_NAME,
          stages: stages as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      // Another request seeded it first.
      if (!this.isUnique(error)) throw error;
    }
  }

  /**
   * Trims names and enforces the template rules: 1-20 stages, names unique
   * (case insensitive) and at least one open stage.
   */
  private normalizeStages(
    input: Array<CrmStageTemplateStageDto | CrmStageTemplateStage>,
  ): CrmStageTemplateStage[] {
    const stages = input.map((stage) => ({
      name: (stage.name ?? '').trim(),
      kind: stage.kind,
      color: stage.color?.trim() ? stage.color.trim() : null,
      probability: stage.probability ?? null,
    }));
    const names = new Set(stages.map((stage) => stage.name.toLowerCase()));
    if (
      !stages.length ||
      stages.length > MAX_TEMPLATE_STAGES ||
      names.size !== stages.length ||
      stages.some(
        (stage) => !stage.name || !CRM_STAGE_KINDS.includes(stage.kind),
      ) ||
      !stages.some((stage) => stage.kind === 'open')
    ) {
      throw new VendixHttpException(ErrorCodes.CRM_STAGE_TEMPLATE_003);
    }
    return stages;
  }

  /** Stored JSON back to stages; a broken template cannot be applied. */
  private parseStages(value: Prisma.JsonValue): CrmStageTemplateStage[] {
    if (!Array.isArray(value)) {
      throw new VendixHttpException(ErrorCodes.CRM_STAGE_TEMPLATE_003);
    }
    return this.normalizeStages(
      value.map((item) => {
        const stage = (item ?? {}) as Record<string, unknown>;
        return {
          name: typeof stage.name === 'string' ? stage.name : '',
          kind: stage.kind as CrmStageKind,
          color: typeof stage.color === 'string' ? stage.color : null,
          probability:
            typeof stage.probability === 'number' ? stage.probability : null,
        };
      }),
    );
  }

  private toTemplate(row: TemplateRow) {
    let stages: CrmStageTemplateStage[] = [];
    try {
      stages = this.parseStages(row.stages);
    } catch {
      stages = [];
    }
    return {
      id: row.id,
      name: row.name,
      stages,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  private readTemplates() {
    return this.prisma.crm_stage_templates.findMany({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
  }

  private async findTemplate(id: number): Promise<TemplateRow> {
    const row = await this.prisma.crm_stage_templates.findFirst({
      where: { id },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_STAGE_TEMPLATE_001);
    return row;
  }

  private async readPipeline(id: number) {
    const pipeline = await this.prisma.crm_pipelines.findFirst({
      where: { id },
      select: {
        id: true,
        name: true,
        is_default: true,
        stages: {
          select: STAGE_SELECT,
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!pipeline) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);
    return pipeline;
  }

  private viewer(): CrmViewer {
    return resolveCrmViewer(ErrorCodes.CRM_PIPELINE_001);
  }

  private assertCanConfigure(viewer: CrmViewer): void {
    if (!viewer.can_see_all) {
      throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_007);
    }
  }

  private isUnique(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private mapUnique(error: unknown, code: ErrorCodeEntry): unknown {
    return this.isUnique(error) ? new VendixHttpException(code) : error;
  }
}
