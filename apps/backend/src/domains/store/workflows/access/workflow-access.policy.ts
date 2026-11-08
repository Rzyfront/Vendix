import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import type { WorkflowTx } from '../engine/workflow-engine.types';
import {
  readWorkflowAccess,
  WorkflowAccess,
  WorkflowAccessGroup,
} from './workflow-access.types';

type Json = Record<string, unknown>;

/** Owner, superadmin and `store:workflows:manage` pass every permission of a flow. */
export function accessBypass(): boolean {
  const c = RequestContextService.getContext();
  return (
    !!c?.is_owner ||
    !!c?.is_super_admin ||
    (c?.permissions ?? []).includes('store:workflows:manage')
  );
}

/**
 * Role names the user holds in this store: the same representation as
 * `start_roles` (role `name`), counting only system roles or roles of this
 * organization, exactly like the start check.
 */
export async function heldRoleNames(
  db: WorkflowTx,
  userId: number,
  storeId: number,
  organizationId: number,
): Promise<string[]> {
  const rows: Array<{ roles: { name: string; organization_id: number | null } | null }> =
    await db.user_roles.findMany({
      where: { user_id: userId, OR: [{ store_id: storeId }, { store_id: null }] },
      select: { roles: { select: { name: true, organization_id: true } } },
    });
  return [
    ...new Set(
      rows
        .filter(
          (r) =>
            r.roles &&
            (r.roles.organization_id === null || r.roles.organization_id === organizationId),
        )
        .map((r) => (r.roles as { name: string }).name),
    ),
  ];
}

export function isInGroup(
  group: WorkflowAccessGroup | undefined,
  userId: number,
  roleNames: readonly string[],
): boolean {
  if (!group) return false;
  return group.user_ids.includes(userId) || group.roles.some((r) => roleNames.includes(r));
}

