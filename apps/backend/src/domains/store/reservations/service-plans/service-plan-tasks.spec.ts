import { Prisma } from '@prisma/client';
import { RequestContextService } from '@common/context/request-context.service';
import { ServicePlanTasksService } from './service-plan-tasks.service';
import { ServicePlanTasksListener } from './service-plan-tasks.listener';
import {
  activityStartsAt,
  buildPlanTaskContent,
  planTaskDueAt,
  replacePlanTaskDateLine,
} from './service-plan-tasks.util';

/**
 * QUI-1060 F3 · Actividades del plan → tareas del CRM. Base en memoria con el
 * aislamiento del cliente de tienda: cada delegado solo ve filas de la tienda del
 * contexto (como `StorePrismaService`).
 */
let ctxStoreId = 1;
type Row = Record<string, any>;

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond) return row[key] !== cond.not;
      return true;
    }
    return row[key] === cond;
  });
}

const NOW = new Date('2099-03-01T15:00:00.000Z');

function buildDb(opts: { status?: string; bookingDate?: string } = {}) {
  const products: Row[] = [
    { id: 10, store_id: 1, name: 'Eje Cafetero 3D/2N', service_pricing_type: 'package', plan_duration_days: 3 },
    { id: 11, store_id: 1, name: 'Corte de pelo', service_pricing_type: 'per_hour', plan_duration_days: null },
    { id: 20, store_id: 2, name: 'Plan ajeno', service_pricing_type: 'package', plan_duration_days: 2 },
  ];
  const bookings: Row[] = [
    { id: 1, store_id: 1, product_id: 10, booking_number: 'BKG-1', date: new Date(`${opts.bookingDate ?? '2099-03-10'}T00:00:00.000Z`), status: opts.status ?? 'confirmed', customer_id: 300, created_by_user_id: 77 },
    { id: 2, store_id: 1, product_id: 11, booking_number: 'BKG-2', date: new Date('2099-03-10T00:00:00.000Z'), status: 'confirmed', customer_id: 300, created_by_user_id: 77 },
    { id: 3, store_id: 2, product_id: 20, booking_number: 'BKG-3', date: new Date('2099-03-10T00:00:00.000Z'), status: 'confirmed', customer_id: 301, created_by_user_id: 88 },
  ];
  const activities: Row[] = [
    // Interno con usuario, día 1 a las 08:00.
    { id: 100, store_id: 1, product_id: 10, day_number: 1, start_time: '08:00', title: 'Recogida en el hotel', provider_id: 5, supplier_id: null, supplier_name: null, supplier_contact: null, creates_task: true },
    // Interno legacy sin usuario, día 3 sin hora.
    { id: 101, store_id: 1, product_id: 10, day_number: 3, start_time: null, title: 'Despedida', provider_id: 6, supplier_id: null, supplier_name: null, supplier_contact: null, creates_task: true },
    // Tercero escrito a mano, día 2 a las 09:30.
    { id: 102, store_id: 1, product_id: 10, day_number: 2, start_time: '09:30', title: 'Paseo en jeep', provider_id: null, supplier_id: null, supplier_name: 'Jeeps Willys', supplier_contact: '311 000', creates_task: true },
    // Sin «Crear tarea al vender».
    { id: 103, store_id: 1, product_id: 10, day_number: 2, start_time: '14:00', title: 'Almuerzo', provider_id: null, supplier_id: null, supplier_name: null, supplier_contact: null, creates_task: false },
    // Tercero registrado, día 2 sin hora.
    { id: 104, store_id: 1, product_id: 10, day_number: 2, start_time: null, title: 'Finca cafetera', provider_id: null, supplier_id: 40, supplier_name: 'Copia vieja', supplier_contact: 'viejo', creates_task: true },
    { id: 900, store_id: 2, product_id: 20, day_number: 1, start_time: null, title: 'Ajena', provider_id: null, supplier_id: null, supplier_name: null, supplier_contact: null, creates_task: true },
  ];
  const providers: Row[] = [
    { id: 5, store_id: 1, user_id: 55, display_name: 'Guía Pedro', user: { first_name: 'Pedro', last_name: 'Pérez' }, employee: null },
    { id: 6, store_id: 1, user_id: null, display_name: null, user: null, employee: { first_name: 'Lucía', last_name: 'Gómez' } },
  ];
  const suppliers: Row[] = [
    { id: 40, organization_id: 1, store_id: null, name: 'Café La Esperanza', contact_person: 'Marta', mobile: '320 999', phone: null, email: null },
  ];
  const tasks: Row[] = [];
  const links: Row[] = [];
  let nextId = 1000;

  const scoped = (rows: Row[]) => rows.filter((r) => r.store_id === ctxStoreId);
  const withTask = (l: Row, select: Row) => {
    const out: Row = { ...l };
    if (select?.crm_task) {
      const t = tasks.find((x) => x.id === l.crm_task_id);
      out.crm_task = t
        ? { ...t, supporters: [], assigned_user: t.assigned_user_id ? { id: t.assigned_user_id, first_name: 'U', last_name: String(t.assigned_user_id) } : null }
        : null;
    }
    if (select?.activity) {
      const a = activities.find((x) => x.id === l.activity_id);
      out.activity = a ? { ...a } : null;
    }
    return out;
  };

  const prisma: any = {
    bookings: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const b = scoped(bookings).find((r) => matches(r, where));
        if (!b) return null;
        const product = products.find((p) => p.id === b.product_id && p.store_id === b.store_id);
        return { ...b, product: product ? { ...product } : null };
      }),
    },
    service_plan_activities: {
      findMany: jest.fn(async ({ where }: Row) => scoped(activities).filter((r) => matches(r, where)).map((r) => ({ ...r }))),
    },
    service_providers: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const p = scoped(providers).find((r) => matches(r, where));
        return p ? { ...p } : null;
      }),
    },
    suppliers: {
      findFirst: jest.fn(async ({ where }: Row) => {
        const s = suppliers.find((r) => r.organization_id === 1 && r.id === where.id);
        return s ? { ...s } : null;
      }),
    },
    service_plan_booking_tasks: {
      findMany: jest.fn(async ({ where, select }: Row) =>
        scoped(links)
          .filter((r) => matches(r, where))
          .map((l) => withTask(l, select)),
      ),
      create: jest.fn(async ({ data }: Row) => {
        if (links.some((l) => l.booking_id === data.booking_id && l.activity_id === data.activity_id)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
        }
        const row = { id: nextId++, ...data };
        links.push(row);
        return { ...row };
      }),
    },
    crm_tasks: {
      create: jest.fn(async ({ data }: Row) => {
        const row = { id: nextId++, status: 'pending', completed_at: null, ...data };
        tasks.push(row);
        return { ...row, supporters: [] };
      }),
      updateMany: jest.fn(async ({ where, data }: Row) => {
        const hits = scoped(tasks).filter((r) => matches(r, where));
        for (const h of hits) Object.assign(h, data);
        return { count: hits.length };
      }),
    },
    store_settings: { findFirst: jest.fn(async () => ({ settings: {}, stores: { timezone: 'America/Bogota' } })) },
  };
  // Sin rollback real: el create de la tarea se deshace a mano si el enlace choca.
  prisma.$transaction = jest.fn(async (cb: (tx: any) => unknown) => {
    const before = tasks.length;
    try {
      return await cb(prisma);
    } catch (e) {
      tasks.splice(before);
      throw e;
    }
  });

  const reminders = { sync: jest.fn(async () => ({ scheduled: [], cancelled: 0 })) };
  const dispatcher = { notify: jest.fn(async () => []) };
  const service = new ServicePlanTasksService(prisma, reminders as any, dispatcher as any);
  return { prisma, service, tasks, links, bookings, activities, reminders, dispatcher };
}

