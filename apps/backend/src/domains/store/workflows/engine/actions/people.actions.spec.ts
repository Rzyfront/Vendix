import { RequestContextService } from '@common/context/request-context.service';
import { WorkflowInstanceRow } from '../workflow-engine.types';
import { WorkflowPeopleActions } from './people.actions';
import {
  WorkflowActionContext,
  WorkflowActionInputError,
  WorkflowVendixActionName,
} from './workflow-action.types';

type Seen = { user_id?: number; store_id?: number; permissions?: string[] };

describe('WorkflowPeopleActions', () => {
  const PERMISSIONS = ['store:crm_tasks:manage'];
  let seen: Seen[];
  let instanceRow: Record<string, unknown>;

  const record = () => {
    const c = RequestContextService.getContext();
    seen.push({
      user_id: c?.user_id,
      store_id: c?.store_id,
      permissions: c?.permissions,
    });
  };
  const svc = (id: number) =>
    jest.fn().mockImplementation(async () => {
      record();
      return { id };
    });

  const prisma = { crm_customer_tags: { findMany: jest.fn() } };
  const assignment = { resolveUserIds: jest.fn() };
  const customers = { create: svc(11), update: svc(12) };
  const customerCrm = { setTags: svc(13) };
  const suppliers = { create: svc(21), update: svc(22) };
  const employees = { create: svc(31), update: svc(32) };
  const crmTasks = { create: svc(77) };
  const reservations = { confirm: svc(41) };
  let actions: WorkflowPeopleActions;

  const run = (
    action: WorkflowVendixActionName,
    map: Record<string, unknown>,
  ) => {
    const ctx: WorkflowActionContext = {
      instance: instanceRow as unknown as WorkflowInstanceRow,
      map,
      actingUserId: 9,
      permissions: PERMISSIONS,
      asPublisher: (fn) =>
        RequestContextService.runIsolated(
          {
            store_id: 1,
            organization_id: 5,
            user_id: 9,
            is_super_admin: false,
            is_owner: false,
            permissions: PERMISSIONS,
          },
          fn,
        ),
    };
    return actions.handlers[action]!(ctx);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    seen = [];
    instanceRow = {
      id: 3,
      store_id: 1,
      organization_id: 5,
      subject_type: null,
      subject_id: null,
    };
    prisma.crm_customer_tags.findMany.mockResolvedValue([{ tag_id: 4 }]);
    assignment.resolveUserIds.mockResolvedValue([]);
    actions = new WorkflowPeopleActions(
      prisma as never,
      assignment as never,
      customers as never,
      customerCrm as never,
      suppliers as never,
      employees as never,
      crmTasks as never,
      reservations as never,
    );
  });

  it('registers exactly the people actions of the registry', () => {
    expect(Object.keys(actions.handlers).sort()).toEqual(
      [
        'vendix.booking.confirm',
        'vendix.crm_task.create',
        'vendix.customer.add_tag',
        'vendix.customer.create',
        'vendix.customer.update',
        'vendix.employee.create',
        'vendix.employee.update',
        'vendix.supplier.create',
        'vendix.supplier.update',
      ].sort(),
    );
  });

  describe('clientes', () => {
    it('crea por CustomersService como el publicador y devuelve el id', async () => {
      const result = await run('vendix.customer.create', {
        first_name: 'Ana',
        last_name: 'Ruiz',
        email: 'ana@example.com',
        phone: '3001234567',
      });
      expect(customers.create).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          first_name: 'Ana',
          last_name: 'Ruiz',
          email: 'ana@example.com',
          phone: '3001234567',
        }),
      );
      expect(seen[0]).toMatchObject({ user_id: 9, store_id: 1, permissions: PERMISSIONS });
      expect(result).toEqual({ record_id: 11 });
    });

    it('rechaza una entrada faltante o inválida sin llamar al servicio', async () => {
      await expect(
        run('vendix.customer.create', { first_name: 'Ana', email: 'a@b.co' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      await expect(
        run('vendix.customer.create', {
          first_name: 'Ana',
          last_name: 'Ruiz',
          email: 'no-es-correo',
        }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(customers.create).not.toHaveBeenCalled();
    });

    it('actualiza solo los campos recibidos', async () => {
      const result = await run('vendix.customer.update', {
        customer_id: '8',
        phone: '3105550000',
      });
      const [storeId, id, dto] = customers.update.mock.calls[0];
      expect(storeId).toBe(1);
      expect(id).toBe(8);
      expect(dto.phone).toBe('3105550000');
      expect(dto.first_name).toBeUndefined();
      expect(result).toEqual({ record_id: 8 });
      await expect(run('vendix.customer.update', { phone: '1' })).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(customers.update).toHaveBeenCalledTimes(1);
    });

    it('add_tag suma la etiqueta a las actuales sin duplicar', async () => {
      await run('vendix.customer.add_tag', { customer_id: 8, tag_id: 6 });
      expect(customerCrm.setTags).toHaveBeenCalledWith(8, [4, 6]);
      expect(seen[0]).toMatchObject({ user_id: 9, store_id: 1 });
      customerCrm.setTags.mockClear();
      const result = await run('vendix.customer.add_tag', { customer_id: 8, tag_id: 4 });
      expect(customerCrm.setTags).toHaveBeenCalledWith(8, [4]);
      expect(result).toEqual({ record_id: 8 });
    });

    it('add_tag sin etiqueta falla sin llamar al servicio', async () => {
      await expect(
        run('vendix.customer.add_tag', { customer_id: 8 }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(customerCrm.setTags).not.toHaveBeenCalled();
    });

    it('add_tag propaga el rechazo de una etiqueta de otra tienda', async () => {
      customerCrm.setTags.mockRejectedValueOnce(new Error('CRM_TAG_001'));
      await expect(
        run('vendix.customer.add_tag', { customer_id: 8, tag_id: 99 }),
      ).rejects.toThrow('CRM_TAG_001');
    });
  });

  describe('proveedores', () => {
    it('crea con código generado y devuelve el id', async () => {
      const result = await run('vendix.supplier.create', {
        name: 'Distribuidora Sol',
        email: 'ventas@sol.co',
      });
      const dto = suppliers.create.mock.calls[0][0];
      expect(dto).toMatchObject({ name: 'Distribuidora Sol', email: 'ventas@sol.co' });
      expect(dto.code).toMatch(/^FLU-/);
      expect(seen[0]).toMatchObject({ user_id: 9, store_id: 1 });
      expect(result).toEqual({ record_id: 21 });
    });

    it('sin nombre falla sin llamar al servicio', async () => {
      await expect(run('vendix.supplier.create', { name: '  ' })).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(suppliers.create).not.toHaveBeenCalled();
    });

    it('actualiza por id', async () => {
      const result = await run('vendix.supplier.update', {
        supplier_id: 5,
        phone: '6015550000',
      });
      expect(suppliers.update).toHaveBeenCalledWith(
        5,
        expect.objectContaining({ phone: '6015550000' }),
      );
      expect(result).toEqual({ record_id: 5 });
      await expect(run('vendix.supplier.update', { name: 'x' })).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(suppliers.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('empleados', () => {
    const EMP = {
      first_name: 'Luis',
      last_name: 'Gómez',
      document_type: 'CC',
      document_number: '1020304050',
      hire_date: '2026-11-01',
      base_salary: '1750905',
      position: 'Cajero',
    };

    it('crea con contrato indefinido y devuelve el id', async () => {
      const result = await run('vendix.employee.create', EMP);
      expect(employees.create).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: 'Luis',
          document_number: '1020304050',
          hire_date: '2026-11-01',
          base_salary: 1750905,
          contract_type: 'indefinite',
          position: 'Cajero',
        }),
      );
      expect(seen[0]).toMatchObject({ user_id: 9, store_id: 1 });
      expect(result).toEqual({ record_id: 31 });
    });

    it('rechaza fecha inválida o dato faltante sin llamar al servicio', async () => {
      await expect(
        run('vendix.employee.create', { ...EMP, hire_date: '01/11/2026' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      await expect(
        run('vendix.employee.create', { ...EMP, base_salary: '' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(employees.create).not.toHaveBeenCalled();
    });

    it('actualiza el cargo y el salario', async () => {
      const result = await run('vendix.employee.update', {
        employee_id: 2,
        position: 'Gerente',
        base_salary: '2500000',
      });
      expect(employees.update).toHaveBeenCalledWith(2, {
        position: 'Gerente',
        base_salary: 2500000,
      });
      expect(result).toEqual({ record_id: 2 });
      await expect(
        run('vendix.employee.update', { position: 'x' }),
      ).rejects.toBeInstanceOf(WorkflowActionInputError);
      expect(employees.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('reservas', () => {
    it('confirma por ReservationsService', async () => {
      const result = await run('vendix.booking.confirm', { booking_id: '15' });
      expect(reservations.confirm).toHaveBeenCalledWith(15);
      expect(seen[0]).toMatchObject({ user_id: 9, store_id: 1 });
      expect(result).toEqual({ record_id: 15 });
    });

    it('sin id falla sin llamar al servicio', async () => {
      await expect(run('vendix.booking.confirm', {})).rejects.toBeInstanceOf(
        WorkflowActionInputError,
      );
      expect(reservations.confirm).not.toHaveBeenCalled();
    });
  });

  describe('Tarea CRM', () => {
    it('crea por CrmTasksService con vencimiento relativo y sin asignar a otro', async () => {
      const before = Date.now();
      const result = await run('vendix.crm_task.create', {
        title: 'Llamar',
        description: 'Ref',
        due_in_days: '3',
      });
      expect(crmTasks.create).toHaveBeenCalledTimes(1);
      const dto = crmTasks.create.mock.calls[0][0];
      expect(dto).toMatchObject({ title: 'Llamar', description: 'Ref' });
      expect(dto.assigned_user_id).toBeUndefined();
      const due = new Date(dto.due_at).getTime();
      expect(due).toBeGreaterThanOrEqual(before + 3 * 86_400_000);
      expect(due).toBeLessThanOrEqual(Date.now() + 3 * 86_400_000);
      expect(seen[0]).toMatchObject({ user_id: 9, permissions: PERMISSIONS });
      expect(assignment.resolveUserIds).not.toHaveBeenCalled();
      expect(result).toEqual({ record_id: 77 });
    });

    it('asigna al primer usuario que resuelve el responsable', async () => {
      assignment.resolveUserIds.mockResolvedValue([2, 3]);
      const def = { kind: 'user', user_id: 2 };
      await run('vendix.crm_task.create', { title: 'T', assignee: def });
      expect(assignment.resolveUserIds).toHaveBeenCalledWith(
        prisma,
        { title: '', message: '', def },
        instanceRow,
      );
      expect(crmTasks.create.mock.calls[0][0].assigned_user_id).toBe(2);
    });

    it('título vacío o vencimiento fuera de rango fallan sin llamar al servicio', async () => {
      for (const map of [
        { title: '' },
        { title: '   ' },
        { title: 'x', due_in_days: '999' },
        { title: 'x', due_in_days: 'tres' },
      ]) {
        await expect(run('vendix.crm_task.create', map)).rejects.toThrow();
      }
      expect(crmTasks.create).not.toHaveBeenCalled();
    });

    it('sobre una solicitud de un cliente enlaza al cliente', async () => {
      instanceRow.subject_type = 'customer';
      instanceRow.subject_id = 55;
      await run('vendix.crm_task.create', { title: 'T' });
      expect(crmTasks.create.mock.calls[0][0].customer_id).toBe(55);
    });
  });
});
