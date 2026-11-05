import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, WorkflowStageDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { hasBlockingRequirement, stageMoves } from '../engine/workflow-move-rules';
import { WorkflowRequirementsService } from '../engine/workflow-engine.types';
import { WorkflowInstancesService } from '../instances/workflow-instances.service';

export interface BoardQuery {
  column?: string;
  cursor?: number;
  limit?: number;
  assignee_user_id?: number;
  overdue?: boolean;
  from?: string | Date;
  to?: string | Date;
}

export const BOARD_PAGE = 20;
/** Finished instances stay on the board this long. */
export const BOARD_CLOSED_DAYS = 30;
const OPEN = ['open', 'claimed'];
type Json = Record<string, any>;

interface ColumnSpec {
  stage_key: string;
  name: string;
  type: string | null;
  legacy: boolean;
  stage: WorkflowStageDef | null;
}

/**
 * Kanban of one flow: a column per stage of the PUBLISHED version. Instances
 * still running an older version sit under their `current_stage_key`; keys
 * that no longer exist go to an extra "legacy" column. Counts come from one
 * `groupBy` on `(store_id, definition_id, status, current_stage_key)`.
 */
@Injectable()
export class WorkflowBoardService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly instances: WorkflowInstancesService,
    private readonly requirements: WorkflowRequirementsService,
  ) {}

  async board(definitionId: number, query: BoardQuery = {}) {
    const c = RequestContextService.getContext();
    if (!c?.store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    const store_id = c.store_id;
    const definitionRow = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id },
      select: { id: true, name: true, published_version_id: true },
    });
    if (!definitionRow) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    const version = definitionRow.published_version_id
      ? await this.prisma.workflow_versions.findFirst({
          where: { id: definitionRow.published_version_id, store_id },
          select: { id: true, version: true, definition: true },
        })
      : null;
    const header = {
      id: definitionRow.id,
      name: definitionRow.name,
      version: version?.version ?? null,
    };
    if (!version) return { definition: header, columns: [] };
    const definition = version.definition as WorkflowDefinitionV1;

    const base = await this.baseWhere(definitionId, query);
    const now = new Date();
    const limit = Math.min(50, Math.max(1, query.limit ?? BOARD_PAGE));

    const [counts, overdue] = await Promise.all([
      this.prisma.workflow_instances.groupBy({
        by: ['current_stage_key'],
        where: { AND: base },
        _count: { _all: true },
      }),
      this.prisma.workflow_instances.groupBy({
        by: ['current_stage_key'],
        where: { AND: [...base, { status: 'active' }, { stage_due_at: { lt: now } }] },
        _count: { _all: true },
      }),
    ]);
    const countOf = new Map<string, number>(
      counts.map((r: any) => [r.current_stage_key, r._count._all]),
    );
    const overdueOf = new Map<string, number>(
      overdue.map((r: any) => [r.current_stage_key, r._count._all]),
    );

    const known = new Set(definition.stages.map((s) => s.key));
    const specs: ColumnSpec[] = definition.stages.map((s) => ({
      stage_key: s.key,
      name: s.name,
      type: s.type,
      legacy: false,
      stage: s,
    }));
    for (const key of [...countOf.keys()].sort()) {
      if (!known.has(key)) {
        specs.push({
          stage_key: key,
          name: `${key} (versión anterior)`,
          type: null,
          legacy: true,
          stage: null,
        });
      }
    }
    const wanted = query.column ? specs.filter((s) => s.stage_key === query.column) : specs;
    const columns = await Promise.all(
      wanted.map(async (spec) => {
        const count = countOf.get(spec.stage_key) ?? 0;
        const page =
          count > 0 ? await this.cards(base, spec, query.cursor, limit, now) : null;
        return {
          stage_key: spec.stage_key,
          name: spec.name,
          type: spec.type,
          ...(spec.legacy ? { legacy: true } : {}),
          count,
          overdue_count: overdueOf.get(spec.stage_key) ?? 0,
          moves: spec.stage ? stageMoves(spec.stage) : [],
          cards: page?.cards ?? [],
          next_cursor: page?.next_cursor ?? null,
        };
      }),
    );
    return { definition: header, columns };
  }

  /** Store + visibility + filters + the 30-day window of finished instances. */
  private async baseWhere(definitionId: number, query: BoardQuery): Promise<Json[]> {
    const and: Json[] = [
      ...(await this.instances.visibleWhere()),
      { definition_id: definitionId },
      {
        OR: [
          { status: 'active' },
          {
            status: { in: ['completed', 'rejected'] },
            completed_at: { gte: new Date(Date.now() - BOARD_CLOSED_DAYS * 86_400_000) },
          },
        ],
      },
    ];
    const storeId = RequestContextService.getStoreId();
    if (query.overdue) and.push({ status: 'active' }, { stage_due_at: { lt: new Date() } });
    if (query.from) and.push({ created_at: { gte: new Date(query.from) } });
    if (query.to) and.push({ created_at: { lte: new Date(query.to) } });
    if (query.assignee_user_id) {
      const tasks = await this.prisma.workflow_tasks.findMany({
        where: {
          store_id: storeId,
          status: { in: OPEN },
          assignee_user_id: query.assignee_user_id,
        },
        select: { instance_id: true },
      });
      and.push({ id: { in: tasks.map((t: any) => t.instance_id) } });
    }
    return and;
  }

  private async cards(
    base: Json[],
    spec: ColumnSpec,
    cursor: number | undefined,
    limit: number,
    now: Date,
  ) {
    const rows: any[] = await this.prisma.workflow_instances.findMany({
      where: {
        AND: [
          ...base,
          { current_stage_key: spec.stage_key },
          ...(cursor ? [{ id: { lt: cursor } }] : []),
        ],
      },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const versionIds = [...new Set(page.map((r) => r.version_id as number))];
    const [assignees, versionRows] = await Promise.all([
      this.assignees(page.map((r) => r.id)),
      this.prisma.workflow_versions.findMany({
        where: { store_id: RequestContextService.getStoreId(), id: { in: versionIds } },
        select: { id: true, version: true },
      }),
    ]);
    const versionNumber = new Map<number, number>(versionRows.map((v: any) => [v.id, v.version]));
    const blocking = spec.stage && hasBlockingRequirement(spec.stage);
    const pending = new Map<number, boolean>();
    if (blocking && spec.stage) {
      await Promise.all(
        page
          .filter((r) => r.status === 'active')
          .map(async (r) => {
            const missing = await this.requirements.pendingRequirements(
              r,
              spec.stage as WorkflowStageDef,
              this.prisma,
            );
            pending.set(r.id, missing.length > 0);
          }),
      );
    }
    return {
      cards: page.map((r) => ({
        id: r.id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        version: versionNumber.get(r.version_id) ?? null,
        stage_entered_at: r.stage_entered_at,
        stage_due_at: r.stage_due_at,
        overdue: r.status === 'active' && !!r.stage_due_at && new Date(r.stage_due_at) < now,
        assignee: assignees.get(r.id) ?? null,
        has_pending_requirements: pending.get(r.id) ?? false,
        row_version: r.row_version,
      })),
      next_cursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Display name of whoever holds the open task of each instance. */
  private async assignees(instanceIds: number[]): Promise<Map<number, Json>> {
    const out = new Map<number, Json>();
    if (!instanceIds.length) return out;
    const storeId = RequestContextService.getStoreId();
    const tasks: any[] = await this.prisma.workflow_tasks.findMany({
      where: { store_id: storeId, instance_id: { in: instanceIds }, status: { in: OPEN } },
      orderBy: { id: 'asc' },
    });
    const pick = (k: string) => [
      ...new Set(tasks.map((t) => t[k] as number | null).filter((v): v is number => !!v)),
    ];
    const [userIds, roleIds, groupIds] = [
      pick('assignee_user_id'),
      pick('assignee_role_id'),
      pick('assignee_group_id'),
    ];
    const [users, roles, groups] = await Promise.all([
      userIds.length
        ? this.prisma.withoutScope().users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, first_name: true, last_name: true },
          })
        : [],
      roleIds.length
        ? this.prisma.withoutScope().roles.findMany({
            where: { id: { in: roleIds } },
            select: { id: true, name: true },
          })
        : [],
      groupIds.length
        ? this.prisma.work_groups.findMany({
            where: { store_id: storeId, id: { in: groupIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const label = (list: any[], id: number, f: (r: any) => string) => {
      const r = list.find((x) => x.id === id);
      return r ? f(r) : null;
    };
    for (const t of tasks) {
      if (out.has(t.instance_id)) continue;
      if (t.assignee_user_id) {
        out.set(t.instance_id, {
          type: 'user',
          id: t.assignee_user_id,
          name: label(users, t.assignee_user_id, (u) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()),
        });
      } else if (t.assignee_group_id) {
        out.set(t.instance_id, { type: 'group', id: t.assignee_group_id, name: label(groups, t.assignee_group_id, (g) => g.name) });
      } else if (t.assignee_role_id) {
        out.set(t.instance_id, { type: 'role', id: t.assignee_role_id, name: label(roles, t.assignee_role_id, (r) => r.name) });
      }
    }
    return out;
  }
}
