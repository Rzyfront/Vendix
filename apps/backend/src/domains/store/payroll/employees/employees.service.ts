import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';

const EMPLOYEE_INCLUDE = {
  store: {
    select: { id: true, name: true },
  },
  user: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
};

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async findAll(query: QueryEmployeeDto) {
    const {
      page = 1,
      limit = 10,
      search,
      sort_by = 'created_at',
      sort_order = 'desc',
      status,
      department,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.employeesWhereInput = {
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' as const } },
          { last_name: { contains: search, mode: 'insensitive' as const } },
          { employee_code: { contains: search, mode: 'insensitive' as const } },
          { document_number: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
      ...(status && { status: status as any }),
      ...(department && { department: { contains: department, mode: 'insensitive' as const } }),
    };

    const [data, total] = await Promise.all([
      this.prisma.employees.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sort_by]: sort_order },
        include: EMPLOYEE_INCLUDE,
      }),
      this.prisma.employees.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    const employee = await this.prisma.employees.findFirst({
      where: { id },
      include: EMPLOYEE_INCLUDE,
    });

    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    return employee;
  }

  async create(dto: CreateEmployeeDto) {
    const context = this.getContext();

    // Auto-generate employee_code if not provided
    if (!dto.employee_code) {
      dto.employee_code = await this.generateNextEmployeeCode(context.organization_id!);
    }

    // Check for duplicate employee_code (org-level unique constraint)
    const unscoped = this.prisma.withoutScope() as any;
    if (dto.employee_code) {
      const existing_code = await unscoped.employees.findFirst({
        where: {
          organization_id: context.organization_id,
          employee_code: dto.employee_code,
        },
      });

      if (existing_code) {
        throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_001);
      }
    }

    // Check for duplicate document (org-level unique constraint)
    const existing_doc = await unscoped.employees.findFirst({
      where: {
        organization_id: context.organization_id,
        document_type: dto.document_type,
        document_number: dto.document_number,
      },
    });

    if (existing_doc) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_002);
    }

    // Check for duplicate user_id
    if (dto.user_id) {
      const existing_user = await this.prisma.employees.findFirst({
        where: { user_id: dto.user_id },
      });

      if (existing_user) {
        throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
      }
    }

    const employee = await this.prisma.employees.create({
      data: {
        organization_id: context.organization_id,
        user_id: dto.user_id || null,
        employee_code: dto.employee_code,
        first_name: dto.first_name,
        last_name: dto.last_name,
        document_type: dto.document_type,
        document_number: dto.document_number,
        hire_date: new Date(dto.hire_date),
        contract_type: dto.contract_type as any,
        base_salary: new Prisma.Decimal(dto.base_salary),
        payment_frequency: (dto.payment_frequency || 'monthly') as any,
        position: dto.position || null,
        department: dto.department || null,
        bank_name: dto.bank_name || null,
        bank_account_number: dto.bank_account_number || null,
        bank_account_type: dto.bank_account_type || null,
        health_provider: dto.health_provider || null,
        pension_fund: dto.pension_fund || null,
        arl_risk_level: dto.arl_risk_level || 1,
        severance_fund: dto.severance_fund || null,
        compensation_fund: dto.compensation_fund || null,
      },
      include: EMPLOYEE_INCLUDE,
    });

    return employee;
  }

  async getAvailableUsers() {
    const context = this.getContext();

    const linked_employees = await this.prisma.employees.findMany({
      where: { user_id: { not: null } },
      select: { user_id: true },
    });

    const linked_user_ids = linked_employees
      .map((e) => e.user_id)
      .filter((id): id is number => id !== null);

    const users = await this.prisma.users.findMany({
      where: {
        organization_id: context.organization_id,
        ...(linked_user_ids.length > 0 && {
          id: { notIn: linked_user_ids },
        }),
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        email: true,
        document_type: true,
        document_number: true,
      },
    });

    return users;
  }

  async update(id: number, dto: UpdateEmployeeDto) {
    await this.findOne(id);

    const update_data: any = { ...dto };

    if (dto.base_salary !== undefined) {
      update_data.base_salary = new Prisma.Decimal(dto.base_salary);
    }

    if (dto.hire_date) {
      update_data.hire_date = new Date(dto.hire_date);
    }

    // Check for duplicate user_id
    if (dto.user_id !== undefined && dto.user_id !== null) {
      const existing_user = await this.prisma.employees.findFirst({
        where: {
          user_id: dto.user_id,
          id: { not: id },
        },
      });

      if (existing_user) {
        throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
      }
    }

    // Remove fields that should not be passed directly
    delete update_data.user_id;

    if (dto.user_id !== undefined) {
      update_data.user_id = dto.user_id;
    }

    const employee = await this.prisma.employees.update({
      where: { id },
      data: update_data,
      include: EMPLOYEE_INCLUDE,
    });

    return employee;
  }

  async terminate(id: number, termination_reason?: string) {
    const employee = await this.findOne(id);

    if (employee.status === 'terminated') {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_VALIDATE_001,
        'Employee is already terminated',
      );
    }

    const updated = await this.prisma.employees.update({
      where: { id },
      data: {
        status: 'terminated',
        termination_date: new Date(),
        ...(termination_reason && { termination_reason: termination_reason as any }),
      },
      include: EMPLOYEE_INCLUDE,
    });

    return updated;
  }

  async getStats() {
    const [
      total_count,
      total_active,
      by_department_raw,
      salary_aggregate,
      by_status_raw,
    ] = await Promise.all([
      this.prisma.employees.count(),
      this.prisma.employees.count({
        where: { status: 'active' },
      }),
      this.prisma.employees.groupBy({
        by: ['department'],
        where: { status: 'active' },
        _count: { id: true },
      }),
      this.prisma.employees.aggregate({
        where: { status: 'active' },
        _avg: { base_salary: true },
      }),
      this.prisma.employees.groupBy({
        by: ['status'],
        _count: { id: true },
      }),
    ]);

    const by_department = by_department_raw.map((item) => ({
      department: item.department || 'Unassigned',
      count: item._count.id,
    }));

    const by_status: Record<string, number> = {
      active: 0,
      inactive: 0,
      terminated: 0,
    };
    for (const row of by_status_raw) {
      if (row.status) {
        by_status[row.status] = row._count.id;
      }
    }

    return {
      total: total_count,
      active: total_active,
      inactive: (by_status['inactive'] || 0) + (by_status['terminated'] || 0),
      avg_salary: Number(salary_aggregate._avg.base_salary || 0),
      by_department,
    };
  }

  async generateNextEmployeeCode(organization_id: number): Promise<string> {
    // withoutScope: la unique constraint es a nivel organization, no store
    const unscoped = this.prisma.withoutScope() as any;
    const last_employee = await unscoped.employees.findMany({
      where: {
        organization_id,
        employee_code: { startsWith: 'EMP-' },
      },
      select: { employee_code: true },
      orderBy: { employee_code: 'desc' },
      take: 1,
    });

    let next_number = 1;
    if (last_employee.length > 0) {
      const last_code = last_employee[0].employee_code;
      const parsed = parseInt(last_code.replace('EMP-', ''), 10);
      if (!isNaN(parsed)) {
        next_number = parsed + 1;
      }
    }

    return `EMP-${String(next_number).padStart(4, '0')}`;
  }
}

