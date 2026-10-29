import { Injectable } from '@nestjs/common';
import {
  lodging_housekeeping_task_status_enum,
  lodging_housekeeping_task_type_enum,
  Prisma,
} from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { HOUSEKEEPER_ROLE } from '@common/constants/lodging-roles.constant';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb, formatShortDate } from '../reservations/stay-dates';
import { HousekeepingStatus } from './housekeeping-status';

export type HousekeepingTaskType = lodging_housekeeping_task_type_enum;
export type HousekeepingTaskStatus = lodging_housekeeping_task_status_enum;

/**
 * Roles whose users can receive housekeeping tasks. A list (not a single
 * role) so a hotel role added later only needs to be named here.
 */
export const HOUSEKEEPING_ASSIGNEE_ROLES: readonly string[] = [HOUSEKEEPER_ROLE];

/** Spanish name of each task type, as the screens show it. */
export const HOUSEKEEPING_TASK_TYPE_LABELS: Readonly<Record<HousekeepingTaskType, string>> = {
  checkout_clean: 'Limpieza de salida',
  stayover: 'Repaso',
  inspection: 'Inspección',
  maintenance: 'Mantenimiento',
};

export interface CreateHousekeepingTaskInput {
  unit_id: number;
  type: HousekeepingTaskType;
  /** YYYY-MM-DD; today (store time zone) when omitted. */
  task_date?: string;
  assigned_user_id?: number | null;
  notes?: string | null;
}

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
  /** U13 — who holds the task, by name (today's list only; null = unassigned or unknown). */
  assigned_user_name?: string | null;
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

/** Tasks whose completion leaves a dirty room clean. */
const CLEANING_TASK_TYPES: HousekeepingTaskType[] = ['checkout_clean', 'stayover'];

/**
 * Note of a hand-made task without one. A non-null note marks a task asked by
 * hand (`stillDue` keeps it although no stay calls for it), so the generator
 * must never write `notes`.
 */
