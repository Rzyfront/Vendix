import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { AuditService } from '../../../../../common/audit/audit.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import { StoreBootstrapHelper } from '../../../../../common/helpers/store-bootstrap.helper';
import {
  CrmViewer,
  isActiveStoreStaff,
  isStoreCustomer,
  resolveCrmViewer,
} from '../shared/crm-access';
import {
  CreateCrmOpportunityDto,
  CreateCrmStageDto,
  CrmOpportunitiesQueryDto,
  MoveCrmOpportunityDto,
  OpenCrmOpportunitiesQueryDto,
  UpdateCrmOpportunityDto,
  UpdateCrmStageDto,
} from './dto/crm-pipeline.dto';

export const CRM_PIPELINE_READ_PERMISSION = 'store:crm_pipeline:read';
export const CRM_PIPELINE_MANAGE_PERMISSION = 'store:crm_pipeline:manage';
/** Max cards on one board; the oldest closed ones drop first. */
const BOARD_LIMIT = 500;

const PERSON_SELECT = { id: true, first_name: true, last_name: true } as const;

export const STAGE_SELECT = {
  id: true,
  pipeline_id: true,
  name: true,
  kind: true,
  probability: true,
  color: true,
  sort_order: true,
  is_active: true,
} as const;

const OPPORTUNITY_INCLUDE = {
  customer: { select: PERSON_SELECT },
  owner: { select: PERSON_SELECT },
  stage: { select: STAGE_SELECT },
  quotation: { select: { id: true, quotation_number: true, status: true } },
} as const;

type OpportunityRow = Prisma.crm_opportunitiesGetPayload<{
  include: typeof OPPORTUNITY_INCLUDE;
}>;
type StageRow = Prisma.crm_pipeline_stagesGetPayload<{
  select: typeof STAGE_SELECT;
}>;

/** Why completing a task did not move its opportunity. */
export type CrmTaskMoveSkipReason =
  | 'opportunity_missing'
  | 'opportunity_closed'
  | 'already_in_stage'
  | 'stage_unavailable'
  | 'failed';

/** What completing a task that "moves the opportunity" did to it. */
export interface CrmTaskOpportunityMove {
  moved: boolean;
  reason: CrmTaskMoveSkipReason | null;
  stage: { id: number; name: string; kind: string } | null;
}

/** Cap of the open opportunities offered by the task form. */
const OPEN_FOR_CUSTOMER_LIMIT = 20;

/**
 * Sales pipeline (PLAN-CRM §4.6). The stage kind drives the opportunity
 * status: moving into a `won` stage wins it, into a `lost` stage loses it
 * (with a reason) and back into an `open` stage reopens it. Probability is the
 * stage's: `crm_opportunities` has no own column for it.
 *
 * A seller only sees and moves the opportunities they own; owner/admin
 * (see-all) see the whole store. Editing stages is store configuration and
 * needs see-all.
 */
@Injectable()
export class CrmPipelineService {
  private readonly logger = new Logger(CrmPipelineService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: AuditService,
    private readonly bootstrap: StoreBootstrapHelper,
  ) {}

  /** Pipelines with their stages; creates "Ventas" if the store has none. */
  async listPipelines() {
    const viewer = this.viewer();
    let pipelines = await this.readPipelines();
    if (!pipelines.length) {
      await this.bootstrap.ensureDefaultCrmPipeline({
        store_id: viewer.store_id,
      });
      pipelines = await this.readPipelines();
    }
    return pipelines;
  }