const byTitle = (tasks: Row[], fragment: string) => tasks.find((t) => t.title.includes(fragment))!;

describe('Tareas del plan (QUI-1060 F3)', () => {
  beforeEach(() => {
    ctxStoreId = 1;
  });

  describe('confirmar la reserva de un plan', () => {
    it('crea una tarea por actividad con «Crear tarea al vender», con due_at real en la zona de la tienda', async () => {
      const { service, tasks, links } = buildDb();
      const result = await service.syncBooking(1, 9, NOW);

      expect(result).toEqual({ created: 4, rescheduled: 0, cancelled: 0 });
      expect(tasks).toHaveLength(4);
      expect(links.map((l) => l.activity_id).sort()).toEqual([100, 101, 102, 104]);
      expect(tasks.some((t) => t.title.includes('Almuerzo'))).toBe(false);
      // Día 1 08:00 Bogotá (UTC−5) = 13:00 UTC.
      expect(byTitle(tasks, 'Recogida').due_at.toISOString()).toBe('2099-03-10T13:00:00.000Z');
      // Día 3 sin hora = inicio del día 12/03 en Bogotá.
      expect(byTitle(tasks, 'Despedida').due_at.toISOString()).toBe('2099-03-12T05:00:00.000Z');
      for (const t of tasks) {
        expect(t).toMatchObject({ store_id: 1, customer_id: 300, created_by_user_id: 9, status: 'pending' });
        expect(t.description).toContain('Plan: Eje Cafetero 3D/2N · reserva BKG-1');
      }
      expect(byTitle(tasks, 'Recogida').description).toContain('Fecha de la actividad: 10/03/2099 08:00');
      expect(byTitle(tasks, 'Despedida').description).toContain('Fecha de la actividad: 12/03/2099 (sin hora)');
    });

    it('interno: asignada al usuario del prestador; prestador sin usuario: sin asignar y lo dice', async () => {
      const { service, tasks, dispatcher } = buildDb();
      await service.syncBooking(1, 9, NOW);
      expect(byTitle(tasks, 'Recogida')).toMatchObject({ title: 'Recogida en el hotel', assigned_user_id: 55 });
      const legacy = byTitle(tasks, 'Despedida');
      expect(legacy.assigned_user_id).toBeNull();
      expect(legacy.description).toContain('Lucía Gómez no tiene usuario en Vendix; la tarea queda sin asignar.');
      // Aviso de asignación al guía (no a quien confirmó).
      expect(dispatcher.notify).toHaveBeenCalledWith(expect.objectContaining({ user_ids: [55], type: 'crm_task_assigned' }));
    });

    it('tercero: «Confirmar con proveedor» 48 h antes, asignada a quien creó la reserva', async () => {
      const { service, tasks } = buildDb();
      await service.syncBooking(1, 9, NOW);
      const jeep = byTitle(tasks, 'Paseo en jeep');
      expect(jeep.title).toBe('Confirmar con proveedor: Jeeps Willys · Paseo en jeep');
      // Día 2 09:30 Bogotá = 11/03 14:30 UTC; 48 h antes = 09/03 14:30 UTC.
      expect(jeep.due_at.toISOString()).toBe('2099-03-09T14:30:00.000Z');
      expect(jeep.assigned_user_id).toBe(77);
      expect(jeep.description).toContain('Contacto: 311 000');
      // Proveedor registrado: manda la ficha viva sobre la copia del itinerario.
      const finca = byTitle(tasks, 'Finca cafetera');
      expect(finca.title).toBe('Confirmar con proveedor: Café La Esperanza · Finca cafetera');
      expect(finca.description).toContain('Contacto: Marta · 320 999');
    });

    it('tercero cuyo plazo de 48 h ya pasó: vence ahora', async () => {
      const { service, tasks } = buildDb({ bookingDate: '2099-03-01' });
      await service.syncBooking(1, 9, NOW);
      expect(byTitle(tasks, 'Paseo en jeep').due_at.getTime()).toBe(NOW.getTime());
    });

    it('idempotente: reconfirmar o reintentar no duplica', async () => {
      const { service, tasks } = buildDb();
      await service.syncBooking(1, 9, NOW);
      const again = await service.syncBooking(1, 9, NOW);
      expect(again.created).toBe(0);
      expect(tasks).toHaveLength(4);
    });

    it('una carrera que choca con el UNIQUE no duplica ni falla', async () => {
      const { service, prisma, tasks } = buildDb();
      // Simula que otra confirmación enlazó la actividad 100 entre la lectura y la escritura.
      const realFindMany = prisma.service_plan_booking_tasks.findMany;
      prisma.service_plan_booking_tasks.findMany = jest.fn(async (args: Row) => {
        const rows = await realFindMany(args);
        return args.select?.crm_task ? rows : [];
      });
      await service.syncBooking(1, 9, NOW);
      await expect(service.syncBooking(1, 9, NOW)).resolves.toMatchObject({ created: 0 });
      expect(tasks).toHaveLength(4);
    });

    it('reserva aún pendiente: no crea tareas', async () => {
      const { service, tasks } = buildDb({ status: 'pending' });
      await service.syncBooking(1, 9, NOW);
      expect(tasks).toHaveLength(0);
    });

    it('sincroniza los recordatorios de cada tarea creada', async () => {
      const { service, reminders } = buildDb();
      await service.syncBooking(1, 9, NOW);
      expect(reminders.sync).toHaveBeenCalledTimes(4);
      expect(reminders.sync).toHaveBeenCalledWith(expect.objectContaining({ source_type: 'crm_task', store_id: 1, status: 'pending' }));
    });
  });

  describe('cancelación y cambio de fechas', () => {
    it('cancelar: pendientes pasan a cancelada; las completadas quedan intactas', async () => {
      const { service, tasks, bookings } = buildDb();
      await service.syncBooking(1, 9, NOW);
      const done = byTitle(tasks, 'Recogida');
      done.status = 'done';
      bookings[0].status = 'cancelled';

      const result = await service.syncBooking(1, null, NOW);

      expect(result.cancelled).toBe(3);
      expect(done.status).toBe('done');
      expect(tasks.filter((t) => t !== done).every((t) => t.status === 'cancelled')).toBe(true);
    });

    it('cambio de fecha de una reserva confirmada: recalcula due_at y la fecha de la descripción de las pendientes', async () => {
      const { service, tasks, bookings } = buildDb();
      await service.syncBooking(1, 9, NOW);
      const done = byTitle(tasks, 'Despedida');
      done.status = 'done';
      const doneDue = done.due_at;
      bookings[0].date = new Date('2099-04-20T00:00:00.000Z');

      const result = await service.syncBooking(1, null, NOW);

      expect(result).toMatchObject({ created: 0, rescheduled: 3 });
      const pickup = byTitle(tasks, 'Recogida');
      expect(pickup.due_at.toISOString()).toBe('2099-04-20T13:00:00.000Z');
      expect(pickup.description).toContain('Fecha de la actividad: 20/04/2099 08:00');
      expect(byTitle(tasks, 'Paseo en jeep').due_at.toISOString()).toBe('2099-04-19T14:30:00.000Z');
      expect(done.due_at).toBe(doneDue);
    });
  });

  describe('alcance', () => {
    it('reserva normal (no plan): ninguna tarea', async () => {
      const { service, tasks } = buildDb();
      await expect(service.syncBooking(2, 9, NOW)).resolves.toEqual({ created: 0, rescheduled: 0, cancelled: 0 });
      expect(tasks).toHaveLength(0);
      await expect(service.listForBooking(2)).resolves.toBeNull();
    });

    it('aislamiento: la tienda A no genera ni lee tareas de una reserva de la tienda B', async () => {
      const { service, tasks } = buildDb();
      await service.syncBooking(3, 9, NOW);
      expect(tasks).toHaveLength(0);
      await expect(service.listForBooking(3)).rejects.toMatchObject({ errorCode: 'SERVICE_PLAN_026' });

      ctxStoreId = 2;
      await service.syncBooking(3, 9, NOW);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ store_id: 2, customer_id: 301 });
    });

    it('«Tareas del plan»: lista título, estado, responsable y fecha ordenadas por vencimiento', async () => {
      const { service } = buildDb();
      await service.syncBooking(1, 9, NOW);
      const list = await service.listForBooking(1);
      expect(list).toHaveLength(4);
      expect(list![0]).toMatchObject({ kind: 'supplier', title: 'Confirmar con proveedor: Café La Esperanza · Finca cafetera', status: 'pending', assigned_user: { id: 77 } });
      expect(list!.map((t) => t.due_at)).toEqual([...list!.map((t) => t.due_at)].sort());
      expect(list!.find((t) => t.activity_id === 100)).toMatchObject({ kind: 'internal', day_number: 1, assigned_user: { id: 55 } });
    });
  });
});

