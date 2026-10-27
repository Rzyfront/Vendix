import { Injectable } from '@nestjs/common';
import {
  lodging_housekeeping_task_status_enum,
  lodging_housekeeping_task_type_enum,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { HOUSEKEEPER_ROLE } from '@common/constants/lodging-roles.constant';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../reservations/stay-dates';
import { HousekeepingStatus } from './housekeeping-status';

export type HousekeepingTaskType = lodging_housekeeping_task_type_enum;
export type HousekeepingTaskStatus = lodging_housekeeping_task_status_enum;

/**
 * Roles whose users can receive housekeeping tasks. A list (not a single
 * role) so a hotel role added later only needs to be named here.
 */
export const HOUSEKEEPING_ASSIGNEE_ROLES: readonly string[] = [HOUSEKEEPER_ROLE];

export interface HousekeepingStaffMember {
  id: number;
  name: string;
}

export interface HousekeepingTaskView {
  id: number;
  task_date: string;
  type: HousekeepingTaskType;
  status: HousekeepingTaskStatus;
  assigned_user_id: number | null;
  notes: string | null;
  completed_at: Date | null;
  unit: {
    id: number;
    code: string;
    floor: string | null;
    housekeeping_status: HousekeepingStatus;
    unit_type: { id: number; name: string };
  };
}

interface StayForTasks {
  unit_id: number | null;
  arrival_date: Date;
  departure_date: Date;
  reservation: { status: string };
}

/**
 * Daily tasks from the stays of `today` (YYYY-MM-DD): a room whose guest
 * leaves today needs a check-out clean, a room with a guest staying on needs
 * a stayover. Arrivals of today need nothing yet.
 */
export function dailyHousekeepingTasks(
  stays: StayForTasks[],
  today: string,
): { unit_id: number; type: HousekeepingTaskType }[] {
  const day = dateOnlyToDb(today).getTime();
  const tasks = new Map<string, { unit_id: number; type: HousekeepingTaskType }>();
  for (const stay of stays) {
    if (stay.unit_id == null) continue;
    const arrival = stay.arrival_date.getTime();
    const departure = stay.departure_date.getTime();
    let type: HousekeepingTaskType | null = null;
    if (departure === day && ['checked_in', 'checked_out'].includes(stay.reservation.status)) {
      type = 'checkout_clean';
    } else if (
      stay.reservation.status === 'checked_in' &&
      arrival < day &&
      departure > day
    ) {
      type = 'stayover';
    }
    if (type) tasks.set(`${stay.unit_id}:${type}`, { unit_id: stay.unit_id, type });
  }
  return [...tasks.values()];
}

const TASK_SELECT = {
  id: true,
  task_date: true,
  type: true,
  status: true,
  assigned_user_id: true,
  notes: true,
  completed_at: true,
  unit: {
    select: {
      id: true,
      code: true,
      floor: true,
      housekeeping_status: true,
      unit_type: { select: { id: true, name: true } },
    },
  },
} as const;

/**
 * Hospitality Suite (H5.2) — tasks per housekeeper. The day's tasks are
 * generated on the first read of the day (idempotent on the unique
 * room/day/type key), the head housekeeper assigns each room, and the
 * housekeeper sees only hers and marks it done: a dirty room then becomes
 * clean, waiting for inspection.
 */
@Injectable()
export class HousekeepingTasksService {
  constructor(private readonly prisma: StorePrismaService) {}

  /** Head housekeeper: every task of today plus who can receive them. */
  async today(): Promise<{
    business_date: string;
    tasks: HousekeepingTaskView[];
    staff: HousekeepingStaffMember[];
  }> {
    const { store_id, today } = await this.ensureToday();
    const [tasks, staff] = await Promise.all([
      this.prisma.lodging_housekeeping_tasks.findMany({
        where: { task_date: dateOnlyToDb(today) },
        select: TASK_SELECT,
        orderBy: [{ unit: { floor: 'asc' } }, { unit: { code: 'asc' } }],
      }),
      this.staff(store_id),
    ]);
    return { business_date: today, tasks: tasks.map(toView), staff };
  }

  /** Housekeeper: only the tasks of today assigned to the current user. */
  async mine(): Promise<{ business_date: string; tasks: HousekeepingTaskView[] }> {
    const user_id = this.requireUserId();
    const { today } = await this.ensureToday();
    const tasks = await this.prisma.lodging_housekeeping_tasks.findMany({
      where: { task_date: dateOnlyToDb(today), assigned_user_id: user_id },
      select: TASK_SELECT,
      orderBy: [{ status: 'asc' }, { unit: { floor: 'asc' } }, { unit: { code: 'asc' } }],
    });
    return { business_date: today, tasks: tasks.map(toView) };
  }

  /** `assigned_user_id: null` takes the task back to the unassigned pool. */
  async assign(id: number, assigned_user_id: number | null): Promise<HousekeepingTaskView> {
    const store_id = this.requireStoreId();
    const task = await this.prisma.lodging_housekeeping_tasks.findFirst({
      where: { id },
      select: { id: true, status: true },
    });
    if (!task) {
      throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_FIND_001);
    }
    if (task.status !== 'pending') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_HOUSEKEEPING_TASK_STATE_001,
        'La tarea ya está terminada',
      );
    }
    if (assigned_user_id != null) {
      const staff = await this.staff(store_id, assigned_user_id);
      if (staff.length === 0) {
        throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001);
      }
    }
    const { count } = await this.prisma.lodging_housekeeping_tasks.updateMany({
      where: { id, status: 'pending' },
      data: { assigned_user_id, updated_at: new Date() },
    });
    if (count === 0) {
      throw new VendixHttpException(
        ErrorCodes.LODGING_HOUSEKEEPING_TASK_STATE_001,
        'La tarea ya está terminada',
      );
    }
    return this.findView(id);
  }

  /**
   * The housekeeper finishes her task. The room leaves "Sucia" for "Limpia"
   * (inspection pending); a room in another status (out of service, already
   * clean) keeps it.
   */
  async complete(id: number): Promise<HousekeepingTaskView> {
    const store_id = this.requireStoreId();
    const user_id = this.requireUserId();
    const task = await this.prisma.lodging_housekeeping_tasks.findFirst({
      where: { id },
      select: { id: true, unit_id: true },
    });
    if (!task) {
      throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_FIND_001);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Inside `$transaction` the client is not store-scoped: name the store.
      const { count } = await tx.lodging_housekeeping_tasks.updateMany({
        where: { id, store_id, status: 'pending', assigned_user_id: user_id },
        data: {
          status: 'done',
          completed_at: now,
          completed_by_user_id: user_id,
          updated_at: now,
        },
      });
      if (count === 0) {
        throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_STATE_001);
      }
      await tx.lodging_units.updateMany({
        where: { id: task.unit_id, store_id, housekeeping_status: 'dirty' },
        data: { housekeeping_status: 'clean', updated_at: now },
      });
    });
    return this.findView(id);
  }

  /** Creates today's missing tasks; existing ones (and their assignee) stay. */
  private async ensureToday(): Promise<{ store_id: number; today: string }> {
    const store_id = this.requireStoreId();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    const day = dateOnlyToDb(today);

    const stays = await this.prisma.lodging_reservation_rooms.findMany({
      where: {
        unit_id: { not: null },
        cancelled_at: null,
        arrival_date: { lte: day },
        departure_date: { gte: day },
        reservation: { status: { in: ['checked_in', 'checked_out'] } },
      },
      select: {
        unit_id: true,
        arrival_date: true,
        departure_date: true,
        reservation: { select: { status: true } },
      },
    });
    const tasks = dailyHousekeepingTasks(stays, today);
    if (tasks.length > 0) {
      await this.prisma.lodging_housekeeping_tasks.createMany({
        data: tasks.map((task) => ({ ...task, store_id, task_date: day })),
        skipDuplicates: true,
      });
    }
    return { store_id, today };
  }

  /** Active users of this store holding a housekeeper role (here or org-wide). */
  private async staff(store_id: number, only_id?: number): Promise<HousekeepingStaffMember[]> {
    const users = await this.prisma.users.findMany({
      where: {
        ...(only_id != null ? { id: only_id } : {}),
        state: 'active',
        store_users: { some: { store_id } },
        user_roles: {
          some: {
            OR: [{ store_id: null }, { store_id }],
            roles: { name: { in: [...HOUSEKEEPING_ASSIGNEE_ROLES] } },
          },
        },
      },
      select: { id: true, first_name: true, last_name: true },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
    return users.map((u) => ({ id: u.id, name: `${u.first_name} ${u.last_name}`.trim() }));
  }

  private async findView(id: number): Promise<HousekeepingTaskView> {
    const task = await this.prisma.lodging_housekeeping_tasks.findFirst({
      where: { id },
      select: TASK_SELECT,
    });
    if (!task) {
      throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_FIND_001);
    }
    return toView(task);
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }

  private requireUserId(): number {
    const user_id = RequestContextService.getContext()?.user_id;
    if (!user_id) {
      throw new VendixHttpException(ErrorCodes.AUTH_PERM_001);
    }
    return user_id;
  }
}

function toView(
  task: Omit<HousekeepingTaskView, 'task_date'> & { task_date: Date },
): HousekeepingTaskView {
  return { ...task, task_date: task.task_date.toISOString().slice(0, 10) };
}