/** "Ana Pérez, Administrador": role names first, then people. */
export async function describeActors(
  db: WorkflowTx,
  group: WorkflowAccessGroup,
): Promise<string> {
  const users: Array<{ id: number; first_name: string | null; last_name: string | null }> =
    group.user_ids.length
      ? await db.users.findMany({
          where: { id: { in: group.user_ids } },
          select: { id: true, first_name: true, last_name: true },
        })
      : [];
  const names = users
    .map((u) => `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim())
    .filter(Boolean);
  return [...group.roles, ...names].join(', ');
}

export interface StageActDecision {
  allowed: boolean;
  /** Spanish detail for `WORKFLOW_STAGE_ACT_FORBIDDEN` when not allowed. */
  message?: string;
}

/**
 * `access.stages[stage].act` of the flow the task belongs to. Open when the
 * flow has no permissions or the stage has no `act` group. Called by
 * `WorkflowAssignmentService.canAct`, so complete, vote and claim share it.
 */
export async function evaluateStageAct(
  db: WorkflowTx,
  p: {
    task: { instance_id: number; stage_key: string };
    userId: number;
    storeId: number;
    organizationId: number;
  },
): Promise<StageActDecision> {
  const instance: { definition_id: number } | null = await db.workflow_instances.findFirst({
    where: { id: p.task.instance_id, store_id: p.storeId },
    select: { definition_id: true },
  });
  if (!instance) return { allowed: true };
  const def: { access: unknown } | null = await db.workflow_definitions.findFirst({
    where: { id: instance.definition_id, store_id: p.storeId },
    select: { access: true },
  });
  const act = readWorkflowAccess(def?.access)?.stages?.[p.task.stage_key]?.act;
  if (!act) return { allowed: true };
  if (RequestContextService.getUserId() === p.userId && accessBypass()) return { allowed: true };
  const roles = await heldRoleNames(db, p.userId, p.storeId, p.organizationId);
  if (isInGroup(act, p.userId, roles)) return { allowed: true };
  return {
    allowed: false,
    message: `Esta etapa solo la pueden decidir: ${await describeActors(db, act)}`,
  };
}

/** A flow with `access` that every staff member still sees: no `view` group and no `start_roles`. */
function openToEveryone(access: WorkflowAccess, startRoles: readonly string[]): boolean {
  return !access.view && startRoles.length === 0;
}

/**
 * Whether a person sees a flow that has an `access` document: a place in
 * `design` or `view`, a role of the published `start_roles`, or a flow open to
 * everyone. The policy and the engine's start check share it.
 */
export function seesFlow(
  access: WorkflowAccess,
  startRoles: readonly string[],
  userId: number,
  roles: readonly string[],
): boolean {
  if (isInGroup(access.design, userId, roles) || isInGroup(access.view, userId, roles)) return true;
  if (startRoles.some((r) => roles.includes(r))) return true;
  return openToEveryone(access, startRoles);
}

/**
 * Who sees and designs a flow (flujos-adm P7.3). A flow without `access` is
 * open. With it: visible to whoever is in `design` or `view`, to whoever can
 * start it by the published `start_roles`, and to everyone only when it has
 * neither `view` nor `start_roles`. A flow the caller cannot see is
 * indistinguishable from one that does not exist (404). Calls without a user
 * (cron, system) are not restricted.
 */
@Injectable()
export class WorkflowAccessPolicy {
  constructor(private readonly prisma: StorePrismaService) {}

  private caller() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return {
      store_id: c.store_id,
      organization_id: c.organization_id,
      user_id: c.user_id ?? null,
      free: !c.user_id || accessBypass(),
    };
  }

  private async startRoles(storeId: number, versionIds: number[]): Promise<Map<number, string[]>> {
    const out = new Map<number, string[]>();
    if (!versionIds.length) return out;
    const rows: Array<{ id: number; definition: { start_roles?: string[] } | null }> =
      await this.prisma.workflow_versions.findMany({
        where: { store_id: storeId, id: { in: versionIds } },
        select: { id: true, definition: true },
      });
    for (const r of rows) out.set(r.id, r.definition?.start_roles ?? []);
    return out;
  }

  /** This store's flows with an `access` document, each with its published `start_roles`. */
  private async withAccess(storeId: number) {
    const rows: Array<{ id: number; access: unknown; published_version_id: number | null }> =
      await this.prisma.workflow_definitions.findMany({
        where: { store_id: storeId },
        select: { id: true, access: true, published_version_id: true },
      });
    const restricted = rows.flatMap((r) => {
      const parsed = readWorkflowAccess(r.access);
      return parsed ? [{ id: r.id, access: parsed, published_version_id: r.published_version_id }] : [];
    });
    const starts = await this.startRoles(
      storeId,
      restricted.map((r) => r.published_version_id).filter((v): v is number => !!v),
    );
    return restricted.map((r) => ({
      id: r.id,
      access: r.access,
      startRoles: r.published_version_id ? (starts.get(r.published_version_id) ?? []) : [],
    }));
  }

  /** Ids of this store's flows the caller may NOT see. */
  async hiddenDefinitionIds(): Promise<number[]> {
    const c = this.caller();
    if (c.free || c.user_id === null) return [];
    const restricted = await this.withAccess(c.store_id);
    if (!restricted.length) return [];
    const roles = await heldRoleNames(this.prisma, c.user_id, c.store_id, c.organization_id);
    return restricted
      .filter((r) => !seesFlow(r.access, r.startRoles, c.user_id as number, roles))
      .map((r) => r.id);
  }

  /**
   * Ids of this store's flows that some staff member may not see, whoever
   * asks (cron included). Store-wide content that every reader gets, like the
   * AI summary, leaves them out.
   */
  async restrictedDefinitionIds(): Promise<number[]> {
    const c = this.caller();
    return (await this.withAccess(c.store_id))
      .filter((r) => !openToEveryone(r.access, r.startRoles))
      .map((r) => r.id);
  }

  /** Prisma `where` fragment for `workflow_definitions`, or `null` when nothing is hidden. */
  async visibleDefinitionsWhere(): Promise<Json | null> {
    const hidden = await this.hiddenDefinitionIds();
    return hidden.length ? { id: { notIn: hidden } } : null;
  }

  /** Whether the caller sees the flow; a missing or foreign flow is not visible. */
  async canView(definitionId: number): Promise<boolean> {
    const c = this.caller();
    const row: { access: unknown; published_version_id: number | null } | null =
      await this.prisma.workflow_definitions.findFirst({
        where: { id: definitionId, store_id: c.store_id },
        select: { access: true, published_version_id: true },
      });
    if (!row) return false;
    const access = readWorkflowAccess(row.access);
    if (!access || c.free || c.user_id === null) return true;
    const [roles, starts] = await Promise.all([
      heldRoleNames(this.prisma, c.user_id, c.store_id, c.organization_id),
      this.startRoles(c.store_id, row.published_version_id ? [row.published_version_id] : []),
    ]);
    return seesFlow(
      access,
      row.published_version_id ? (starts.get(row.published_version_id) ?? []) : [],
      c.user_id,
      roles,
    );
  }

  /** 404 unless the caller sees the flow. */
  async assertCanView(definitionId: number): Promise<void> {
    if (!(await this.canView(definitionId))) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
  }

  /**
   * Whether the caller may edit the flow's permissions: the
   * `store:workflows:design` permission (or a bypass) and a place in `design`
   * when the flow has one. Never throws for a flow the caller cannot design.
   */
  async canEditAccess(definitionId: number): Promise<boolean> {
    if (accessBypass()) return true;
    const permissions = RequestContextService.getContext()?.permissions ?? [];
    if (!permissions.includes('store:workflows:design')) return false;
    try {
      await this.assertCanDesign(definitionId);
      return true;
    } catch (e) {
      if (e instanceof VendixHttpException) return false;
      throw e;
    }
  }

  /**
   * Write access: 404 when the flow is not visible, 403 `WORKFLOW_DESIGN_FORBIDDEN`
   * when `access.design` is set and the caller is not in it. The
   * `store:workflows:design` permission itself is checked by the controller.
   */
  async assertCanDesign(definitionId: number): Promise<void> {
    await this.assertCanView(definitionId);
    const c = this.caller();
    if (c.free || c.user_id === null) return;
    const row: { access: unknown } | null = await this.prisma.workflow_definitions.findFirst({
      where: { id: definitionId, store_id: c.store_id },
      select: { access: true },
    });
    const design = readWorkflowAccess(row?.access)?.design;
    if (!design) return;
    const roles = await heldRoleNames(this.prisma, c.user_id, c.store_id, c.organization_id);
    if (!isInGroup(design, c.user_id, roles)) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DESIGN_FORBIDDEN);
    }
  }
}