const HAND_MADE_NOTE = '';

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
    const { store_id, today, current } = await this.ensureToday();
    const [tasks, staff] = await Promise.all([
      this.prisma.lodging_housekeeping_tasks.findMany({
        where: { task_date: dateOnlyToDb(today) },
        select: TASK_SELECT,
        orderBy: [{ unit: { floor: 'asc' } }, { unit: { code: 'asc' } }],
      }),
      this.staff(store_id),
    ]);
    const names = await this.assigneeNames(store_id, tasks, staff);
    return {
      business_date: today,
      tasks: stillDue(tasks, current)
        .map(toView)
        .map((task) => ({
          ...task,
          assigned_user_name:
            task.assigned_user_id == null ? null : (names.get(task.assigned_user_id) ?? null),
        })),
      staff,
    };
  }

  /**
   * U13 — the name of every assignee of the day. A task may still be held by
   * someone who lost the housekeeper role, so names missing from the staff
   * are read from the store's users (read only).
   */
  private async assigneeNames(
    store_id: number,
    tasks: { assigned_user_id: number | null }[],
    staff: HousekeepingStaffMember[],
  ): Promise<Map<number, string>> {
    const names = new Map(staff.map((member) => [member.id, member.name]));
    const missing = [
      ...new Set(
        tasks
          .map((task) => task.assigned_user_id)
          .filter((id): id is number => id != null && !names.has(id)),
      ),
    ];
    if (missing.length === 0) return names;
    const users = await this.prisma.users.findMany({
      where: { id: { in: missing }, store_users: { some: { store_id } } },
      select: { id: true, first_name: true, last_name: true },
    });
    for (const u of users) names.set(u.id, `${u.first_name} ${u.last_name}`.trim());
    return names;
  }

  /** Housekeeper: only the tasks of today assigned to the current user. */
  async mine(): Promise<{ business_date: string; tasks: HousekeepingTaskView[] }> {
    const user_id = this.requireUserId();
    const { today, current } = await this.ensureToday();
    const tasks = await this.prisma.lodging_housekeeping_tasks.findMany({
      where: { task_date: dateOnlyToDb(today), assigned_user_id: user_id },
      select: TASK_SELECT,
      orderBy: [{ status: 'asc' }, { unit: { floor: 'asc' } }, { unit: { code: 'asc' } }],
    });
    return { business_date: today, tasks: stillDue(tasks, current).map(toView) };
  }

  /**
   * U12 — a task asked by hand: an inspection, a repair or a clean of a room
   * without a departure. One task per room, day and type (unique key): a
   * second one is refused naming the type and the room.
   *
   * A task made by hand always stores `notes` (empty when none were given);
   * the daily generation never writes them. That is how `stillDue` tells a
   * hand-made task from a generated one whose stay moved away.
   */
  async create(input: CreateHousekeepingTaskInput): Promise<HousekeepingTaskView> {
    const store_id = this.requireStoreId();
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    const today = localDateString(new Date(), timezone);
    const task_date = input.task_date ?? today;
    if (task_date < today) {
      throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_DATE_001);
    }

    const unit = await this.prisma.lodging_units.findFirst({
      where: { id: input.unit_id, is_active: true },
      select: { id: true, code: true },
    });
    if (!unit) {
      throw new VendixHttpException(ErrorCodes.LODGING_UNIT_FIND_001);
    }
    const assigned_user_id = input.assigned_user_id ?? null;
    if (assigned_user_id != null) {
      const staff = await this.staff(store_id, assigned_user_id);
      if (staff.length === 0) {
        throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001);
      }
    }

    const notes = input.notes?.trim() || HAND_MADE_NOTE;
    try {
      const task = await this.prisma.lodging_housekeeping_tasks.create({
        data: {
          store_id,
          unit_id: unit.id,
          task_date: dateOnlyToDb(task_date),
          type: input.type,
          assigned_user_id,
          notes,
        },
        select: TASK_SELECT,
      });
      return toView(task);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const day = task_date === today ? 'hoy' : `el ${formatShortDate(task_date)}`;
        throw new VendixHttpException(
          ErrorCodes.LODGING_HOUSEKEEPING_TASK_DUP_001,
          `Ya existe una tarea de ${HOUSEKEEPING_TASK_TYPE_LABELS[input.type]} para la ${unit.code} ${day}`,
          { field: 'type' },
        );
      }
      throw error;
    }
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
   * The housekeeper finishes her task. A clean (check-out or stayover) takes
   * the room from "Sucia" to "Limpia" (inspection pending); a room in another
   * status (out of service, already clean) keeps it. An inspection or a
   * repair never changes the room's status.
   */
  async complete(id: number): Promise<HousekeepingTaskView> {
    const store_id = this.requireStoreId();
    const user_id = this.requireUserId();
    const task = await this.prisma.lodging_housekeeping_tasks.findFirst({
      where: { id },
      select: { id: true, unit_id: true, type: true },
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
      if (!CLEANING_TASK_TYPES.includes(task.type)) return;
      await tx.lodging_units.updateMany({
        where: { id: task.unit_id, store_id, housekeeping_status: 'dirty' },
        data: { housekeeping_status: 'clean', updated_at: now },
      });
    });
    return this.findView(id);
  }

  /**
   * Creates today's missing tasks; existing ones (and their assignee) stay.
   * `current` holds the `unit_id:type` keys today's stays still call for.
   */
  private async ensureToday(): Promise<{ store_id: number; today: string; current: Set<string> }> {
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
      // No `notes` here: a null note marks a generated task (see HAND_MADE_NOTE).
      await this.prisma.lodging_housekeeping_tasks.createMany({
        data: tasks.map((task) => ({ ...task, store_id, task_date: day })),
        skipDuplicates: true,
      });
    }
    return { store_id, today, current: new Set(tasks.map(taskKey)) };
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

const taskKey = (task: { unit_id: number; type: HousekeepingTaskType }) =>
  `${task.unit_id}:${task.type}`;

/**
 * A pending generated task whose stay no longer calls for it (cancelled, or
 * moved to another room today) is not shown; finished tasks and tasks made
 * by hand (`notes` not null, see `create`) always stay.
 */
function stillDue<
  T extends {
    status: HousekeepingTaskStatus;
    type: HousekeepingTaskType;
    notes: string | null;
    unit: { id: number };
  },
>(
  tasks: T[],
  current: Set<string>,
): T[] {
  return tasks.filter(
    (task) =>
      task.status !== 'pending' ||
      task.notes !== null || // hand-made, see HAND_MADE_NOTE
      current.has(taskKey({ unit_id: task.unit.id, type: task.type })),
  );
}

function toView(
  task: Omit<HousekeepingTaskView, 'task_date'> & { task_date: Date },
): HousekeepingTaskView {
  // An empty note only marks a hand-made task: the screens get null.
  return {
    ...task,
    notes: task.notes || null,
    task_date: task.task_date.toISOString().slice(0, 10),
  };
}