describe('ServicePlanTasksListener', () => {
  const runner = { runInStoreContext: jest.fn(async (_id: number, cb: () => Promise<unknown>) => cb()) };

  afterEach(() => jest.restoreAllMocks());

  it('una falla del CRM no tumba la confirmación: se registra y sigue', async () => {
    const planTasks = { syncBooking: jest.fn(async () => { throw new Error('crm caído'); }) };
    const listener = new ServicePlanTasksListener(planTasks as any, runner as any);
    const logSpy = jest.spyOn((listener as any).logger, 'error').mockImplementation(() => undefined);
    await expect(listener.onConfirmed({ store_id: 1, booking_id: 1 })).resolves.toBeUndefined();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('crm caído'));
  });

  it('quien confirmó desde el panel queda como creador; un cliente del ecommerce no', async () => {
    const planTasks = { syncBooking: jest.fn(async () => ({ created: 0, rescheduled: 0, cancelled: 0 })) };
    const listener = new ServicePlanTasksListener(planTasks as any, runner as any);
    const ctx = jest.spyOn(RequestContextService, 'getContext');

    ctx.mockReturnValue({ user_id: 9, store_id: 1, app_type: 'STORE_ADMIN', is_super_admin: false, is_owner: false });
    await listener.onConfirmed({ store_id: 1, booking_id: 1 });
    expect(planTasks.syncBooking).toHaveBeenLastCalledWith(1, 9);

    ctx.mockReturnValue({ user_id: 300, store_id: 1, app_type: 'STORE_ECOMMERCE', is_super_admin: false, is_owner: false });
    await listener.onCancelled({ store_id: 1, booking_id: 1 });
    expect(planTasks.syncBooking).toHaveBeenLastCalledWith(1, null);

    expect(runner.runInStoreContext).toHaveBeenCalledWith(1, expect.any(Function));
  });
});

