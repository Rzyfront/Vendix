import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { WorkflowAssigneeDef } from '@common/workflows/contract';
import { StorePrismaService } from '../../../../../prisma/services/store-prisma.service';
import { CustomersService } from '../../../customers/customers.service';
import { CreateCustomerDto } from '../../../customers/dto/create-customer.dto';
import { UpdateCustomerDto } from '../../../customers/dto/update-customer.dto';
import { CustomerCrmService } from '../../../customers/crm/profile/customer-crm.service';
import { CrmTasksService } from '../../../customers/crm/tasks/crm-tasks.service';
import { CreateCrmTaskDto } from '../../../customers/crm/tasks/dto/crm-tasks.dto';
import { SuppliersService } from '../../../inventory/suppliers/suppliers.service';
import { CreateInventorySupplierDto } from '../../../inventory/suppliers/dto/create-supplier.dto';
import { UpdateSupplierDto } from '../../../inventory/suppliers/dto/update-supplier.dto';
import { EmployeesService } from '../../../payroll/employees/employees.service';
import { CreateEmployeeDto } from '../../../payroll/employees/dto/create-employee.dto';
import { UpdateEmployeeDto } from '../../../payroll/employees/dto/update-employee.dto';
import { ReservationsService } from '../../../reservations/reservations.service';
import { WorkflowAssignmentService } from '../workflow-assignment.service';
import {
  WorkflowActionContext,
  WorkflowActionGroup,
  WorkflowActionHandlerMap,
  WorkflowActionInputError,
  WorkflowActionResult,
  actionInputs,
  must,
  returnedId,
} from './workflow-action.types';

const DAY_MS = 86_400_000;
const MAX_DUE_IN_DAYS = 365;

/** Drops the inputs the flow left empty so a partial update never blanks a field. */
function defined<T extends object>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

/**
 * The global ValidationPipe does not run for a flow, so the DTO the UI route
 * would receive is validated here with the same decorators.
 */
function validated<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): T {
  const dto = plainToInstance(cls, plain, { enableImplicitConversion: true });
  const errors = validateSync(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length) {
    const reasons = errors
      .flatMap((e) => Object.values(e.constraints ?? {}))
      .join('; ');
    throw new WorkflowActionInputError(reasons || 'Invalid input');
  }
  return dto;
}

/** Supplier code the UI form would ask for; generated because the registry has none. */
function supplierCode(): string {
  const stamp = Date.now().toString(36).toUpperCase();
  const salt = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `FLU-${stamp}${salt}`;
}

