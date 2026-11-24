import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { localDateString, resolveStoreTimezone } from '@common/utils/store-timezone.util';
import { VendixHttpException, ErrorCodes } from 'src/common/errors';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { dateOnlyToDb } from '../reservations/stay-dates';
import { cleaningRoleNames, HOUSEKEEPING_OPERATE_PERMISSION } from './cleaning-role';

/** A person who can receive the clean, as the check-out lists her. */
export interface CheckoutCleanStaff {
  id: number;
  name: string;
  /** Holds the fixed cleaning role: listed first. */
  is_cleaning_role: boolean;
  /** Pending tasks of today already assigned to her (lighter load first). */
  pending_tasks: number;
}

export type CheckoutCleanPriority = 'high' | 'normal';

export interface CheckoutCleanRoom {
  unit_id: number;
  code: string;
  floor: string | null;
  unit_type_name: string;
  /** High when a guest arrives today to this same room. */
  priority: CheckoutCleanPriority;
  priority_reason: string | null;
  /** Prefilled note (the priority reason, editable). */
  suggested_note: string;
  /** Recommended person: the current assignee, else the lightest of the list. */
  suggested_user_id: number | null;
  /** Today's check-out clean of the room, when the day's list already made it. */
  existing_task: {
    id: number;
    status: 'pending' | 'done';
    assigned_user_id: number | null;
  } | null;
}

export interface CheckoutCleanSuggestion {
  reservation_id: number;
  business_date: string;
  rooms: CheckoutCleanRoom[];
  staff: CheckoutCleanStaff[];
}

export interface CheckoutCleanAssignment {
  unit_id: number;
  /** undefined: keep the current assignee; null: leave it unassigned. */
  assigned_user_id?: number | null;
  notes?: string | null;
}

export interface CheckoutCleanResultRow {
  unit_id: number;
  code: string;
  task_id: number;
  assigned_user_id: number | null;
  /** created: new task; assigned: the day's task got the person; done: already cleaned. */
  outcome: 'created' | 'assigned' | 'done';
}

/**
 * The recommended order: the cleaning role first, then the lighter load of
 * the day, then by name.
 */
export function rankCheckoutCleanStaff(staff: CheckoutCleanStaff[]): CheckoutCleanStaff[] {
  return [...staff].sort(
    (a, b) =>
      Number(b.is_cleaning_role) - Number(a.is_cleaning_role) ||
      a.pending_tasks - b.pending_tasks ||
      a.name.localeCompare(b.name, 'es'),
  );
}

/**
 * One recommended person per room, spreading the rooms over the cleaning
 * role by the lightest load. Without anyone in the role nobody is
 * preselected ("Sin asignar"): the other staff stay a manual choice, so a
 * manager is never handed a clean by default.
 */
export function suggestAssignees(
  unitIds: number[],
  ranked: CheckoutCleanStaff[],
): Map<number, number | null> {
  const pool = ranked.filter((s) => s.is_cleaning_role);
  const load = new Map(pool.map((s) => [s.id, s.pending_tasks]));
  const result = new Map<number, number | null>();
  for (const unit_id of unitIds) {
    let best: CheckoutCleanStaff | null = null;
    for (const s of pool) {
      if (!best || (load.get(s.id) ?? 0) < (load.get(best.id) ?? 0)) best = s;
    }
    result.set(unit_id, best?.id ?? null);
    if (best) load.set(best.id, (load.get(best.id) ?? 0) + 1);
  }
  return result;
}

const HIGH_PRIORITY_REASON = 'Prioridad alta: llega un huésped hoy a esta habitación';

/**
 * Agenda unificada (F3) — when the desk closes a check-out it is offered the
 * clean of each room the guest left: prefilled task (room, priority, note)
 * and a recommended list of people, the fixed cleaning role first. Accepting
 * creates today's check-out clean with the chosen person, or gives the
 * person to the one the day's list already made (unique room/day/type key).
 * Skipping calls nothing.
 */
@Injectable()
export class CheckoutCleanService {
  constructor(private readonly prisma: StorePrismaService) {}

