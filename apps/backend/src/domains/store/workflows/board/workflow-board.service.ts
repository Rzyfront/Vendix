import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { WorkflowDefinitionV1, WorkflowStageDef, findStage } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAccessPolicy } from '../access/workflow-access.policy';
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

export interface BoardAllQuery {
  column?: BoardAllColumn;
  cursor?: number;
  limit?: number;
  definition_id?: number;
  role_id?: number;
  location_id?: number;
  assignee_user_id?: number;
  overdue?: boolean;
}

export type BoardAllColumn = 'pending' | 'in_progress' | 'system' | 'closed';

const ALL_COLUMNS: Array<{ key: BoardAllColumn; name: string }> = [
  { key: 'pending', name: 'Por atender' },
  { key: 'in_progress', name: 'En curso' },
  { key: 'system', name: 'En espera (sistema)' },
  { key: 'closed', name: 'Cerradas (30 días)' },
];
/** Roles shown in the filter besides the store's own: the ones the templates assign to. */
const SYSTEM_FILTER_ROLES = ['owner', 'admin', 'manager', 'employee'];

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
  private readonly access: WorkflowAccessPolicy;

  // The policy only needs the store-scoped Prisma client (see the definitions service).
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly instances: WorkflowInstancesService,
    private readonly requirements: WorkflowRequirementsService,
  ) {
    this.access = new WorkflowAccessPolicy(prisma);
  }

  async board(definitionId: number, query: BoardQuery = {}) {
    const c = RequestContextService.getContext();
    if (!c?.store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    const store_id = c.store_id;
    // P7.3: a flow the caller may not see has no board.
    await this.access.assertCanView(definitionId);
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

  /**
   * P5.5: one board over every flow the caller may see. A request sits in
   * "Por atender" while it has an unclaimed open task, in "En curso" while
   * someone holds a claimed one, in "En espera (sistema)" when it is active
   * with no human task, and in "Cerradas" for 30 days after it finished.
   */
  async boardAll(query: BoardAllQuery = {}) {
    const c = RequestContextService.getContext();
    if (!c?.store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const store_id = c.store_id;
    await this.assertFilterIds(store_id, c.organization_id, query);
    const now = new Date();
    const limit = Math.min(50, Math.max(1, query.limit ?? BOARD_PAGE));

    const base = await this.allBaseWhere(store_id, query, now);
    const open: Array<{ instance_id: number; status: string }> =
      await this.prisma.workflow_tasks.findMany({
        where: { store_id, status: { in: OPEN } },
        select: { instance_id: true, status: true },
      });
    const pendingIds = new Set(open.filter((t) => t.status === 'open').map((t) => t.instance_id));
    const claimedIds = new Set(
      open.filter((t) => t.status === 'claimed' && !pendingIds.has(t.instance_id)).map((t) => t.instance_id),
    );
    const humanIds = [...new Set(open.map((t) => t.instance_id))];
    const closedSince = new Date(now.getTime() - BOARD_CLOSED_DAYS * 86_400_000);
    const columnWhere: Record<BoardAllColumn, Json[]> = {
      pending: [{ status: 'active' }, { id: { in: [...pendingIds] } }],
      in_progress: [{ status: 'active' }, { id: { in: [...claimedIds] } }],
      system: [{ status: 'active' }, { id: { notIn: humanIds } }],
      closed: [
        { status: { in: ['completed', 'rejected', 'cancelled'] } },
        { completed_at: { gte: closedSince } },
      ],
    };
    const wanted = query.column ? ALL_COLUMNS.filter((x) => x.key === query.column) : ALL_COLUMNS;
    const columns = await Promise.all(
      wanted.map(async (spec) => {
        const where = { AND: [...base, ...columnWhere[spec.key]] };
        const [count, rows] = await Promise.all([
          this.prisma.workflow_instances.count({ where }),
          this.prisma.workflow_instances.findMany({
            where: { AND: [...base, ...columnWhere[spec.key], ...(query.cursor ? [{ id: { lt: query.cursor } }] : [])] },
            orderBy: { id: 'desc' },
            take: limit + 1,
          }),
        ]);
        const hasMore = rows.length > limit;
        const page: Json[] = hasMore ? rows.slice(0, limit) : rows;
        return {
          key: spec.key,
          name: spec.name,
          count,
          cards: await this.allCards(store_id, page, now),
          next_cursor: hasMore ? page[page.length - 1].id : null,
        };
      }),
    );
    return { columns };
  }

  /** Options for the filters of the general board; ids are the filter values. */
  async filters() {
    const c = RequestContextService.getContext();
    if (!c?.store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const store_id = c.store_id;
    const [definitions, roles, locations] = await Promise.all([
      this.prisma.workflow_definitions.findMany({
        where: { store_id, status: 'active', ...(await this.access.visibleDefinitionsWhere()) },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.withoutScope().roles.findMany({
        where: {
          OR: [
            { organization_id: null },
            { organization_id: c.organization_id, OR: [{ store_id: null }, { store_id }] },
          ],
        },
        select: { id: true, name: true, is_system_role: true },
        orderBy: { name: 'asc' },
      }),
      this.locations(),
    ]);
    return {
      definitions: definitions.map((d: Json) => ({ id: d.id, name: d.name })),
      roles: roles
        .filter((r: Json) => !r.is_system_role || SYSTEM_FILTER_ROLES.includes(r.name))
        .map((r: Json) => ({ id: r.id, name: r.name })),
      locations,
    };
  }

  /** Active branches of the store (`inventory_locations`). */
  async locations(): Promise<Array<{ id: number; name: string }>> {
    const store_id = RequestContextService.getStoreId();
    if (!store_id) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    const rows: Json[] = await this.prisma.inventory_locations.findMany({
      where: { store_id, is_active: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return rows.map((l) => ({ id: l.id, name: l.name }));
  }

  /** Filter ids from another store (or unknown) are a 404, never an empty board. */
  private async assertFilterIds(
    store_id: number,
    organization_id: number | undefined,
    query: BoardAllQuery,
  ): Promise<void> {
    if (query.definition_id) {
      const row = await this.prisma.workflow_definitions.findFirst({
        where: { id: query.definition_id, store_id },
        select: { id: true },
      });
      if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
      await this.access.assertCanView(query.definition_id);
    }
    if (query.location_id) {
      const row = await this.prisma.inventory_locations.findFirst({
        where: { id: query.location_id, store_id },
        select: { id: true },
      });
      if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    }
    if (query.role_id) {
      const row = await this.prisma.withoutScope().roles.findFirst({
        where: {
          id: query.role_id,
          OR: [
            { organization_id: null },
            { organization_id, OR: [{ store_id: null }, { store_id }] },
          ],
        },
        select: { id: true },
      });
      if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    }
  }

  /** Store + visibility + filters; the column adds its own status condition. */
  private async allBaseWhere(store_id: number, query: BoardAllQuery, now: Date): Promise<Json[]> {
    const and: Json[] = [...(await this.instances.visibleWhere())];
    if (query.definition_id) and.push({ definition_id: query.definition_id });
    if (query.location_id) and.push({ location_id: query.location_id });
    if (query.overdue) and.push({ status: 'active' }, { stage_due_at: { lt: now } });
    const taskFilter: Json = {};
    if (query.role_id) taskFilter.assignee_role_id = query.role_id;
    if (query.assignee_user_id) taskFilter.assignee_user_id = query.assignee_user_id;
    if (Object.keys(taskFilter).length) {
      const tasks = await this.prisma.workflow_tasks.findMany({
        where: { store_id, status: { in: OPEN }, ...taskFilter },
        select: { instance_id: true },
      });
      and.push({ id: { in: tasks.map((t: Json) => t.instance_id) } });
    }
    return and;
  }

  private async allCards(store_id: number, page: Json[], now: Date) {
    if (!page.length) return [];
    const ids = (k: string) => [...new Set(page.map((r) => r[k] as number | null).filter((v): v is number => !!v))];
    const [assignees, definitions, versions, locations] = await Promise.all([
      this.assignees(page.map((r) => r.id)),
      this.prisma.workflow_definitions.findMany({
        where: { store_id, id: { in: ids('definition_id') } },
        select: { id: true, name: true },
      }),
      this.prisma.workflow_versions.findMany({
        where: { store_id, id: { in: ids('version_id') } },
        select: { id: true, definition: true },
      }),
      ids('location_id').length
        ? this.prisma.inventory_locations.findMany({
            where: { store_id, id: { in: ids('location_id') } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const defName = new Map<number, string>(definitions.map((d: Json) => [d.id, d.name]));
    const versionDef = new Map<number, WorkflowDefinitionV1>(
      versions.map((v: Json) => [v.id, v.definition as WorkflowDefinitionV1]),
    );
    const locationName = new Map<number, string>(locations.map((l: Json) => [l.id, l.name]));
    return page.map((r) => {
      const def = versionDef.get(r.version_id);
      return {
        id: r.id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        definition: { id: r.definition_id, name: defName.get(r.definition_id) ?? null },
        stage_key: r.current_stage_key,
        stage_name: (def ? findStage(def, r.current_stage_key)?.name : null) ?? null,
        assignee: assignees.get(r.id) ?? null,
        stage_due_at: r.stage_due_at,
        overdue: r.status === 'active' && !!r.stage_due_at && new Date(r.stage_due_at) < now,
        location: r.location_id
          ? { id: r.location_id, name: locationName.get(r.location_id) ?? null }
          : null,
      };
    });
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