/** Vendix actions of the registry (P1.2): clientes, proveedores, empleados, etiquetas, tareas CRM y reservas. */
@Injectable()
export class WorkflowPeopleActions implements WorkflowActionGroup {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly assignment: WorkflowAssignmentService,
    private readonly customers: CustomersService,
    private readonly customerCrm: CustomerCrmService,
    private readonly suppliers: SuppliersService,
    private readonly employees: EmployeesService,
    private readonly crmTasks: CrmTasksService,
    private readonly reservations: ReservationsService,
  ) {}

  readonly handlers: WorkflowActionHandlerMap = {
    'vendix.customer.create': (ctx) => this.createCustomer(ctx),
    'vendix.customer.update': (ctx) => this.updateCustomer(ctx),
    'vendix.customer.add_tag': (ctx) => this.addCustomerTag(ctx),
    'vendix.supplier.create': (ctx) => this.createSupplier(ctx),
    'vendix.supplier.update': (ctx) => this.updateSupplier(ctx),
    'vendix.employee.create': (ctx) => this.createEmployee(ctx),
    'vendix.employee.update': (ctx) => this.updateEmployee(ctx),
    'vendix.crm_task.create': (ctx) => this.createCrmTask(ctx),
    'vendix.booking.confirm': (ctx) => this.confirmBooking(ctx),
  };

  private async createCustomer(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.customer.create', ctx.map);
    const dto = validated(
      CreateCustomerDto,
      defined({
        first_name: i.text('first_name'),
        last_name: i.text('last_name'),
        email: i.text('email'),
        phone: i.text('phone'),
        document_type: i.text('document_type'),
        document_number: i.text('document_number'),
      }),
    );
    const created = await ctx.asPublisher(() =>
      this.customers.create(ctx.instance.store_id, dto),
    );
    return { record_id: returnedId(created, 'Customer service') };
  }

  private async updateCustomer(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.customer.update', ctx.map);
    const customerId = must(i.id('customer_id'), 'customer_id');
    const dto = validated(
      UpdateCustomerDto,
      defined({
        first_name: i.text('first_name'),
        last_name: i.text('last_name'),
        phone: i.text('phone'),
      }),
    );
    await ctx.asPublisher(() =>
      this.customers.update(ctx.instance.store_id, customerId, dto),
    );
    return { record_id: customerId };
  }

  /** `setTags` replaces the set, so the new tag is added to the current ones. */
  private async addCustomerTag(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.customer.add_tag', ctx.map);
    const customerId = must(i.id('customer_id'), 'customer_id');
    const tagId = must(i.id('tag_id'), 'tag_id');
    await ctx.asPublisher(async () => {
      const current = await this.prisma.crm_customer_tags.findMany({
        where: { customer_id: customerId },
        select: { tag_id: true },
      });
      const tagIds = new Set(current.map((row) => row.tag_id));
      tagIds.add(tagId);
      return this.customerCrm.setTags(customerId, [...tagIds]);
    });
    return { record_id: customerId };
  }

  private async createSupplier(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.supplier.create', ctx.map);
    const dto = validated(
      CreateInventorySupplierDto,
      defined({
        name: must(i.text('name', 255), 'name'),
        code: supplierCode(),
        tax_id: i.text('tax_id'),
        email: i.text('email'),
        phone: i.text('phone'),
        contact_person: i.text('contact_person'),
      }),
    );
    const created = await ctx.asPublisher(() => this.suppliers.create(dto));
    return { record_id: returnedId(created, 'Supplier service') };
  }

  private async updateSupplier(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.supplier.update', ctx.map);
    const supplierId = must(i.id('supplier_id'), 'supplier_id');
    const dto = validated(
      UpdateSupplierDto,
      defined({
        name: i.text('name', 255),
        email: i.text('email'),
        phone: i.text('phone'),
        contact_person: i.text('contact_person'),
      }),
    );
    await ctx.asPublisher(() => this.suppliers.update(supplierId, dto));
    return { record_id: supplierId };
  }

  private async createEmployee(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.employee.create', ctx.map);
    const dto = validated(
      CreateEmployeeDto,
      defined({
        first_name: i.text('first_name', 100),
        last_name: i.text('last_name', 100),
        document_type: i.text('document_type', 20),
        document_number: i.text('document_number', 50),
        hire_date: i.date('hire_date'),
        base_salary: i.money('base_salary'),
        position: i.text('position', 100),
        email: i.text('email'),
        contract_type: 'indefinite',
      }),
    );
    const created = await ctx.asPublisher(() => this.employees.create(dto));
    return { record_id: returnedId(created, 'Employee service') };
  }

  private async updateEmployee(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.employee.update', ctx.map);
    const employeeId = must(i.id('employee_id'), 'employee_id');
    const dto = validated(
      UpdateEmployeeDto,
      defined({
        position: i.text('position', 100),
        base_salary: i.money('base_salary'),
        email: i.text('email'),
        phone: i.text('phone'),
      }),
    );
    await ctx.asPublisher(() => this.employees.update(employeeId, dto));
    return { record_id: employeeId };
  }

  private async confirmBooking(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const i = actionInputs('vendix.booking.confirm', ctx.map);
    const bookingId = must(i.id('booking_id'), 'booking_id');
    await ctx.asPublisher(() => this.reservations.confirm(bookingId));
    return { record_id: bookingId };
  }

  private async createCrmTask(
    ctx: WorkflowActionContext,
  ): Promise<WorkflowActionResult> {
    const { instance, map } = ctx;
    const i = actionInputs('vendix.crm_task.create', map);
    const title = must(i.text('title', 200), 'title');
    const description = i.text('description', 5000);
    const dueInDays = i.int('due_in_days');
    if (dueInDays !== undefined && dueInDays > MAX_DUE_IN_DAYS) {
      throw new WorkflowActionInputError(
        `"due_in_days" must be an integer between 0 and ${MAX_DUE_IN_DAYS} (got "${dueInDays}")`,
      );
    }
    let assignee: number | undefined;
    const def = map.assignee as WorkflowAssigneeDef | undefined;
    if (def && typeof def === 'object') {
      const ids = await this.assignment.resolveUserIds(
        this.prisma,
        { title: '', message: '', def },
        instance,
      );
      assignee = ids[0];
    }
    // Handing a task to someone else needs the CRM see-all permission: the
    // flow never widens the publisher's, and the CRM service refuses without it.
    const dto: CreateCrmTaskDto = {
      title,
      ...(description && { description }),
      ...(dueInDays !== undefined && {
        due_at: new Date(Date.now() + dueInDays * DAY_MS).toISOString(),
      }),
      ...(assignee !== undefined && { assigned_user_id: assignee }),
      ...(instance.subject_type === 'customer' &&
        instance.subject_id && { customer_id: instance.subject_id }),
    };
    const created = await ctx.asPublisher(() => this.crmTasks.create(dto));
    return { record_id: returnedId(created, 'CRM service') };
  }
}