  async suggestion(reservation_id: number): Promise<CheckoutCleanSuggestion> {
    const store_id = this.requireStoreId();
    const today = await this.today(store_id);
    const rooms = await this.checkedOutRooms(reservation_id);
    const unitIds = rooms.map((r) => r.unit.id);

    const [staff, existing, arrivals] = await Promise.all([
      this.staff(store_id, today),
      this.prisma.lodging_housekeeping_tasks.findMany({
        where: { unit_id: { in: unitIds }, task_date: dateOnlyToDb(today), type: 'checkout_clean' },
        select: { id: true, unit_id: true, status: true, assigned_user_id: true },
      }),
      this.prisma.lodging_reservation_rooms.findMany({
        where: {
          unit_id: { in: unitIds },
          cancelled_at: null,
          arrival_date: dateOnlyToDb(today),
          reservation_id: { not: reservation_id },
          reservation: { status: { in: ['tentative', 'confirmed', 'checked_in'] } },
        },
        select: { unit_id: true },
      }),
    ]);

    const taskByUnit = new Map<number, (typeof existing)[number]>(
      existing.map((t) => [t.unit_id, t]),
    );
    const arriving = new Set(arrivals.map((a) => a.unit_id));
    const pendingUnits = unitIds.filter((id) => taskByUnit.get(id)?.status !== 'done');
    // The current assignee is kept only while she may still receive cleans:
    // preselecting someone who lost the role would fail the whole batch.
    const eligible = new Set(staff.map((s) => s.id));
    const holder = (unit_id: number): number | null => {
      const id = taskByUnit.get(unit_id)?.assigned_user_id ?? null;
      return id != null && eligible.has(id) ? id : null;
    };
    const suggested = suggestAssignees(
      pendingUnits.filter((id) => holder(id) == null),
      staff,
    );

    return {
      reservation_id,
      business_date: today,
      staff,
      rooms: rooms.map(({ unit }) => {
        const task = taskByUnit.get(unit.id) ?? null;
        const high = arriving.has(unit.id);
        return {
          unit_id: unit.id,
          code: unit.code,
          floor: unit.floor,
          unit_type_name: unit.unit_type.name,
          priority: high ? 'high' : 'normal',
          priority_reason: high ? HIGH_PRIORITY_REASON : null,
          suggested_note: high ? HIGH_PRIORITY_REASON : '',
          suggested_user_id: holder(unit.id) ?? suggested.get(unit.id) ?? null,
          existing_task: task
            ? { id: task.id, status: task.status, assigned_user_id: task.assigned_user_id }
            : null,
        };
      }),
    };
  }

