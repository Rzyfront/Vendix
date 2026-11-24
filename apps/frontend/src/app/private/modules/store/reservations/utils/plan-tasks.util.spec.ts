import {
  planTaskCrmLink,
  planTaskKindLabel,
  planTaskOwnerLabel,
  planTaskStatusClass,
  planTaskStatusLabel,
  sortPlanTasks,
} from './plan-tasks.util';
import type { PlanBookingTask } from '../../products/services/service-plans.service';

const task = (over: Partial<PlanBookingTask>): PlanBookingTask => ({
  link_id: 1,
  task_id: 10,
  activity_id: 5,
  day_number: 1,
  kind: 'internal',
  title: 'Guía',
  status: 'pending',
  due_at: '2099-03-10T12:00:00.000Z',
  assigned_user: null,
  ...over,
});

describe('plan-tasks.util (QUI-1060 F3)', () => {
  it('etiqueta los estados en español', () => {
    expect(planTaskStatusLabel('pending')).toBe('Pendiente');
    expect(planTaskStatusLabel('done')).toBe('Hecha');
    expect(planTaskStatusLabel('cancelled')).toBe('Cancelada');
    expect(planTaskStatusLabel(null)).toBe('Pendiente');
  });

  it('asigna clase de insignia por estado', () => {
    expect(planTaskStatusClass('done')).toBe('paid');
    expect(planTaskStatusClass('pending')).toBe('pending');
    expect(planTaskStatusClass('cancelled')).toBe('');
  });

  it('muestra el responsable o «Sin asignar»', () => {
    expect(planTaskOwnerLabel({ assigned_user: { id: 1, first_name: 'Ana', last_name: 'Ruiz' } })).toBe('Ana Ruiz');
    expect(planTaskOwnerLabel({ assigned_user: { id: 1, first_name: 'Ana', last_name: null } })).toBe('Ana');
    expect(planTaskOwnerLabel({ assigned_user: { id: 1, first_name: null, last_name: null } })).toBe('Sin asignar');
    expect(planTaskOwnerLabel({ assigned_user: null })).toBe('Sin asignar');
  });

  it('nombra el tipo de tarea', () => {
    expect(planTaskKindLabel('supplier')).toBe('Proveedor');
    expect(planTaskKindLabel('internal')).toBe('Equipo propio');
    expect(planTaskKindLabel('none')).toBe('');
  });

  it('arma el enlace al CRM con la tarea', () => {
    expect(planTaskCrmLink(42)).toEqual({ path: '/admin/customers/tasks', queryParams: { task: 42 } });
  });

  it('ordena por fecha, sin fecha al final, sin mutar la entrada', () => {
    const input = [
      task({ link_id: 1, due_at: null }),
      task({ link_id: 2, due_at: '2099-03-11T08:00:00.000Z', day_number: 2 }),
      task({ link_id: 3, due_at: '2099-03-10T08:00:00.000Z', day_number: 1 }),
    ];
    expect(sortPlanTasks(input).map((t) => t.link_id)).toEqual([3, 2, 1]);
    expect(input[0].link_id).toBe(1);
  });
});