  async createStage(pipelineId: number, dto: CreateCrmStageDto) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const pipeline = await this.prisma.crm_pipelines.findFirst({
      where: { id: pipelineId },
      select: { id: true },
    });
    if (!pipeline) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);
    const last = await this.prisma.crm_pipeline_stages.findFirst({
      where: { pipeline_id: pipelineId },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });
    try {
      return await this.prisma.crm_pipeline_stages.create({
        data: {
          store_id: viewer.store_id,
          pipeline_id: pipelineId,
          name: dto.name.trim(),
          kind: dto.kind ?? 'open',
          probability: dto.probability ?? null,
          color: dto.color ?? null,
          sort_order: dto.sort_order ?? (last ? last.sort_order + 1 : 0),
        },
        select: STAGE_SELECT,
      });
    } catch (error) {
      throw this.mapStageUnique(error);
    }
  }

  async updateStage(stageId: number, dto: UpdateCrmStageDto) {
    const viewer = this.viewer();
    this.assertCanConfigure(viewer);
    const stage = await this.findStage(stageId);
    if (dto.is_active === false && stage.is_active) {
      const open = await this.prisma.crm_opportunities.count({
        where: { stage_id: stageId, status: 'open' },
      });
      if (open) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_006);
    }
    try {
      await this.prisma.crm_pipeline_stages.updateMany({
        where: { id: stageId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
          ...(dto.probability !== undefined
            ? { probability: dto.probability }
            : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          ...(dto.sort_order !== undefined ? { sort_order: dto.sort_order } : {}),
          ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        },
      });
    } catch (error) {
      throw this.mapStageUnique(error);
    }
    return this.findStage(stageId);
  }

  /** Board of one pipeline: its stages, each with its cards. */
  async board(query: CrmOpportunitiesQueryDto) {
    const viewer = this.viewer();
    const pipelines = await this.listPipelines();
    const pipeline = query.pipeline_id
      ? pipelines.find((row) => row.id === query.pipeline_id)
      : (pipelines.find((row) => row.is_default) ?? pipelines[0]);
    if (!pipeline) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);

    const and: Prisma.crm_opportunitiesWhereInput[] = [
      { pipeline_id: pipeline.id },
      this.visibility(viewer),
    ];
    if (query.owner === 'me') and.push({ owner_user_id: viewer.user_id });
    else if (query.owner) and.push({ owner_user_id: Number(query.owner) });
    if (query.status) and.push({ status: query.status });
    if (query.customer_id) and.push({ customer_id: query.customer_id });
    const q = query.q?.trim();
    if (q) {
      and.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { customer: { first_name: { contains: q, mode: 'insensitive' } } },
          { customer: { last_name: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const rows = await this.prisma.crm_opportunities.findMany({
      where: { AND: and },
      include: OPPORTUNITY_INCLUDE,
      orderBy: [{ status: 'asc' }, { updated_at: 'desc' }],
      take: BOARD_LIMIT,
    });
    const cards = rows
      .map((row) => this.toOpportunity(row))
      .sort((a, b) => a.sort_order - b.sort_order || b.id - a.id);

    const stages = pipeline.stages
      .filter(
        (stage) =>
          stage.is_active || cards.some((card) => card.stage_id === stage.id),
      )
      .map((stage) => {
        const opportunities = cards.filter((card) => card.stage_id === stage.id);
        const total = opportunities.reduce(
          (sum, card) => sum + Number(card.amount ?? 0),
          0,
        );
        return {
          ...stage,
          count: opportunities.length,
          total_amount: total.toFixed(2),
          opportunities,
        };
      });

    return {
      pipeline: { id: pipeline.id, name: pipeline.name, is_default: pipeline.is_default },
      pipelines: pipelines.map(({ id, name, is_default }) => ({
        id,
        name,
        is_default,
      })),
      stages,
      truncated: rows.length === BOARD_LIMIT,
    };
  }

  async findOne(id: number) {
    return this.toOpportunity(await this.findVisible(this.viewer(), id));
  }

  /**
   * Open opportunities of one customer for the task form: board, current
   * stage and the active stages of that board. Same visibility as the board,
   * so a seller only gets their own. `include_id` (the opportunity of the
   * task being edited) is added when it is not in the first page.
   */
  async openForCustomer(query: OpenCrmOpportunitiesQueryDto) {
    const viewer = this.viewer();
    const open: Prisma.crm_opportunitiesWhereInput[] = [
      { customer_id: query.customer_id, status: 'open' },
      this.visibility(viewer),
    ];
    const select = {
      id: true,
      title: true,
      stage: { select: STAGE_SELECT },
      pipeline: {
        select: {
          id: true,
          name: true,
          stages: {
            where: { is_active: true },
            select: STAGE_SELECT,
            orderBy: [{ sort_order: 'asc' as const }, { id: 'asc' as const }],
          },
        },
      },
    };
    const rows = await this.prisma.crm_opportunities.findMany({
      where: { AND: open },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      take: OPEN_FOR_CUSTOMER_LIMIT,
      select,
    });
    const includeId = query.include_id;
    if (includeId && !rows.some((row) => row.id === includeId)) {
      const linked = await this.prisma.crm_opportunities.findFirst({
        where: { AND: [{ id: includeId }, ...open] },
        select,
      });
      if (linked) rows.push(linked);
    }
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      pipeline: { id: row.pipeline.id, name: row.pipeline.name },
      stage: row.stage,
      stages: row.pipeline.stages,
    }));
  }

  /**
   * Stage a task may move its linked opportunity to: of the opportunity's
   * board, active and not `lost` (losing needs a reason; that stays on the
   * board). Throws CRM_TASK_002 otherwise.
   */
  async assertTaskTargetStage(
    opportunityId: number,
    stageId: number,
  ): Promise<void> {
    const [opportunity, stage] = await Promise.all([
      this.prisma.crm_opportunities.findFirst({
        where: { id: opportunityId },
        select: { pipeline_id: true },
      }),
      this.prisma.crm_pipeline_stages.findFirst({
        where: { id: stageId },
        select: STAGE_SELECT,
      }),
    ]);
    if (!opportunity || !stage || !this.isTaskTarget(stage, opportunity.pipeline_id)) {
      throw new VendixHttpException(ErrorCodes.CRM_TASK_002);
    }
  }

  /**
   * A task that "moves the opportunity" was completed: same move as the
   * board ({@link applyStage}), a `won` stage wins it. Linking the task is
   * what authorizes it, so whoever completes it (assignee or support) need
   * not own the opportunity. When it is no longer open, is already there or
   * the stage stopped being a valid target, nothing moves and the reason is
   * returned: the task is completed anyway.
   */
  async moveForTask(
    opportunityId: number,
    stageId: number,
  ): Promise<CrmTaskOpportunityMove> {
    const viewer: CrmViewer = { ...this.viewer(), can_see_all: true };
    const [current, stage] = await Promise.all([
      this.prisma.crm_opportunities.findFirst({
        where: { id: opportunityId },
        include: OPPORTUNITY_INCLUDE,
      }),
      this.prisma.crm_pipeline_stages.findFirst({
        where: { id: stageId },
        select: STAGE_SELECT,
      }),
    ]);
    const target = stage
      ? { id: stage.id, name: stage.name, kind: stage.kind }
      : null;
    const skip = (reason: CrmTaskMoveSkipReason): CrmTaskOpportunityMove => ({
      moved: false,
      reason,
      stage: target,
    });
    if (!current) return skip('opportunity_missing');
    if (current.status !== 'open') return skip('opportunity_closed');
    if (!stage || !this.isTaskTarget(stage, current.pipeline_id)) {
      return skip('stage_unavailable');
    }
    if (stage.id === current.stage_id) return skip('already_in_stage');
    await this.applyStage(viewer, current, stage, {});
    return { moved: true, reason: null, stage: target };
  }

  async create(dto: CreateCrmOpportunityDto) {
    const viewer = this.viewer();
    if (!(await isStoreCustomer(this.prisma, dto.customer_id))) {
      throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    }
    const owner =
      dto.owner_user_id === undefined ? viewer.user_id : dto.owner_user_id;
    await this.assertOwner(viewer, owner);
    if (dto.quotation_id) {
      await this.assertQuotation(dto.quotation_id, dto.customer_id);
    }
    const stage = await this.resolveInitialStage(dto);
    if (stage.kind === 'lost') {
      // A new opportunity has no reason to start lost.
      throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_003);
    }
    const last = await this.prisma.crm_opportunities.findFirst({
      where: { stage_id: stage.id },
      orderBy: { sort_order: 'desc' },
      select: { sort_order: true },
    });
    const now = new Date();
    const created = await this.prisma.crm_opportunities.create({
      data: {
        store_id: viewer.store_id,
        customer_id: dto.customer_id,
        pipeline_id: stage.pipeline_id,
        stage_id: stage.id,
        title: dto.title.trim(),
        amount: dto.amount ?? null,
        currency: dto.currency ?? null,
        owner_user_id: owner,
        quotation_id: dto.quotation_id ?? null,
        expected_close_date: dto.expected_close_date
          ? new Date(`${dto.expected_close_date}T00:00:00.000Z`)
          : null,
        status: stage.kind === 'won' ? 'won' : 'open',
        won_at: stage.kind === 'won' ? now : null,
        sort_order: last ? last.sort_order + 1 : 0,
      },
      include: OPPORTUNITY_INCLUDE,
    });
    await this.syncCustomerStage(dto.customer_id, stage.id);
    return this.toOpportunity(created);
  }

  async update(id: number, dto: UpdateCrmOpportunityDto) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    const data: Prisma.crm_opportunitiesUncheckedUpdateManyInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.amount !== undefined) data.amount = dto.amount;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.expected_close_date !== undefined) {
      data.expected_close_date = dto.expected_close_date
        ? new Date(`${dto.expected_close_date}T00:00:00.000Z`)
        : null;
    }
    if (
      dto.owner_user_id !== undefined &&
      dto.owner_user_id !== current.owner_user_id
    ) {
      await this.assertOwner(viewer, dto.owner_user_id);
      data.owner_user_id = dto.owner_user_id;
    }
    if (dto.quotation_id !== undefined) {
      if (dto.quotation_id !== null) {
        await this.assertQuotation(dto.quotation_id, current.customer_id);
      }
      data.quotation_id = dto.quotation_id;
    }
    if (dto.lost_reason !== undefined) {
      if (current.status !== 'lost') {
        throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_002);
      }
      data.lost_reason = dto.lost_reason.trim();
    }

    if (Object.keys(data).length) {
      await this.prisma.crm_opportunities.updateMany({ where: { id }, data });
      if (data.owner_user_id !== undefined) {
        await this.auditChange(viewer, id, 'crm_opportunity_owner', {
          owner_user_id: current.owner_user_id,
        }, { owner_user_id: data.owner_user_id });
      }
    }
    return this.findOne(id);
  }

  /**
   * Deletes an opportunity (QUI-1043 H2). Same pattern as the rest of the CRM:
   * physical delete plus an audit row with the full snapshot. Its tasks keep
   * living (`crm_tasks.opportunity_id` is SET NULL). The customer's stage
   * follows its most recently updated remaining opportunity; with none left it
   * keeps the last stage it reached.
   */
  async remove(id: number) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    await this.prisma.crm_opportunities.deleteMany({ where: { id } });
    await this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'DELETE',
      resource: 'crm_opportunities',
      resourceId: id,
      oldValues: this.toOpportunity(current),
    });
    const latest = await this.prisma.crm_opportunities.findFirst({
      where: { customer_id: current.customer_id },
      orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
      select: { stage_id: true },
    });
    if (latest) await this.syncCustomerStage(current.customer_id, latest.stage_id);
    return { id };
  }

  async move(id: number, dto: MoveCrmOpportunityDto) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    const stage = await this.findStage(dto.stage_id);
    if (stage.pipeline_id !== current.pipeline_id || !stage.is_active) {
      throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_002);
    }
    return this.applyStage(viewer, current, stage, {
      sort_order: dto.sort_order,
      lost_reason: dto.lost_reason,
    });
  }

  async win(id: number) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    const stage = await this.closingStage(current.pipeline_id, 'won');
    return this.applyStage(viewer, current, stage, {});
  }

  async lose(id: number, lostReason: string) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    const stage = await this.closingStage(current.pipeline_id, 'lost');
    return this.applyStage(viewer, current, stage, { lost_reason: lostReason });
  }

  /**
   * A linked quotation was accepted or converted (PLAN-CRM §2.5): every open
   * opportunity of the store that links it moves to its pipeline's won stage.
   * Event-driven, never an SQL trigger. Returns how many were won.
   */
  async winByQuotation(
    storeId: number,
    quotationId: number,
    orderId: number | null,
  ): Promise<number> {
    const rows = await this.prisma.crm_opportunities.findMany({
      where: { store_id: storeId, quotation_id: quotationId, status: 'open' },
      select: { id: true, pipeline_id: true, customer_id: true },
    });
    let won = 0;
    const now = new Date();
    for (const row of rows) {
      const stage = await this.prisma.crm_pipeline_stages.findFirst({
        where: { pipeline_id: row.pipeline_id, kind: 'won', is_active: true },
        orderBy: { sort_order: 'asc' },
        select: { id: true },
      });
      if (!stage) {
        this.logger.warn(
          `Opportunity ${row.id}: pipeline ${row.pipeline_id} has no won stage`,
        );
        continue;
      }
      const updated = await this.prisma.crm_opportunities.updateMany({
        where: { id: row.id, status: 'open' },
        data: {
          stage_id: stage.id,
          status: 'won',
          won_at: now,
          lost_at: null,
          lost_reason: null,
          ...(orderId ? { order_id: orderId } : {}),
        },
      });
      if (updated.count) {
        // Event-driven: the store comes from the event, not the request.
        await this.prisma.withoutScope().store_users.updateMany({
          where: { store_id: storeId, user_id: row.customer_id },
          data: { crm_stage_id: stage.id },
        });
      }
      won += updated.count;
    }
    return won;
  }

  private viewer(): CrmViewer {
    return resolveCrmViewer(ErrorCodes.CRM_OPPORTUNITY_001);
  }

  private isTaskTarget(stage: StageRow, pipelineId: number): boolean {
    return (
      stage.pipeline_id === pipelineId && stage.is_active && stage.kind !== 'lost'
    );
  }

  private visibility(viewer: CrmViewer): Prisma.crm_opportunitiesWhereInput {
    return viewer.can_see_all ? {} : { owner_user_id: viewer.user_id };
  }

  private assertCanConfigure(viewer: CrmViewer): void {
    if (!viewer.can_see_all) {
      throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_007);
    }
  }

  private readPipelines() {
    return this.prisma.crm_pipelines.findMany({
      orderBy: [{ is_default: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        is_default: true,
        stages: { select: STAGE_SELECT, orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
      },
    });
  }

  private async findStage(stageId: number): Promise<StageRow> {
    const stage = await this.prisma.crm_pipeline_stages.findFirst({
      where: { id: stageId },
      select: STAGE_SELECT,
    });
    if (!stage) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);
    return stage;
  }

  private async closingStage(
    pipelineId: number,
    kind: 'won' | 'lost',
  ): Promise<StageRow> {
    const stage = await this.prisma.crm_pipeline_stages.findFirst({
      where: { pipeline_id: pipelineId, kind, is_active: true },
      orderBy: { sort_order: 'asc' },
      select: STAGE_SELECT,
    });
    if (!stage) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_004);
    return stage;
  }

  private async resolveInitialStage(
    dto: CreateCrmOpportunityDto,
  ): Promise<StageRow> {
    if (dto.stage_id) {
      const stage = await this.findStage(dto.stage_id);
      if (
        !stage.is_active ||
        (dto.pipeline_id && stage.pipeline_id !== dto.pipeline_id)
      ) {
        throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_002);
      }
      return stage;
    }
    const pipelines = await this.listPipelines();
    const pipeline = dto.pipeline_id
      ? pipelines.find((row) => row.id === dto.pipeline_id)
      : (pipelines.find((row) => row.is_default) ?? pipelines[0]);
    const stage = pipeline?.stages.find(
      (row) => row.is_active && row.kind === 'open',
    );
    if (!stage) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_001);
    return stage;
  }

  private async applyStage(
    viewer: CrmViewer,
    current: OpportunityRow,
    stage: StageRow,
    options: { sort_order?: number; lost_reason?: string },
  ) {
    const now = new Date();
    const data: Prisma.crm_opportunitiesUncheckedUpdateManyInput = {
      stage_id: stage.id,
    };
    if (options.sort_order !== undefined) {
      data.sort_order = options.sort_order;
    } else if (stage.id !== current.stage_id) {
      const last = await this.prisma.crm_opportunities.findFirst({
        where: { stage_id: stage.id },
        orderBy: { sort_order: 'desc' },
        select: { sort_order: true },
      });
      data.sort_order = last ? last.sort_order + 1 : 0;
    }

    if (stage.kind === 'won') {
      data.status = 'won';
      data.won_at = current.status === 'won' ? current.won_at : now;
      data.lost_at = null;
      data.lost_reason = null;
    } else if (stage.kind === 'lost') {
      const reason = options.lost_reason?.trim() || current.lost_reason;
      if (!reason) throw new VendixHttpException(ErrorCodes.CRM_PIPELINE_003);
      data.status = 'lost';
      data.lost_at = current.status === 'lost' ? current.lost_at : now;
      data.lost_reason = reason;
      data.won_at = null;
    } else {
      data.status = 'open';
      data.won_at = null;
      data.lost_at = null;
      data.lost_reason = null;
    }

    await this.prisma.crm_opportunities.updateMany({
      where: { id: current.id },
      data,
    });
    await this.syncCustomerStage(current.customer_id, stage.id);
    if (data.status !== current.status) {
      await this.auditChange(
        viewer,
        current.id,
        'crm_opportunity_status',
        { status: current.status, stage_id: current.stage_id },
        { status: data.status, stage_id: stage.id, lost_reason: data.lost_reason },
      );
    }
    return this.toOpportunity(await this.findVisible(viewer, current.id));
  }

  /**
   * The customer follows the stage of its last placed opportunity, so the
   * profile and the segment rule `stage` read the same place as the board.
   */
  private async syncCustomerStage(customerId: number, stageId: number) {
    await this.prisma.store_users.updateMany({
      where: { user_id: customerId },
      data: { crm_stage_id: stageId },
    });
  }

  private async findVisible(
    viewer: CrmViewer,
    id: number,
  ): Promise<OpportunityRow> {
    const row = await this.prisma.crm_opportunities.findFirst({
      where: { AND: [{ id }, this.visibility(viewer)] },
      include: OPPORTUNITY_INCLUDE,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_001);
    return row;
  }

  /** Without see-all an opportunity can only be owned by its creator. */
  private async assertOwner(viewer: CrmViewer, ownerId: number | null) {
    if (ownerId === viewer.user_id) return;
    if (!viewer.can_see_all) {
      throw new VendixHttpException(ErrorCodes.CRM_ASSIGN_001);
    }
    if (
      ownerId !== null &&
      !(await isActiveStoreStaff(
        this.prisma,
        ownerId,
        CRM_PIPELINE_READ_PERMISSION,
      ))
    ) {
      throw new VendixHttpException(ErrorCodes.CRM_STAFF_001);
    }
  }

  /** The quotation is of this store and of the same customer (or none). */
  private async assertQuotation(quotationId: number, customerId: number) {
    const quotation = await this.prisma.quotations.findFirst({
      where: { id: quotationId },
      select: { customer_id: true },
    });
    if (
      !quotation ||
      (quotation.customer_id !== null && quotation.customer_id !== customerId)
    ) {
      throw new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_002);
    }
  }

  private auditChange(
    viewer: CrmViewer,
    id: number,
    reason: string,
    oldValues: Record<string, unknown>,
    newValues: Record<string, unknown>,
  ) {
    return this.audit.log({
      userId: viewer.user_id,
      storeId: viewer.store_id,
      action: 'UPDATE',
      resource: 'crm_opportunities',
      resourceId: id,
      oldValues,
      newValues,
      metadata: { reason },
    });
  }

  private mapStageUnique(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new VendixHttpException(ErrorCodes.CRM_PIPELINE_005);
    }
    return error;
  }

  private toOpportunity(row: OpportunityRow) {
    return {
      id: row.id,
      title: row.title,
      amount: row.amount?.toString() ?? null,
      currency: row.currency,
      status: row.status,
      probability: row.stage?.probability ?? null,
      pipeline_id: row.pipeline_id,
      stage_id: row.stage_id,
      stage: row.stage,
      customer: row.customer,
      owner: row.owner,
      quotation: row.quotation,
      order_id: row.order_id,
      expected_close_date: row.expected_close_date
        ? row.expected_close_date.toISOString().slice(0, 10)
        : null,
      won_at: row.won_at,
      lost_at: row.lost_at,
      lost_reason: row.lost_reason,
      sort_order: row.sort_order,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
