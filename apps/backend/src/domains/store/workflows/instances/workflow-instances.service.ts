import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  findStage,
  isHumanStage,
  stageOutcomes,
  visibleFieldKeys,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { DossiersService } from '../../documents/dossiers.service';
import { WorkflowAssignmentService } from '../engine/workflow-assignment.service';
import {
  WorkflowInstanceRow,
  WorkflowRequirementsService,
  WorkflowTaskRow,
} from '../engine/workflow-engine.types';

export interface ListInstancesInput {
  page?: number;
  limit?: number;
  definition_id?: number;
  status?: string;
  stage_key?: string;
  assignee_user_id?: number;
  overdue?: boolean;
  from?: string | Date;
  to?: string | Date;
  search?: string;
}

const OPEN = ['open', 'claimed'];
export const COMMENTS_IN_DETAIL = 50;
type Json = Record<string, any>;

/** Read model of Flujos instances (writes live in `WorkflowEngineService`). */
@Injectable()
export class WorkflowInstancesService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly requirements: WorkflowRequirementsService,
    private readonly dossiers: DossiersService,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
      sees_all:
        !!c.is_owner ||
        !!c.is_super_admin ||
        (c.permissions ?? []).includes('store:workflows:manage'),
    };
  }

  /**
   * §5.5: `manage`/owner see everything; `read` only sees what the user took
   * part in (started, has or had a task, voted) or what sits in a stage
   * assigned to their role or group. Returns `null` for "no restriction".
   */
  private async visibility(c: ReturnType<WorkflowInstancesService['ctx']>) {
    if (c.sees_all) return null;
    if (c.user_id === null) return { id: { in: [] as number[] } };
    const { store_id, user_id } = c;
    const [memberships, userRoles, votes, mine] = await Promise.all([
      this.prisma.work_group_members.findMany({
        where: { store_id, user_id },
        select: { work_group_id: true },
      }),
      this.prisma.user_roles.findMany({
        where: { user_id, OR: [{ store_id }, { store_id: null }] },
        select: { role_id: true },
      }),
      this.prisma.workflow_task_votes.findMany({
        where: { store_id, user_id },
        select: { task_id: true },
      }),
      this.prisma.workflow_tasks.findMany({
        where: {
          store_id,
          OR: [{ assignee_user_id: user_id }, { completed_by_user_id: user_id }],
        },
        select: { instance_id: true },
      }),
    ]);
    const groupIds = memberships.map((m: any) => m.work_group_id);
    const roleIds = userRoles.map((r: any) => r.role_id).filter(Boolean);
    const stageOr: Json[] = [];
    if (groupIds.length) stageOr.push({ assignee_group_id: { in: groupIds } });
    if (roleIds.length) stageOr.push({ assignee_role_id: { in: roleIds } });
    const [inStage, voted] = await Promise.all([
      stageOr.length
        ? this.prisma.workflow_tasks.findMany({
            where: { store_id, status: { in: OPEN }, OR: stageOr },
            select: { instance_id: true },
          })
        : [],
      votes.length
        ? this.prisma.workflow_tasks.findMany({
            where: { store_id, id: { in: votes.map((v: any) => v.task_id) } },
            select: { instance_id: true },
          })
        : [],
    ]);
    const ids = new Set<number>(
      [...mine, ...inStage, ...voted].map((t: any) => t.instance_id),
    );
    return {
      OR: [
        { started_by_type: 'user', started_by_id: user_id },
        { id: { in: [...ids] } },
      ],
    };
  }

  /**
   * Store scope plus the participation rule of the caller, ready to `AND` into
   * a `workflow_instances` where. Shared by the board so it never diverges.
   */
  async visibleWhere(): Promise<Json[]> {
    const c = this.ctx();
    const visible = await this.visibility(c);
    return [{ store_id: c.store_id }, ...(visible ? [visible] : [])];
  }

  /** Whether the current caller may see the instance (same rule as `get`). */
  async canSee(id: number): Promise<boolean> {
    const c = this.ctx();
    const visible = await this.visibility(c);
    const row = await this.prisma.workflow_instances.findFirst({
      where: { AND: [{ id, store_id: c.store_id }, ...(visible ? [visible] : [])] },
      select: { id: true },
    });
    return !!row;
  }

  async list(input: ListInstancesInput = {}) {
    const c = this.ctx();
    const page = Math.max(1, input.page ?? 1);
    const limit = Math.min(100, Math.max(1, input.limit ?? 10));
    const and: Json[] = [{ store_id: c.store_id }];
    const visible = await this.visibility(c);
    if (visible) and.push(visible);
    if (input.definition_id) and.push({ definition_id: input.definition_id });
    if (input.status) and.push({ status: input.status });
    if (input.stage_key) and.push({ current_stage_key: input.stage_key });
    if (input.overdue) {
      and.push({ status: 'active' }, { stage_due_at: { lt: new Date() } });
    }
    if (input.from) and.push({ created_at: { gte: new Date(input.from) } });
    if (input.to) and.push({ created_at: { lte: new Date(input.to) } });
    if (input.search?.trim()) {
      const q = input.search.trim();
      and.push({
        OR: [
          { reference: { contains: q, mode: 'insensitive' } },
          { title: { contains: q, mode: 'insensitive' } },
        ],
      });
    }
    if (input.assignee_user_id) {
      const tasks = await this.prisma.workflow_tasks.findMany({
        where: {
          store_id: c.store_id,
          status: { in: OPEN },
          assignee_user_id: input.assignee_user_id,
        },
        select: { instance_id: true },
      });
      and.push({ id: { in: tasks.map((t: any) => t.instance_id) } });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.prisma.workflow_instances.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workflow_instances.count({ where }),
    ]);
    const [defs, versions] = await Promise.all([
      this.byId('workflow_definitions', c.store_id, rows.map((r: any) => r.definition_id), {
        id: true,
        key: true,
        name: true,
      }),
      this.byId('workflow_versions', c.store_id, rows.map((r: any) => r.version_id), {
        id: true,
        version: true,
        definition: true,
      }),
    ]);
    const now = Date.now();
    const data = rows.map((r: WorkflowInstanceRow) => {
      const def = versions.get(r.version_id)?.definition as WorkflowDefinitionV1 | undefined;
      const stage = def ? findStage(def, r.current_stage_key) : undefined;
      return {
        id: r.id,
        reference: r.reference,
        title: r.title,
        status: r.status,
        definition_id: r.definition_id,
        definition_name: defs.get(r.definition_id)?.name ?? null,
        version: versions.get(r.version_id)?.version ?? null,
        current_stage_key: r.current_stage_key,
        current_stage_name: stage?.name ?? null,
        stage_entered_at: r.stage_entered_at,
        stage_due_at: r.stage_due_at,
        overdue:
          r.status === 'active' && !!r.stage_due_at && new Date(r.stage_due_at).getTime() < now,
        started_by_type: r.started_by_type,
        started_by_id: r.started_by_id,
        subject_type: r.subject_type,
        subject_id: r.subject_id,
        created_at: (r as any).created_at,
        completed_at: r.completed_at,
      };
    });
    return { data, total, page, limit };
  }

  async get(id: number) {
    const c = this.ctx();
    const visible = await this.visibility(c);
    const instance: WorkflowInstanceRow | null =
      await this.prisma.workflow_instances.findFirst({
        where: { AND: [{ id, store_id: c.store_id }, ...(visible ? [visible] : [])] },
      });
    if (!instance) throw new VendixHttpException(ErrorCodes.WORKFLOW_NOT_FOUND);

    const [def, version, taskRows, eventRows, commentRows] = await Promise.all([
      this.prisma.workflow_definitions.findFirst({
        where: { id: instance.definition_id, store_id: c.store_id },
        select: { id: true, key: true, name: true },
      }),
      this.prisma.workflow_versions.findFirst({
        where: { id: instance.version_id, store_id: c.store_id },
        select: { id: true, version: true, definition: true },
      }),
      this.prisma.workflow_tasks.findMany({
        where: {
          store_id: c.store_id,
          instance_id: id,
          stage_key: instance.current_stage_key,
          stage_entry_seq: instance.stage_entry_seq,
          status: { in: OPEN },
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.workflow_instance_events.findMany({
        where: { store_id: c.store_id, instance_id: id },
        orderBy: { seq: 'asc' },
      }),
      this.prisma.workflow_instance_comments.findMany({
        where: { store_id: c.store_id, instance_id: id },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: COMMENTS_IN_DETAIL,
      }),
    ]);
    const definition = version?.definition as WorkflowDefinitionV1 | undefined;
    const stage = definition ? findStage(definition, instance.current_stage_key) : undefined;
    const active = instance.status === 'active';
    const human = !!stage && isHumanStage(stage);

    const userIds = new Set<number>();
    for (const t of taskRows) if (t.assignee_user_id) userIds.add(t.assignee_user_id);
    for (const e of eventRows) if (e.actor_type === 'user' && e.actor_id) userIds.add(e.actor_id);
    for (const m of commentRows) userIds.add(m.author_user_id);
    if (instance.started_by_type === 'user' && instance.started_by_id) {
      userIds.add(instance.started_by_id);
    }
    const [users, roles, groups] = await Promise.all([
      this.names('users', [...userIds], (u) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()),
      this.names('roles', taskRows.map((t: any) => t.assignee_role_id), (r) => r.name),
      this.names('work_groups', taskRows.map((t: any) => t.assignee_group_id), (g) => g.name, c.store_id),
    ]);

    const tasks = await Promise.all(
      taskRows.map(async (t: WorkflowTaskRow) => {
        const assignee = t.assignee_user_id
          ? { type: 'user', id: t.assignee_user_id, name: users.get(t.assignee_user_id) ?? null }
          : t.assignee_group_id
            ? { type: 'group', id: t.assignee_group_id, name: groups.get(t.assignee_group_id) ?? null }
            : t.assignee_role_id
              ? { type: 'role', id: t.assignee_role_id, name: roles.get(t.assignee_role_id) ?? null }
              : null;
        const can_act =
          active && c.user_id !== null
            ? await this.assignment.canAct(this.prisma, t, c.user_id, c.store_id, c.organization_id)
            : false;
        return {
          id: t.id,
          kind: t.kind,
          status: t.status,
          stage_key: t.stage_key,
          assignee_user_id: t.assignee_user_id,
          assignee_role_id: t.assignee_role_id,
          assignee_group_id: t.assignee_group_id,
          assignee,
          claimed_at: t.claimed_at,
          due_at: t.due_at,
          can_act,
        };
      }),
    );

    const pending =
      active && stage
        ? await this.requirements.pendingRequirements(instance, stage, this.prisma)
        : [];
    const dossier = await this.dossiers.summaryForInstance(instance.id);
    const outcomes = new Set(stageOutcomes(stage ?? ({ type: 'end' } as any)));
    const allowed_outcomes =
      active && human && stage
        ? [...new Set((stage.transitions ?? []).map((t) => t.on))].filter((o) => outcomes.has(o))
        : [];

    return {
      id: instance.id,
      reference: instance.reference,
      title: instance.title,
      status: instance.status,
      row_version: instance.row_version,
      current_stage_key: instance.current_stage_key,
      stage_entered_at: instance.stage_entered_at,
      stage_due_at: instance.stage_due_at,
      cancel_reason: instance.cancel_reason,
      data: instance.data ?? {},
      subject_type: instance.subject_type,
      subject_id: instance.subject_id,
      started_by: {
        type: instance.started_by_type,
        id: instance.started_by_id,
        name: instance.started_by_id ? (users.get(instance.started_by_id) ?? null) : null,
      },
      created_at: (instance as any).created_at,
      completed_at: instance.completed_at,
      definition: {
        id: def?.id ?? instance.definition_id,
        key: def?.key ?? null,
        name: def?.name ?? null,
        version_id: instance.version_id,
        version: version?.version ?? null,
      },
      stage: stage
        ? {
            key: stage.key,
            name: stage.name,
            type: stage.type,
            description: stage.description ?? null,
            requirements: (stage.requirements ?? []).map((r) => ({
              key: r.key,
              kind: r.kind,
              label: r.label,
              accept: 'accept' in r ? (r.accept ?? null) : null,
              max_size_mb: r.kind === 'upload' ? (r.max_size_mb ?? null) : null,
              blocks_exit:
                r.kind === 'file_field' || r.kind === 'issued_document'
                  ? true
                  : r.blocks_exit !== false,
            })),
            form_fields: definition
              ? visibleFieldKeys(definition, stage, instance.data ?? {})
                  .map((k) => definition.fields.find((f) => f.key === k))
                  .filter(Boolean)
              : [],
          }
        : null,
      tasks,
      timeline: eventRows.map((e: any) => ({
        seq: e.seq,
        type: e.type,
        from_stage_key: e.from_stage_key,
        to_stage_key: e.to_stage_key,
        actor_type: e.actor_type,
        actor_id: e.actor_id,
        actor_name: e.actor_id ? (users.get(e.actor_id) ?? null) : null,
        payload: e.payload ?? {},
        occurred_at: e.occurred_at,
      })),
      comments: [...commentRows].reverse().map((m: any) => ({
        id: m.id,
        body: m.body,
        author: { id: m.author_user_id, name: users.get(m.author_user_id) ?? null },
        created_at: m.created_at,
      })),
      pending_requirements: pending,
      dossier,
      allowed_outcomes,
    };
  }

  // ---- helpers -----------------------------------------------------------

  private async byId(
    table: 'workflow_definitions' | 'workflow_versions',
    storeId: number,
    ids: number[],
    select: Json,
  ): Promise<Map<number, any>> {
    const wanted = [...new Set(ids)];
    const out = new Map<number, any>();
    if (!wanted.length) return out;
    const rows = await (this.prisma as any)[table].findMany({
      where: { id: { in: wanted }, store_id: storeId },
      select,
    });
    for (const r of rows) out.set(r.id, r);
    return out;
  }

  private async names(
    table: 'users' | 'roles' | 'work_groups',
    ids: Array<number | null | undefined>,
    label: (row: any) => string,
    storeId?: number,
  ): Promise<Map<number, string>> {
    const wanted = [...new Set(ids.filter((i): i is number => !!i))];
    const out = new Map<number, string>();
    if (!wanted.length) return out;
    const where: Json = { id: { in: wanted } };
    if (storeId !== undefined) where.store_id = storeId;
    const select =
      table === 'users'
        ? { id: true, first_name: true, last_name: true }
        : { id: true, name: true };
    const rows = await (this.prisma as any)[table].findMany({ where, select });
    for (const r of rows) out.set(r.id, label(r));
    return out;
  }
}
