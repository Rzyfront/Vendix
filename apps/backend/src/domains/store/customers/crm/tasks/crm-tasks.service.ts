import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { ErrorCodes, VendixHttpException } from '../../../../../common/errors';
import {
  localCivil,
  resolveStoreTimezone,
  zonedWallClockToUtc,
} from '../../../../../common/utils/store-timezone.util';
import { NotificationsService } from '../../../notifications/notifications.service';
import {
  CrmPipelineService,
  CrmTaskOpportunityMove,
} from '../pipeline/crm-pipeline.service';
import {
  CrmViewer,
  isActiveStoreStaff,
  isStoreCustomer,
  resolveCrmViewer,
} from '../shared/crm-access';
import {
  CreateCrmTaskDto,
  CrmTaskStatsQueryDto,
  CrmTasksQueryDto,
  UpdateCrmTaskDto,
} from './dto/crm-tasks.dto';

export const CRM_TASKS_PERMISSION = 'store:crm_tasks:manage';
export const CRM_TASK_ASSIGNED_NOTIFICATION = 'crm_task_assigned';
export const CRM_TASK_DUE_NOTIFICATION = 'crm_task_due';
export const CRM_TASKS_ROUTE = '/admin/customers/tasks';

const PERSON_SELECT = { id: true, first_name: true, last_name: true } as const;

const TASK_INCLUDE = {
  customer: { select: PERSON_SELECT },
  assigned_user: { select: PERSON_SELECT },
  created_by: { select: PERSON_SELECT },
  opportunity: { select: { id: true, title: true } },
  move_to_stage: { select: { id: true, name: true, kind: true, color: true } },
  supporters: {
    select: { user: { select: PERSON_SELECT } },
    orderBy: { id: 'asc' },
  },
} as const;

type TaskRow = Prisma.crm_tasksGetPayload<{ include: typeof TASK_INCLUDE }>;

interface DayWindow {
  now: Date;
  todayStart: Date;
  tomorrowStart: Date;
  weekEnd: Date;
}

/**
 * CRM tasks (PLAN-CRM §4.6). A seller or cashier only sees the tasks assigned
 * to them, created by them or where they are support, and can only assign to
 * themselves (they can add support people); owner/admin (see-all) see and
 * assign everything. Assigning someone else, or adding them as support, sends
 * them a notification through the existing notifications system; the due
 * reminder is `CrmTaskDueJob` and only goes to the assignee.
 *
 * A task linked to an opportunity can "move" it: when the task is completed
 * the opportunity goes to `move_to_stage_id` through the pipeline service.
 *
 * "Today" and "overdue" are measured in the store's timezone, not the
 * server's (skill vendix-date-timezone).
 */
@Injectable()
export class CrmTasksService {
  private readonly logger = new Logger(CrmTasksService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
    private readonly pipeline: CrmPipelineService,
  ) {}

