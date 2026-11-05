import { Injectable } from '@nestjs/common';
import { RequestContextService } from '@common/context/request-context.service';
import { ErrorCodes, VendixHttpException } from '@common/errors';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { WorkflowTx } from './engine/workflow-engine.types';

export type WorkGroupStrategy = 'any' | 'round_robin' | 'least_load';

export interface CreateWorkGroupInput {
  key: string;
  name: string;
  description?: string | null;
  assignment_strategy?: WorkGroupStrategy;
  is_active?: boolean;
}

export type UpdateWorkGroupInput = Partial<Omit<CreateWorkGroupInput, 'key'>>;

export interface WorkGroupMemberInput {
  user_id: number;
  is_lead?: boolean;
  is_available?: boolean;
}

const KEY_PATTERN = /^[a-z][a-z0-9_-]{0,79}$/;

/** Work groups and their members (store scoped). */
@Injectable()
export class WorkGroupsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private ctx() {
    const c = RequestContextService.getContext();
    if (!c?.store_id || !c.organization_id) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_NOT_FOUND);
    }
    return { store_id: c.store_id, organization_id: c.organization_id };
  }

  async list() {
    return this.prisma.work_groups.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { members: true } } },
    });
  }

  async get(id: number) {
    const group = await this.prisma.work_groups.findFirst({
      where: { id },
      include: { members: { orderBy: { id: 'asc' } } },
    });
    if (!group) throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_NOT_FOUND);
    return group;
  }

  async create(input: CreateWorkGroupInput) {
    const { store_id, organization_id } = this.ctx();
    if (!KEY_PATTERN.test(input.key)) {
      throw new VendixHttpException(
        ErrorCodes.SYS_VALIDATION_001,
        'La clave del grupo solo admite minúsculas, números, guion y guion bajo.',
      );
    }
    try {
      return await this.prisma.work_groups.create({
        data: {
          store_id,
          organization_id,
          key: input.key,
          name: input.name.trim(),
          description: input.description ?? null,
          assignment_strategy: input.assignment_strategy ?? 'round_robin',
          is_active: input.is_active ?? true,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_DUPLICATE);
      }
      throw e;
    }
  }

  async update(id: number, input: UpdateWorkGroupInput) {
    await this.get(id);
    try {
      const res = await this.prisma.work_groups.updateMany({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name.trim() }),
          ...(input.description !== undefined && {
            description: input.description,
          }),
          ...(input.assignment_strategy !== undefined && {
            assignment_strategy: input.assignment_strategy,
          }),
          ...(input.is_active !== undefined && { is_active: input.is_active }),
        },
      });
      if (res.count === 0) {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_NOT_FOUND);
      }
    } catch (e: any) {
      if (e?.code === 'P2002') {
        throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_DUPLICATE);
      }
      throw e;
    }
    return this.get(id);
  }

  /** Adds (or updates) a member; the user must belong to the current store. */
  async setMember(groupId: number, input: WorkGroupMemberInput) {
    const { store_id } = this.ctx();
    await this.get(groupId);
    const inStore = await this.prisma.store_users.findFirst({
      where: { store_id, user_id: input.user_id },
      select: { id: true },
    });
    if (!inStore) {
      throw new VendixHttpException(ErrorCodes.WORKFLOW_GROUP_MEMBER_INVALID);
    }
    const existing = await this.prisma.work_group_members.findFirst({
      where: { work_group_id: groupId, user_id: input.user_id },
    });
    if (existing) {
      await this.prisma.work_group_members.updateMany({
        where: { id: existing.id },
        data: {
          ...(input.is_lead !== undefined && { is_lead: input.is_lead }),
          ...(input.is_available !== undefined && {
            is_available: input.is_available,
          }),
        },
      });
      return this.prisma.work_group_members.findFirst({
        where: { id: existing.id },
      });
    }
    return this.prisma.work_group_members.create({
      data: {
        store_id,
        work_group_id: groupId,
        user_id: input.user_id,
        is_lead: input.is_lead ?? false,
        is_available: input.is_available ?? true,
      },
    });
  }

  async removeMember(groupId: number, userId: number) {
    await this.get(groupId);
    const res = await this.prisma.work_group_members.deleteMany({
      where: { work_group_id: groupId, user_id: userId },
    });
    return { removed: res.count };
  }

  /** User ids of the available members, ordered by membership (stable). */
  async availableMemberIds(
    groupId: number,
    tx?: WorkflowTx,
    storeId?: number,
  ): Promise<number[]> {
    const db = tx ?? this.prisma;
    const rows = await db.work_group_members.findMany({
      where: {
        store_id: storeId ?? this.ctx().store_id,
        work_group_id: groupId,
        is_available: true,
      },
      orderBy: { id: 'asc' },
      select: { user_id: true },
    });
    return rows.map((r: { user_id: number }) => r.user_id);
  }
}