  async assign(
    reservation_id: number,
    assignments: CheckoutCleanAssignment[],
  ): Promise<CheckoutCleanResultRow[]> {
    const store_id = this.requireStoreId();
    const today = await this.today(store_id);
    const rooms = await this.checkedOutRooms(reservation_id);
    const unitById = new Map<number, (typeof rooms)[number]['unit']>(
      rooms.map((r) => [r.unit.id, r.unit]),
    );

    for (const item of assignments) {
      if (!unitById.has(item.unit_id)) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_RESERVATION_ROOM_FIND_001,
          'La habitación no pertenece a esta reserva',
        );
      }
    }
    const people = [
      ...new Set(
        assignments
          .map((a) => a.assigned_user_id ?? null)
          .filter((id): id is number => id != null),
      ),
    ];
    if (people.length > 0) {
      const eligible = new Set((await this.staff(store_id, today, people)).map((s) => s.id));
      if (people.some((id) => !eligible.has(id))) {
        throw new VendixHttpException(
          ErrorCodes.LODGING_HOUSEKEEPING_TASK_ASSIGNEE_001,
          'La persona no puede recibir tareas de limpieza en esta tienda',
        );
      }
    }

    const results: CheckoutCleanResultRow[] = [];
    for (const item of assignments) {
      const unit = unitById.get(item.unit_id)!;
      results.push(await this.assignOne(store_id, today, unit, item));
    }
    return results;
  }

  private async assignOne(
    store_id: number,
    today: string,
    unit: { id: number; code: string },
    item: CheckoutCleanAssignment,
  ): Promise<CheckoutCleanResultRow> {
    // undefined keeps whoever already holds the day's task; null unassigns it.
    const keep = item.assigned_user_id === undefined;
    const assigned_user_id = item.assigned_user_id ?? null;
    const note = item.notes?.trim() || null;
    const key = { unit_id: unit.id, task_date: dateOnlyToDb(today), type: 'checkout_clean' as const };
    const base = { unit_id: unit.id, code: unit.code };

    const current = await this.prisma.lodging_housekeeping_tasks.findFirst({
      where: key,
      select: { id: true, status: true, assigned_user_id: true },
    });
    if (current?.status === 'done') {
      return { ...base, task_id: current.id, assigned_user_id: current.assigned_user_id, outcome: 'done' };
    }
    if (!current) {
      try {
        // A null note keeps it a generated task: today's stays call for it.
        const created = await this.prisma.lodging_housekeeping_tasks.create({
          data: { store_id, ...key, assigned_user_id, notes: note },
          select: { id: true },
        });
        return { ...base, task_id: created.id, assigned_user_id, outcome: 'created' };
      } catch (error) {
        // The day's list made it meanwhile: give it the person below.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    }
    const task =
      current ??
      (await this.prisma.lodging_housekeeping_tasks.findFirst({
        where: key,
        select: { id: true, assigned_user_id: true },
      }));
    if (!task) {
      throw new VendixHttpException(ErrorCodes.LODGING_HOUSEKEEPING_TASK_FIND_001);
    }
    const { count } = await this.prisma.lodging_housekeeping_tasks.updateMany({
      where: { id: task.id, status: 'pending' },
      data: {
        ...(keep ? {} : { assigned_user_id }),
        ...(note ? { notes: note } : {}),
        updated_at: new Date(),
      },
    });
    if (count === 0) {
      return { ...base, task_id: task.id, assigned_user_id: null, outcome: 'done' };
    }
    const holder = keep ? (task.assigned_user_id ?? null) : assigned_user_id;
    return { ...base, task_id: task.id, assigned_user_id: holder, outcome: 'assigned' };
  }

  /** Rooms (with a unit) of a reservation that already checked out. */
  private async checkedOutRooms(reservation_id: number) {
    const reservation = await this.prisma.lodging_reservations.findFirst({
      where: { id: reservation_id },
      select: {
        id: true,
        status: true,
        rooms: {
          where: { cancelled_at: null, unit_id: { not: null } },
          select: {
            unit: {
              select: { id: true, code: true, floor: true, unit_type: { select: { name: true } } },
            },
          },
        },
      },
    });
    if (!reservation) {
      throw new VendixHttpException(ErrorCodes.LODGING_RESERVATION_FIND_001);
    }
    if (reservation.status !== 'checked_out') {
      throw new VendixHttpException(
        ErrorCodes.LODGING_RESERVATION_TRANSITION_001,
        'La limpieza de salida se asigna después del check-out',
      );
    }
    const seen = new Set<number>();
    return reservation.rooms
      .filter((r): r is { unit: NonNullable<typeof r.unit> } => r.unit != null)
      .filter((r) => (seen.has(r.unit.id) ? false : (seen.add(r.unit.id), true)));
  }

  /**
   * Active users of the store who hold the cleaning role or may finish
   * cleaning tasks (the housekeeping operate permission), in recommended order.
   */
  private async staff(store_id: number, today: string, only_ids?: number[]): Promise<CheckoutCleanStaff[]> {
    const roleNames = cleaningRoleNames();
    const scope = { OR: [{ store_id: null }, { store_id }] };
    const users = await this.prisma.users.findMany({
      where: {
        ...(only_ids ? { id: { in: only_ids } } : {}),
        state: 'active',
        store_users: { some: { store_id } },
        user_roles: {
          some: {
            ...scope,
            roles: {
              OR: [
                { name: { in: roleNames } },
                {
                  role_permissions: {
                    some: {
                      granted: true,
                      // Same rule as PermissionsGuard: an inactive permission grants nothing.
                      permissions: { name: HOUSEKEEPING_OPERATE_PERMISSION, status: 'active' },
                    },
                  },
                },
              ],
            },
          },
        },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        user_roles: { where: scope, select: { roles: { select: { name: true } } } },
      },
    });
    if (users.length === 0) return [];

    const assigned = await this.prisma.lodging_housekeeping_tasks.findMany({
      where: {
        task_date: dateOnlyToDb(today),
        status: 'pending',
        assigned_user_id: { in: users.map((u) => u.id) },
      },
      select: { assigned_user_id: true },
    });
    const load = new Map<number, number>();
    for (const t of assigned) {
      if (t.assigned_user_id != null) load.set(t.assigned_user_id, (load.get(t.assigned_user_id) ?? 0) + 1);
    }
    return rankCheckoutCleanStaff(
      users.map((u) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`.trim(),
        is_cleaning_role: u.user_roles.some((ur) =>
          roleNames.includes((ur.roles?.name ?? '').toLowerCase()),
        ),
        pending_tasks: load.get(u.id) ?? 0,
      })),
    );
  }

  private async today(store_id: number): Promise<string> {
    const timezone = await resolveStoreTimezone(this.prisma, store_id);
    return localDateString(new Date(), timezone);
  }

  private requireStoreId(): number {
    const store_id = RequestContextService.getContext()?.store_id;
    if (!store_id) {
      throw new VendixHttpException(ErrorCodes.STORE_CONTEXT_001);
    }
    return store_id;
  }
}