  async list(query: CrmTasksQueryDto) {
    const viewer = this.viewer();
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const window = await this.dayWindow(viewer.store_id);
    const where = this.listWhere(viewer, query, window);
    const [total, rows] = await Promise.all([
      this.prisma.crm_tasks.count({ where }),
      this.prisma.crm_tasks.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [
          { status: 'asc' },
          { due_at: { sort: 'asc', nulls: 'last' } },
          { id: 'desc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return {
      data: rows.map((row) => this.toTask(row, window.now)),
      total,
      page,
      limit,
    };
  }

  /** "Mis tareas de hoy": my pending tasks that are overdue or due today. */
  async today() {
    const viewer = this.viewer();
    const window = await this.dayWindow(viewer.store_id);
    const mine = {
      ...this.involves(viewer.user_id),
      status: 'pending' as const,
    };
    const [overdue, today, upcoming] = await Promise.all([
      this.prisma.crm_tasks.findMany({
        where: { ...mine, due_at: { lt: window.now } },
        include: TASK_INCLUDE,
        orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.prisma.crm_tasks.findMany({
        where: {
          ...mine,
          due_at: { gte: window.now, lt: window.tomorrowStart },
        },
        include: TASK_INCLUDE,
        orderBy: [{ due_at: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      this.prisma.crm_tasks.count({
        where: {
          ...mine,
          due_at: { gte: window.tomorrowStart, lt: window.weekEnd },
        },
      }),
    ]);
    return {
      overdue: overdue.map((row) => this.toTask(row, window.now)),
      today: today.map((row) => this.toTask(row, window.now)),
      counts: {
        overdue: overdue.length,
        today: today.length,
        upcoming_week: upcoming,
      },
    };
  }

  /**
   * Counters of the tasks screen. "Today" starts now, like {@link today}: a
   * task due earlier today is overdue and is not counted twice.
   */
  async stats(query: CrmTaskStatsQueryDto = {}) {
    const viewer = this.viewer();
    const window = await this.dayWindow(viewer.store_id);
    const scope: Prisma.crm_tasksWhereInput[] = [this.visibility(viewer)];
    if (query.assigned) scope.push(this.assignedWhere(viewer, query.assigned));
    const where = (...extra: Prisma.crm_tasksWhereInput[]) => ({
      AND: [...scope, ...extra],
    });
    const pending = { status: 'pending' as const };
    const [overdue, today, open, doneWeek] = await Promise.all([
      this.prisma.crm_tasks.count({
        where: where(pending, { due_at: { lt: window.now } }),
      }),
      this.prisma.crm_tasks.count({
        where: where(pending, {
          due_at: { gte: window.now, lt: window.tomorrowStart },
        }),
      }),
      this.prisma.crm_tasks.count({ where: where(pending) }),
      this.prisma.crm_tasks.count({
        where: where({
          status: 'done',
          completed_at: {
            gte: new Date(window.todayStart.getTime() - 6 * 86_400_000),
          },
        }),
      }),
    ]);
    return { overdue, today, open, done_last_7_days: doneWeek };
  }

  async findOne(id: number) {
    const viewer = this.viewer();
    const row = await this.findVisible(viewer, id);
    return this.toTask(row, new Date());
  }

  async create(dto: CreateCrmTaskDto) {
    const viewer = this.viewer();
    const assignee =
      dto.assigned_user_id === undefined ? viewer.user_id : dto.assigned_user_id;
    await this.assertAssignee(viewer, assignee);
    await this.assertLinks(viewer, dto);
    const supporters = await this.resolveSupporters(
      dto.support_user_ids ?? [],
      assignee,
    );
    if (dto.move_to_stage_id) {
      await this.assertTargetStage(
        viewer,
        dto.opportunity_id,
        dto.move_to_stage_id,
      );
    }

    const created = await this.prisma.crm_tasks.create({
      data: {
        store_id: viewer.store_id,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        due_at: dto.due_at ? new Date(dto.due_at) : null,
        assigned_user_id: assignee,
        created_by_user_id: viewer.user_id,
        customer_id: dto.customer_id ?? null,
        opportunity_id: dto.opportunity_id ?? null,
        conversation_id: dto.conversation_id ?? null,
        move_to_stage_id: dto.move_to_stage_id ?? null,
        ...(supporters.length
          ? {
              supporters: {
                create: supporters.map((user_id) => ({
                  store_id: viewer.store_id,
                  user_id,
                })),
              },
            }
          : {}),
      },
      include: TASK_INCLUDE,
    });
    await this.notifyAssigned(viewer, created);
    await this.notifySupporters(viewer, created, supporters);
    return this.toTask(created, new Date());
  }

  async update(id: number, dto: UpdateCrmTaskDto) {
    const viewer = this.viewer();
    const current = await this.findVisible(viewer, id);
    const data: Prisma.crm_tasksUncheckedUpdateManyInput = {};

    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.description !== undefined) {
      data.description = dto.description?.trim() || null;
    }
    if (dto.due_at !== undefined) {
      data.due_at = dto.due_at ? new Date(dto.due_at) : null;
    }
    const reassigned =
      dto.assigned_user_id !== undefined &&
      dto.assigned_user_id !== current.assigned_user_id;
    if (reassigned) {
      await this.assertAssignee(viewer, dto.assigned_user_id ?? null);
      data.assigned_user_id = dto.assigned_user_id;
    }
    const completing = dto.status === 'done' && current.status !== 'done';
    if (dto.status !== undefined && dto.status !== current.status) {
      data.status = dto.status;
      data.completed_at = dto.status === 'done' ? new Date() : null;
    }
    if (
      dto.move_to_stage_id !== undefined &&
      dto.move_to_stage_id !== current.move_to_stage_id
    ) {
      if (dto.move_to_stage_id !== null) {
        await this.assertTargetStage(
          viewer,
          current.opportunity_id,
          dto.move_to_stage_id,
        );
      }
      data.move_to_stage_id = dto.move_to_stage_id;
    }
    const assignee = reassigned
      ? (dto.assigned_user_id ?? null)
      : current.assigned_user_id;
    const support = await this.supportChange(
      current,
      assignee,
      dto.support_user_ids,
    );

    if (Object.keys(data).length) {
      await this.prisma.crm_tasks.updateMany({ where: { id }, data });
    }
    if (support.removed.length) {
      await this.prisma.crm_task_assignees.deleteMany({
        where: { task_id: id, user_id: { in: support.removed } },
      });
    }
    if (support.added.length) {
      await this.prisma.crm_task_assignees.createMany({
        data: support.added.map((user_id) => ({
          store_id: viewer.store_id,
          task_id: id,
          user_id,
        })),
        skipDuplicates: true,
      });
    }
    const updated = await this.prisma.crm_tasks.findFirst({
      where: { id },
      include: TASK_INCLUDE,
    });
    if (!updated) throw new VendixHttpException(ErrorCodes.CRM_TASK_001);
    if (reassigned) await this.notifyAssigned(viewer, updated);
    await this.notifySupporters(viewer, updated, support.added);
    const task = this.toTask(updated, new Date());
    if (!completing) return task;
    // Reopening never moves it back; only the step to `done` moves it.
    return {
      ...task,
      opportunity_move: await this.moveLinkedOpportunity(updated),
    };
  }

  complete(id: number) {
    return this.update(id, { status: 'done' });
  }

  reopen(id: number) {
    return this.update(id, { status: 'pending' });
  }

  private viewer(): CrmViewer {
    return resolveCrmViewer(ErrorCodes.CRM_TASK_001);
  }

  private visibility(viewer: CrmViewer): Prisma.crm_tasksWhereInput {
    return viewer.can_see_all
      ? {}
      : {
          OR: [
            { assigned_user_id: viewer.user_id },
            { created_by_user_id: viewer.user_id },
            { supporters: { some: { user_id: viewer.user_id } } },
          ],
        };
  }

  /** The user is the assignee or one of the support people. */
  private involves(userId: number): Prisma.crm_tasksWhereInput {
    return {
      OR: [
        { assigned_user_id: userId },
        { supporters: { some: { user_id: userId } } },
      ],
    };
  }

  private listWhere(
    viewer: CrmViewer,
    query: CrmTasksQueryDto,
    window: DayWindow,
  ): Prisma.crm_tasksWhereInput {
    const and: Prisma.crm_tasksWhereInput[] = [this.visibility(viewer)];
    const assigned = this.assignedWhere(viewer, query.assigned ?? 'me');
    if (Object.keys(assigned).length) and.push(assigned);

    if (query.status) and.push({ status: query.status });
    if (query.due === 'overdue') {
      and.push({ status: 'pending', due_at: { lt: window.now } });
    } else if (query.due === 'today') {
      and.push({
        due_at: { gte: window.todayStart, lt: window.tomorrowStart },
      });
    } else if (query.due === 'week') {
      and.push({ due_at: { gte: window.todayStart, lt: window.weekEnd } });
    }
    if (query.customer_id) and.push({ customer_id: query.customer_id });
    if (query.opportunity_id) and.push({ opportunity_id: query.opportunity_id });
    const q = query.q?.trim();
    if (q) and.push({ title: { contains: q, mode: 'insensitive' } });
    return { AND: and };
  }

  /**
   * `me`, `unassigned` (no assignee), `all` (no filter) or a user id. `me`
   * and a user id match the assignee or a support person.
   */
  private assignedWhere(
    viewer: CrmViewer,
    assigned: string,
  ): Prisma.crm_tasksWhereInput {
    if (assigned === 'me') return this.involves(viewer.user_id);
    if (assigned === 'unassigned') return { assigned_user_id: null };
    if (assigned === 'all') return {};
    return this.involves(Number(assigned));
  }

  private async findVisible(viewer: CrmViewer, id: number): Promise<TaskRow> {
    const row = await this.prisma.crm_tasks.findFirst({
      where: { AND: [{ id }, this.visibility(viewer)] },
      include: TASK_INCLUDE,
    });
    if (!row) throw new VendixHttpException(ErrorCodes.CRM_TASK_001);
    return row;
  }

  private async assertAssignee(
    viewer: CrmViewer,
    assigneeId: number | null,
  ): Promise<void> {
    if (assigneeId === viewer.user_id) return;
    // Without see-all a seller cannot hand a task off, not even to nobody.
    if (!viewer.can_see_all) {
      throw new VendixHttpException(ErrorCodes.CRM_ASSIGN_001);
    }
    if (assigneeId === null) return;
    if (!(await isActiveStoreStaff(this.prisma, assigneeId, CRM_TASKS_PERMISSION))) {
      throw new VendixHttpException(ErrorCodes.CRM_STAFF_001);
    }
  }

  /** Linked customer, opportunity and conversation must be of this store. */
  private async assertLinks(
    viewer: CrmViewer,
    dto: CreateCrmTaskDto,
  ): Promise<void> {
    if (dto.customer_id && !(await isStoreCustomer(this.prisma, dto.customer_id))) {
      throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    }
    if (dto.opportunity_id) {
      await this.assertOpportunityVisible(viewer, dto.opportunity_id);
    }
    if (dto.conversation_id) {
      const found = await this.prisma.crm_conversations.count({
        where: { id: dto.conversation_id },
      });
      if (!found) throw new VendixHttpException(ErrorCodes.CRM_INBOX_001);
    }
  }

  /**
   * Support people to keep: unique, never the assignee, and every one not
   * already on the task (`kept`) must be active staff that can see tasks.
   */
  private async resolveSupporters(
    ids: number[],
    assignee: number | null,
    kept: number[] = [],
  ): Promise<number[]> {
    const unique = [...new Set(ids)].filter((id) => id !== assignee);
    for (const id of unique) {
      if (kept.includes(id)) continue;
      if (!(await isActiveStoreStaff(this.prisma, id, CRM_TASKS_PERMISSION))) {
        throw new VendixHttpException(ErrorCodes.CRM_STAFF_001);
      }
    }
    return unique;
  }

  /**
   * Who joins and who leaves the support people. Without `requested` the set
   * stays, except a support person who just became the assignee.
   */
  private async supportChange(
    current: TaskRow,
    assignee: number | null,
    requested: number[] | undefined,
  ): Promise<{ added: number[]; removed: number[] }> {
    const before = current.supporters.map((row) => row.user.id);
    const after =
      requested === undefined
        ? before.filter((id) => id !== assignee)
        : await this.resolveSupporters(requested, assignee, before);
    return {
      added: after.filter((id) => !before.includes(id)),
      removed: before.filter((id) => !after.includes(id)),
    };
  }

  /** Same visibility as the pipeline: a seller only reaches their own. */
  private async assertOpportunityVisible(
    viewer: CrmViewer,
    opportunityId: number,
  ): Promise<void> {
    const found = await this.prisma.crm_opportunities.count({
      where: {
        id: opportunityId,
        ...(viewer.can_see_all ? {} : { owner_user_id: viewer.user_id }),
      },
    });
    if (!found) throw new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_001);
  }

  /**
   * The target stage needs a linked opportunity and must be of its board.
   * Choosing it decides where the opportunity goes when anyone completes the
   * task, so only who sees that opportunity on the board may choose it (a
   * support person of someone else's task may not).
   */
  private async assertTargetStage(
    viewer: CrmViewer,
    opportunityId: number | null | undefined,
    stageId: number,
  ): Promise<void> {
    if (!opportunityId) throw new VendixHttpException(ErrorCodes.CRM_TASK_002);
    await this.assertOpportunityVisible(viewer, opportunityId);
    await this.pipeline.assertTaskTargetStage(opportunityId, stageId);
  }

  /**
   * The task was just completed: move its opportunity if it says so. The
   * task stays completed whatever happens here; the answer says why nothing
   * moved.
   */
  private async moveLinkedOpportunity(
    task: TaskRow,
  ): Promise<CrmTaskOpportunityMove | null> {
    if (!task.move_to_stage_id) return null;
    const stage = task.move_to_stage
      ? {
          id: task.move_to_stage.id,
          name: task.move_to_stage.name,
          kind: task.move_to_stage.kind,
        }
      : null;
    if (!task.opportunity_id) {
      return { moved: false, reason: 'opportunity_missing', stage };
    }
    try {
      return await this.pipeline.moveForTask(
        task.opportunity_id,
        task.move_to_stage_id,
      );
    } catch (error) {
      this.logger.warn(
        `Task ${task.id}: opportunity ${task.opportunity_id} not moved: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { moved: false, reason: 'failed', stage };
    }
  }

  /** Never notifies the actor about their own assignment. */
  private async notifyAssigned(viewer: CrmViewer, task: TaskRow) {
    if (!task.assigned_user_id || task.assigned_user_id === viewer.user_id) {
      return;
    }
    await this.notifications.sendToUser(
      viewer.store_id,
      task.assigned_user_id,
      CRM_TASK_ASSIGNED_NOTIFICATION,
      'Nueva tarea asignada',
      `${task.title}${this.customerSuffix(task)}`,
      { kind: 'crm_task', task_id: task.id, url: CRM_TASKS_ROUTE },
    );
  }

  /** Only to the ones just added, never to the actor. Removing is silent. */
  private async notifySupporters(
    viewer: CrmViewer,
    task: TaskRow,
    added: number[],
  ) {
    for (const userId of added) {
      if (userId === viewer.user_id) continue;
      await this.notifications.sendToUser(
        viewer.store_id,
        userId,
        CRM_TASK_ASSIGNED_NOTIFICATION,
        'Te sumaron como apoyo',
        `Te sumaron como apoyo en: ${task.title}${this.customerSuffix(task)}`,
        {
          kind: 'crm_task',
          task_id: task.id,
          url: CRM_TASKS_ROUTE,
          role: 'support',
        },
      );
    }
  }

  private customerSuffix(task: TaskRow): string {
    return task.customer
      ? ` · ${[task.customer.first_name, task.customer.last_name].filter(Boolean).join(' ')}`
      : '';
  }

  private async dayWindow(storeId: number): Promise<DayWindow> {
    const tz = await resolveStoreTimezone(this.prisma, storeId);
    const now = new Date();
    const civil = localCivil(now, tz);
    const at = (offsetDays: number) =>
      zonedWallClockToUtc(
        civil.year,
        civil.month,
        civil.day + offsetDays,
        0,
        0,
        0,
        0,
        tz,
      );
    return {
      now,
      todayStart: at(0),
      tomorrowStart: at(1),
      weekEnd: at(7),
    };
  }

  private toTask(row: TaskRow, now: Date) {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      status: row.status,
      due_at: row.due_at,
      is_overdue:
        row.status === 'pending' && !!row.due_at && row.due_at < now,
      completed_at: row.completed_at,
      customer: row.customer,
      assigned_user: row.assigned_user,
      support_users: row.supporters.map((supporter) => supporter.user),
      created_by: row.created_by,
      opportunity: row.opportunity,
      move_to_stage: row.move_to_stage,
      conversation_id: row.conversation_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
