import { Injectable } from '@nestjs/common';
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
  CrmViewer,
  isActiveStoreStaff,
  isStoreCustomer,
  resolveCrmViewer,
} from '../shared/crm-access';
import {
  CreateCrmTaskDto,
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
 * to them or created by them and can only assign to themselves; owner/admin
 * (see-all) see and assign everything. Assigning someone else sends them a
 * notification through the existing notifications system; the due reminder is
 * `CrmTaskDueJob`.
 *
 * "Today" and "overdue" are measured in the store's timezone, not the
 * server's (skill vendix-date-timezone).
 */
@Injectable()
export class CrmTasksService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly notifications: NotificationsService,
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
    const mine = { assigned_user_id: viewer.user_id, status: 'pending' as const };
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

  async stats() {
    const viewer = this.viewer();
    const window = await this.dayWindow(viewer.store_id);
    const visible = this.visibility(viewer);
    const pending = { ...visible, status: 'pending' as const };
    const [overdue, today, open, doneWeek] = await Promise.all([
      this.prisma.crm_tasks.count({
        where: { ...pending, due_at: { lt: window.now } },
      }),
      this.prisma.crm_tasks.count({
        where: {
          ...pending,
          due_at: { gte: window.todayStart, lt: window.tomorrowStart },
        },
      }),
      this.prisma.crm_tasks.count({ where: pending }),
      this.prisma.crm_tasks.count({
        where: {
          ...visible,
          status: 'done',
          completed_at: {
            gte: new Date(window.todayStart.getTime() - 6 * 86_400_000),
          },
        },
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
    await this.assertLinks(dto);

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
      },
      include: TASK_INCLUDE,
    });
    await this.notifyAssigned(viewer, created);
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
    if (dto.status !== undefined && dto.status !== current.status) {
      data.status = dto.status;
      data.completed_at = dto.status === 'done' ? new Date() : null;
    }

    if (Object.keys(data).length) {
      await this.prisma.crm_tasks.updateMany({ where: { id }, data });
    }
    const updated = await this.prisma.crm_tasks.findFirst({
      where: { id },
      include: TASK_INCLUDE,
    });
    if (!updated) throw new VendixHttpException(ErrorCodes.CRM_TASK_001);
    if (reassigned) await this.notifyAssigned(viewer, updated);
    return this.toTask(updated, new Date());
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
          ],
        };
  }

  private listWhere(
    viewer: CrmViewer,
    query: CrmTasksQueryDto,
    window: DayWindow,
  ): Prisma.crm_tasksWhereInput {
    const and: Prisma.crm_tasksWhereInput[] = [this.visibility(viewer)];
    const assigned = query.assigned ?? 'me';
    if (assigned === 'me') and.push({ assigned_user_id: viewer.user_id });
    else if (assigned === 'unassigned') and.push({ assigned_user_id: null });
    else if (assigned !== 'all') and.push({ assigned_user_id: Number(assigned) });

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
    if (assigneeId === null || assigneeId === viewer.user_id) return;
    if (!viewer.can_see_all) {
      throw new VendixHttpException(ErrorCodes.CRM_ASSIGN_001);
    }
    if (!(await isActiveStoreStaff(this.prisma, assigneeId, CRM_TASKS_PERMISSION))) {
      throw new VendixHttpException(ErrorCodes.CRM_STAFF_001);
    }
  }

  /** Linked customer, opportunity and conversation must be of this store. */
  private async assertLinks(dto: CreateCrmTaskDto): Promise<void> {
    if (dto.customer_id && !(await isStoreCustomer(this.prisma, dto.customer_id))) {
      throw new VendixHttpException(ErrorCodes.CRM_CUSTOMER_001);
    }
    if (dto.opportunity_id) {
      const found = await this.prisma.crm_opportunities.count({
        where: { id: dto.opportunity_id },
      });
      if (!found) throw new VendixHttpException(ErrorCodes.CRM_OPPORTUNITY_001);
    }
    if (dto.conversation_id) {
      const found = await this.prisma.crm_conversations.count({
        where: { id: dto.conversation_id },
      });
      if (!found) throw new VendixHttpException(ErrorCodes.CRM_INBOX_001);
    }
  }

  /** Never notifies the actor about their own assignment. */
  private async notifyAssigned(viewer: CrmViewer, task: TaskRow) {
    if (!task.assigned_user_id || task.assigned_user_id === viewer.user_id) {
      return;
    }
    const customer = task.customer
      ? ` · ${[task.customer.first_name, task.customer.last_name].filter(Boolean).join(' ')}`
      : '';
    await this.notifications.sendToUser(
      viewer.store_id,
      task.assigned_user_id,
      CRM_TASK_ASSIGNED_NOTIFICATION,
      'Nueva tarea asignada',
      `${task.title}${customer}`,
      { kind: 'crm_task', task_id: task.id, url: CRM_TASKS_ROUTE },
    );
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
      created_by: row.created_by,
      opportunity: row.opportunity,
      conversation_id: row.conversation_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
