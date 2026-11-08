import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import {
  WorkflowDefinitionV1,
  WorkflowStageDef,
  findStage,
  stageFormKeys,
} from '@common/workflows/contract';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { quickOutcomes } from '../engine/workflow-move-rules';

export interface InboxQuery {
  page?: number;
  limit?: number;
  status?: 'open' | 'claimed';
  overdue?: boolean;
  definition_id?: number;
}

type Json = Record<string, any>;

/**
 * "Mis tareas": open tasks the caller can act on — assigned to them, or
 * unclaimed for one of their roles or work groups. Indexed task filter, then
 * one batched load of instances, versions, definitions and names.
 */
@Injectable()
export class WorkflowInboxService {
  constructor(private readonly prisma: StorePrismaService) {}

  async list(query: InboxQuery = {}) {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_TASK_FORBIDDEN);
    }
    const store_id = c.store_id;
    const user_id = c.user_id;
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));

    const [memberships, userRoles] = await Promise.all([
      this.prisma.work_group_members.findMany({
        where: { store_id, user_id },
        select: { work_group_id: true },
      }),
      this.prisma.user_roles.findMany({
        where: { user_id, OR: [{ store_id }, { store_id: null }] },
        select: { role_id: true },
      }),
    ]);
    const groupIds = memberships.map((m: any) => m.work_group_id as number);
    const roleIds = userRoles.map((r: any) => r.role_id as number).filter(Boolean);

    const mine: Json[] = [{ assignee_user_id: user_id }];
    const unclaimed: Json[] = [];
    if (groupIds.length) unclaimed.push({ assignee_group_id: { in: groupIds } });
    if (roleIds.length) unclaimed.push({ assignee_role_id: { in: roleIds } });
    // Unclaimed work only counts while nobody took it.
    const reachable: Json[] = [...mine];
    if (unclaimed.length) {
      reachable.push({ assignee_user_id: null, status: 'open', OR: unclaimed });
    }

    const and: Json[] = [
      { store_id },
      { status: query.status ? query.status : { in: ['open', 'claimed'] } },
      { OR: reachable },
    ];
    if (query.overdue) and.push({ due_at: { lt: new Date() } });
    if (query.definition_id) {
      const instances = await this.prisma.workflow_instances.findMany({
        where: { store_id, definition_id: query.definition_id, status: 'active' },
        select: { id: true },
      });
      and.push({ instance_id: { in: instances.map((i: any) => i.id) } });
    }
    const where = { AND: and };
    const [tasks, total] = await Promise.all([
      this.prisma.workflow_tasks.findMany({
        where,
        orderBy: [{ due_at: { sort: 'asc', nulls: 'last' } }, { created_at: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workflow_tasks.count({ where }),
    ]);

    const instanceIds = [...new Set(tasks.map((t: any) => t.instance_id as number))];
    const instances = instanceIds.length
      ? await this.prisma.workflow_instances.findMany({
          where: { store_id, id: { in: instanceIds } },
        })
      : [];
    const byInstance = new Map<number, any>(instances.map((i: any) => [i.id, i]));
    const versionIds = [...new Set(instances.map((i: any) => i.version_id as number))];
    const definitionIds = [...new Set(instances.map((i: any) => i.definition_id as number))];
    const [versions, definitions] = await Promise.all([
      versionIds.length
        ? this.prisma.workflow_versions.findMany({
            where: { store_id, id: { in: versionIds } },
            select: { id: true, definition: true },
          })
        : [],
      definitionIds.length
        ? this.prisma.workflow_definitions.findMany({
            where: { store_id, id: { in: definitionIds } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const versionDef = new Map<number, WorkflowDefinitionV1>(
      versions.map((v: any) => [v.id, v.definition as WorkflowDefinitionV1]),
    );
    const defName = new Map<number, string>(definitions.map((d: any) => [d.id, d.name]));
    const names = await this.assigneeNames(store_id, tasks);

    const now = Date.now();
    const data = tasks.flatMap((t: any) => {
      const instance = byInstance.get(t.instance_id);
      if (!instance) return [];
      const definition = versionDef.get(instance.version_id);
      const stage = definition ? findStage(definition, t.stage_key) : undefined;
      const quick =
        definition && stage ? quickOutcomes(definition, stage, instance.data ?? {}) : [];
      return [
        {
          task_id: t.id,
          kind: t.kind,
          status: t.status,
          due_at: t.due_at,
          overdue: !!t.due_at && new Date(t.due_at).getTime() < now,
          stage_key: t.stage_key,
          stage_name: stage?.name ?? null,
          // P2.1: branch of a parallel stage.
          branch_key: t.branch_key ?? null,
          branch_name: t.branch_key
            ? (stage?.parallel?.branches.find((b) => b.key === t.branch_key)?.name ?? null)
            : null,
          instance: {
            id: instance.id,
            reference: instance.reference,
            title: instance.title,
            row_version: instance.row_version,
          },
          definition: {
            id: instance.definition_id,
            name: defName.get(instance.definition_id) ?? null,
          },
          assignee: this.assignee(t, names),
          // P5.5: what the mobile list needs to act without opening the detail.
          stage_type: stage?.type ?? null,
          has_form: !!stage && stageFormKeys(stage).length > 0,
          quick_outcomes: quick,
          comment_outcomes:
            definition && stage ? this.commentOutcomes(definition, stage, instance.data ?? {}, quick) : [],
        },
      ];
    });
    return { data, total, page, limit };
  }

  /** Outcomes that would be quick if only the mandatory comment were given. */
  private commentOutcomes(
    definition: WorkflowDefinitionV1,
    stage: WorkflowStageDef,
    data: Record<string, unknown>,
    quick: string[],
  ): string[] {
    const withoutComment: WorkflowStageDef = {
      ...stage,
      transitions: (stage.transitions ?? []).map((t) => ({ ...t, require_comment: false })),
    };
    return quickOutcomes(definition, withoutComment, data).filter((o) => !quick.includes(o));
  }

  private assignee(t: any, names: { users: Map<number, string>; roles: Map<number, string>; groups: Map<number, string> }) {
    if (t.assignee_user_id) {
      return { type: 'user', id: t.assignee_user_id, name: names.users.get(t.assignee_user_id) ?? null };
    }
    if (t.assignee_group_id) {
      return { type: 'group', id: t.assignee_group_id, name: names.groups.get(t.assignee_group_id) ?? null };
    }
    if (t.assignee_role_id) {
      return { type: 'role', id: t.assignee_role_id, name: names.roles.get(t.assignee_role_id) ?? null };
    }
    return null;
  }

  private async assigneeNames(storeId: number, tasks: any[]) {
    const ids = (k: string) => [
      ...new Set(tasks.map((t) => t[k] as number | null).filter((v): v is number => !!v)),
    ];
    const [userIds, roleIds, groupIds] = [
      ids('assignee_user_id'),
      ids('assignee_role_id'),
      ids('assignee_group_id'),
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
    return {
      users: new Map<number, string>(
        users.map((u: any): [number, string] => [u.id, `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()]),
      ),
      roles: new Map<number, string>(roles.map((r: any): [number, string] => [r.id, r.name])),
      groups: new Map<number, string>(groups.map((g: any): [number, string] => [g.id, g.name])),
    };
  }
}
