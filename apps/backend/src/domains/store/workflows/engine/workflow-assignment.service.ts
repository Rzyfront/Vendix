import { Injectable } from '@nestjs/common';
import {
  WorkflowAssigneeDef,
  WorkflowStageDef,
} from '@common/workflows/contract';
import { WorkGroupsService } from '../work-groups.service';
import {
  AssigneeFields,
  AssignmentResult,
  WorkflowInstanceRow,
  WorkflowNotifyPayload,
  WorkflowTaskRow,
  WorkflowTx,
} from './workflow-engine.types';

const NONE: AssigneeFields = {
  assignee_user_id: null,
  assignee_role_id: null,
  assignee_group_id: null,
};
const OPEN_STATUSES = ['open', 'claimed'];

/** Resolves a `WorkflowAssigneeDef` to task assignee fields and to user ids. */
@Injectable()
export class WorkflowAssignmentService {
  constructor(private readonly groups: WorkGroupsService) {}

  /**
   * Assignee fields for a new task. When nobody is available the stage
   * `due.on_overdue.escalate_to` is used, then the store owner role; the
   * result is flagged `unassigned` so the caller writes the `unassigned` event.
   */
  async resolveForStage(
    tx: WorkflowTx,
    stage: WorkflowStageDef,
    instance: WorkflowInstanceRow,
  ): Promise<AssignmentResult> {
    const first = stage.assignee
      ? await this.resolveDef(tx, stage.assignee, instance)
      : { fields: null, reason: 'stage_without_assignee' };
    if (first.fields) return { fields: first.fields, unassigned: false };

    const escalate = stage.due?.on_overdue?.escalate_to;
    if (escalate) {
      const esc = await this.resolveDef(tx, escalate, instance);
      if (esc.fields) {
        return {
          fields: esc.fields,
          unassigned: true,
          reason: first.reason,
          fallback: 'escalate_to',
        };
      }
    }
    const owner = await this.roleFields(tx, 'owner', instance);
    if (owner.fields) {
      return {
        fields: owner.fields,
        unassigned: true,
        reason: first.reason,
        fallback: 'owner',
      };
    }
    return {
      fields: NONE,
      unassigned: true,
      reason: first.reason,
      fallback: 'none',
    };
  }

  /** Same as {@link resolveForStage} for an arbitrary def (escalation). */
  async resolveDef(
    tx: WorkflowTx,
    def: WorkflowAssigneeDef,
    instance: WorkflowInstanceRow,
  ): Promise<{ fields: AssigneeFields | null; reason?: string }> {
    switch (def.kind) {
      case 'initiator':
        return this.userFields(
          tx,
          instance.store_id,
          instance.started_by_type === 'user' ? instance.started_by_id : null,
          'initiator_unavailable',
        );
      case 'user':
        return this.userFields(tx, instance.store_id, def.user_id, 'user_not_in_store');
      case 'field': {
        const raw = (instance.data ?? {})[def.field];
        const id = typeof raw === 'string' ? Number(raw) : raw;
        return this.userFields(
          tx,
          instance.store_id,
          typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null,
          'field_user_unavailable',
        );
      }
      case 'role':
        return this.roleFields(tx, def.role_key, instance);
      case 'group':
        return this.groupFields(tx, instance.store_id, def.group_key, def.strategy ?? 'any');
    }
  }

  /** User ids that should be notified for a notify payload. */
  async resolveUserIds(
    tx: WorkflowTx,
    payload: WorkflowNotifyPayload,
    instance: WorkflowInstanceRow,
  ): Promise<number[]> {
    const ids = new Set<number>(payload.user_ids ?? []);
    const fieldsList: AssigneeFields[] = [];
    if (payload.def) {
      const r = await this.resolveDef(tx, payload.def, instance);
      if (r.fields) fieldsList.push(r.fields);
    }
    if (payload.task_ids?.length) {
      const tasks: WorkflowTaskRow[] = await tx.workflow_tasks.findMany({
        where: { id: { in: payload.task_ids }, store_id: instance.store_id },
      });
      fieldsList.push(...tasks);
    }
    for (const f of fieldsList) {
      if (f.assignee_user_id) ids.add(f.assignee_user_id);
      else {
        if (f.assignee_group_id) {
          (await this.groups.availableMemberIds(f.assignee_group_id, tx, instance.store_id)).forEach(
            (u) => ids.add(u),
          );
        }
        if (f.assignee_role_id) {
          (await this.roleHolderIds(tx, f.assignee_role_id, instance.store_id, instance.organization_id)).forEach(
            (u) => ids.add(u),
          );
        }
      }
    }
    return [...ids];
  }

  /** Assignee, member of the assignee group or holder of the assignee role. */
  async canAct(
    tx: WorkflowTx,
    task: WorkflowTaskRow,
    userId: number,
    storeId: number,
    organizationId: number,
  ): Promise<boolean> {
    // Directly assigned (or claimed): only that person.
    if (task.assignee_user_id !== null) return task.assignee_user_id === userId;
    if (task.assignee_group_id !== null) {
      const m = await tx.work_group_members.findFirst({
        where: {
          store_id: storeId,
          work_group_id: task.assignee_group_id,
          user_id: userId,
        },
        select: { id: true },
      });
      if (m) return true;
    }
    if (task.assignee_role_id !== null) {
      const holders = await this.roleHolderIds(
        tx,
        task.assignee_role_id,
        storeId,
        organizationId,
      );
      if (holders.includes(userId)) return true;
    }
    return false;
  }

