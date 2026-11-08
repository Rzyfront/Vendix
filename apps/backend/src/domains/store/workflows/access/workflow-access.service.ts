import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { WorkflowAuditService } from '../audit/workflow-audit.service';
import type { WorkflowTx } from '../engine/workflow-engine.types';
import { WorkflowAccessPolicy } from './workflow-access.policy';
import {
  accessRoleNames,
  accessUserIds,
  normalizeWorkflowAccess,
  readWorkflowAccess,
  WorkflowAccess,
} from './workflow-access.types';

export interface StageOption {
  key: string;
  name: string;
}

interface DefinitionShape {
  start_roles?: string[];
  stages?: Array<{ key: string; name?: string; type?: string }>;
}

const CUSTOMER_ROLE = 'customer';
/** Roles that never see nor decide a store's flows: shoppers and the platform. */
const NON_STAFF_ROLES = [CUSTOMER_ROLE, 'super_admin'];

/** Reads and changes the permissions of one flow (flujos-adm P7.3). */
@Injectable()
export class WorkflowAccessService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly audit: WorkflowAuditService,
    private readonly policy: WorkflowAccessPolicy,
  ) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id || !c.user_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id, user_id: c.user_id };
  }

  private async load(db: WorkflowTx, storeId: number, id: number) {
    const row = await db.workflow_definitions.findFirst({
      where: { id, store_id: storeId },
      select: {
        id: true,
        name: true,
        access: true,
        published_version_id: true,
        draft_definition: true,
      },
    });
    if (!row) throw new VendixHttpException(ErrorCodes.WORKFLOW_DEFINITION_NOT_FOUND);
    return row;
  }

  /** Published contract when there is one (its stages and `start_roles` rule), else the draft. */
  private async shape(db: WorkflowTx, storeId: number, row: Awaited<ReturnType<WorkflowAccessService['load']>>) {
    const published: { definition: DefinitionShape } | null = row.published_version_id
      ? await db.workflow_versions.findFirst({
          where: { id: row.published_version_id, store_id: storeId },
          select: { definition: true },
        })
      : null;
    const draft = (row.draft_definition ?? null) as DefinitionShape | null;
    const body = published?.definition ?? draft;
    const stages: StageOption[] = (body?.stages ?? [])
      .filter((s) => s.type !== 'end')
      .map((s) => ({ key: s.key, name: s.name ?? s.key }));
    return { start_roles: published?.definition.start_roles ?? [], stages };
  }

  /**
   * Who can be picked: the store's staff. Ecommerce customers are
   * `store_users` too, so a member whose only role is `customer` is left out
   * (as in the staff picker of store-users), and so are the `customer` and
   * `super_admin` roles.
   */
  private async options(storeId: number, organizationId: number) {
    const [roles, members] = await Promise.all([
      this.prisma.roles.findMany({
        where: {
          name: { notIn: NON_STAFF_ROLES },
          OR: [
            { organization_id: null },
            { organization_id: organizationId, OR: [{ store_id: null }, { store_id: storeId }] },
          ],
        },
        select: { name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.store_users.findMany({ where: { store_id: storeId }, select: { user_id: true } }),
    ]);
    const memberIds = members.map((m: { user_id: number }) => m.user_id);
    const [users, memberRoles]: [
      Array<{ id: number; first_name: string | null; last_name: string | null; email: string | null }>,
      Array<{ user_id: number; roles: { name: string } | null }>,
    ] = memberIds.length
      ? await Promise.all([
          this.prisma.users.findMany({
            where: { id: { in: memberIds } },
            select: { id: true, first_name: true, last_name: true, email: true },
          }),
          this.prisma.user_roles.findMany({
            where: { user_id: { in: memberIds } },
            select: { user_id: true, roles: { select: { name: true } } },
          }),
        ])
      : [[], []];
    const roleNames = new Map<number, string[]>();
    for (const ur of memberRoles) {
      const name = ur.roles?.name;
      if (name) roleNames.set(ur.user_id, [...(roleNames.get(ur.user_id) ?? []), name]);
    }
    const shopperOnly = (id: number) => {
      const names = roleNames.get(id) ?? [];
      return names.length > 0 && names.every((n) => n === CUSTOMER_ROLE);
    };
    return {
      roles: [...new Set<string>(roles.map((r: { name: string }) => r.name))],
      users: users
        .filter((u) => !shopperOnly(u.id))
        .map((u) => ({
          id: u.id,
          name: `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || `#${u.id}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    };
  }

  /** The access plus what the panel needs to edit it; 404 when the caller cannot see the flow. */
  async get(id: number) {
    const { store_id, organization_id } = this.ctx();
    await this.policy.assertCanView(id);
    const row = await this.load(this.prisma, store_id, id);
    const [shape, options] = await Promise.all([
      this.shape(this.prisma, store_id, row),
      this.options(store_id, organization_id),
    ]);
    return {
      access: readWorkflowAccess(row.access),
      start_roles: shape.start_roles,
      stages: shape.stages,
      options,
    };
  }

  /** Takes effect immediately (no new version) and is audited in the same transaction. */
  async update(id: number, raw: unknown) {
    const { store_id, organization_id, user_id } = this.ctx();
    await this.policy.assertCanDesign(id);
    const access = normalizeWorkflowAccess(raw);
    const row = await this.load(this.prisma, store_id, id);
    if (access) await this.assertExists(access, row, store_id, organization_id);
    const before = readWorkflowAccess(row.access);
    await this.prisma.$transaction(async (tx: WorkflowTx) => {
      await tx.workflow_definitions.updateMany({
        where: { id, store_id },
        data: { access: access ?? Prisma.DbNull, updated_by_user_id: user_id },
      });
      await this.audit.append(tx, {
        action: 'definition.access_changed',
        target_type: 'definition',
        target_id: id,
        definition_id: id,
        summary: `Cambió los permisos de «${row.name}»`,
        details: { before, after: access },
      });
    });
    return this.get(id);
  }

  private async assertExists(
    access: WorkflowAccess,
    row: Awaited<ReturnType<WorkflowAccessService['load']>>,
    storeId: number,
    organizationId: number,
  ) {
    const [options, shape] = await Promise.all([
      this.options(storeId, organizationId),
      this.shape(this.prisma, storeId, row),
    ]);
    const unknownRoles = accessRoleNames(access).filter((r) => !options.roles.includes(r));
    if (unknownRoles.length) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_ACCESS_INVALID,
        `Estos roles no se pueden elegir en la tienda: ${unknownRoles.join(', ')}.`,
      );
    }
    const known = new Set(options.users.map((u) => u.id));
    if (accessUserIds(access).some((u) => !known.has(u))) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_ACCESS_INVALID,
        'Alguna de las personas elegidas no pertenece a la tienda.',
      );
    }
    const stageKeys = new Set(shape.stages.map((s) => s.key));
    const unknownStages = Object.keys(access.stages ?? {}).filter((k) => !stageKeys.has(k));
    if (unknownStages.length) {
      throw new VendixHttpException(
        ErrorCodes.WORKFLOW_ACCESS_INVALID,
        `Estas etapas no existen en el flujo: ${unknownStages.join(', ')}.`,
      );
    }
  }
}