describe('service-plan-tasks.util', () => {
  it('activityStartsAt respeta la zona de la tienda (también con horario de verano)', () => {
    expect(activityStartsAt('2099-03-10', 2, '09:30', 'America/Bogota').toISOString()).toBe('2099-03-11T14:30:00.000Z');
    // Nueva York: 15/07 es horario de verano (UTC−4).
    expect(activityStartsAt('2099-07-14', 2, '09:30', 'America/New_York').toISOString()).toBe('2099-07-15T13:30:00.000Z');
  });

  it('planTaskDueAt: interno a la hora de la actividad; tercero 48 h antes y nunca en el pasado', () => {
    const at = new Date('2099-03-11T14:30:00.000Z');
    expect(planTaskDueAt('internal', at, NOW)).toBe(at);
    expect(planTaskDueAt('supplier', at, NOW).toISOString()).toBe('2099-03-09T14:30:00.000Z');
    expect(planTaskDueAt('supplier', at, new Date('2099-03-10T00:00:00.000Z')).toISOString()).toBe('2099-03-10T00:00:00.000Z');
  });

  it('replacePlanTaskDateLine reescribe solo la línea de fecha', () => {
    const { description } = buildPlanTaskContent({
      kind: 'none', activityTitle: 'X', dayNumber: 1, date: '2099-03-10', startTime: null, planName: 'P', bookingNumber: 'B',
    });
    const updated = replacePlanTaskDateLine(`${description}\nNota del equipo`, '2099-05-01', '07:15');
    expect(updated).toContain('Fecha de la actividad: 01/05/2099 07:15');
    expect(updated).toContain('Nota del equipo');
    expect(replacePlanTaskDateLine('sin línea', '2099-05-01', null)).toBeNull();
  });
});