  // ---- internals ---------------------------------------------------------

  private async userFields(
    tx: WorkflowTx,
    storeId: number,
    userId: number | null | undefined,
    reason: string,
  ): Promise<{ fields: AssigneeFields | null; reason?: string }> {
    if (!userId) return { fields: null, reason };
    const member = await tx.store_users.findFirst({
      where: { store_id: storeId, user_id: userId },
      select: { id: true },
    });
    if (!member) return { fields: null, reason };
    return { fields: { ...NONE, assignee_user_id: userId } };
  }

  private async roleFields(
    tx: WorkflowTx,
    roleKey: string,
    instance: Pick<WorkflowInstanceRow, 'store_id' | 'organization_id'>,
  ): Promise<{ fields: AssigneeFields | null; reason?: string }> {
    // Roles are keyed by `name`: org/store custom roles win over system ones.
    const candidates: Array<{
      id: number;
      organization_id: number | null;
      store_id: number | null;
    }> = await tx.roles.findMany({
      where: {
        name: roleKey,
        OR: [
          { organization_id: null },
          {
            organization_id: instance.organization_id,
            OR: [{ store_id: null }, { store_id: instance.store_id }],
          },
        ],
      },
      select: { id: true, organization_id: true, store_id: true },
    });
    const role = [...candidates].sort(
      (a, b) =>
        Number(b.store_id !== null) - Number(a.store_id !== null) ||
        Number(b.organization_id !== null) - Number(a.organization_id !== null),
    )[0];
    if (!role) return { fields: null, reason: 'role_not_found' };
    const holders = await this.roleHolderIds(
      tx,
      role.id,
      instance.store_id,
      instance.organization_id,
    );
    if (holders.length === 0) return { fields: null, reason: 'role_without_holders' };
    return { fields: { ...NONE, assignee_role_id: role.id } };
  }

  private async roleHolderIds(
    tx: WorkflowTx,
    roleId: number,
    storeId: number,
    organizationId: number,
  ): Promise<number[]> {
    // `user_roles` is not store scoped: bind the store, and require the role to
    // be a system role or one of this organization.
    const rows: Array<{
      user_id: number | null;
      roles: { organization_id: number | null } | null;
    }> = await tx.user_roles.findMany({
      where: {
        role_id: roleId,
        OR: [{ store_id: storeId }, { store_id: null }],
      },
      select: { user_id: true, roles: { select: { organization_id: true } } },
    });
    return rows
      .filter(
        (r) =>
          r.roles &&
          (r.roles.organization_id === null ||
            r.roles.organization_id === organizationId),
      )
      .map((r) => r.user_id)
      .filter((u): u is number => !!u);
  }

  private async groupFields(
    tx: WorkflowTx,
    storeId: number,
    groupKey: string,
    strategy: 'any' | 'round_robin' | 'least_load',
  ): Promise<{ fields: AssigneeFields | null; reason?: string }> {
    const group = await tx.work_groups.findFirst({
      where: { store_id: storeId, key: groupKey, is_active: true },
      select: { id: true },
    });
    if (!group) return { fields: null, reason: 'group_not_found' };
    const available = await this.groups.availableMemberIds(group.id, tx, storeId);
    if (available.length === 0) return { fields: null, reason: 'group_without_available_members' };
    if (strategy === 'any') {
      return { fields: { ...NONE, assignee_group_id: group.id } };
    }
    const user =
      strategy === 'round_robin'
        ? await this.nextRoundRobin(tx, storeId, group.id, available)
        : await this.leastLoaded(tx, storeId, available);
    return { fields: { ...NONE, assignee_user_id: user, assignee_group_id: group.id } };
  }

  /** Next available member after the one that got the group's last task. */
  private async nextRoundRobin(
    tx: WorkflowTx,
    storeId: number,
    groupId: number,
    available: number[],
  ): Promise<number> {
    const last = await tx.workflow_tasks.findFirst({
      where: {
        store_id: storeId,
        assignee_group_id: groupId,
        assignee_user_id: { not: null },
      },
      orderBy: { id: 'desc' },
      select: { assignee_user_id: true },
    });
    const all: Array<{ user_id: number }> = await tx.work_group_members.findMany({
      where: { store_id: storeId, work_group_id: groupId },
      orderBy: { id: 'asc' },
      select: { user_id: true },
    });
    const order = all.map((m) => m.user_id);
    const lastIdx = last ? order.indexOf(last.assignee_user_id) : -1;
    for (let i = 1; i <= order.length; i++) {
      const candidate = order[(lastIdx + i) % order.length];
      if (available.includes(candidate)) return candidate;
    }
    return available[0];
  }

  private async leastLoaded(
    tx: WorkflowTx,
    storeId: number,
    available: number[],
  ): Promise<number> {
    const open: Array<{ assignee_user_id: number | null }> =
      await tx.workflow_tasks.findMany({
        where: {
          store_id: storeId,
          assignee_user_id: { in: available },
          status: { in: OPEN_STATUSES },
        },
        select: { assignee_user_id: true },
      });
    const load = new Map<number, number>(available.map((u) => [u, 0]));
    for (const t of open) {
      if (t.assignee_user_id !== null) {
        load.set(t.assignee_user_id, (load.get(t.assignee_user_id) ?? 0) + 1);
      }
    }
    return [...available].sort(
      (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a - b,
    )[0];
  }
}
