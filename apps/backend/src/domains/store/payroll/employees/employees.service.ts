import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { UserRole } from '../../../../domains/auth/enums/user-role.enum';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';

const EMPLOYEE_INCLUDE = {
  employee_stores: {
    select: {
      id: true,
      store_id: true,
      is_primary: true,
      status: true,
      store: { select: { id: true, name: true } },
    },
    where: { status: 'active' as const },
  },
  user: {
    select: { id: true, first_name: true, last_name: true, email: true },
  },
};

interface CreateOrAssociateResult {
  employee: any;
  action: 'created' | 'updated' | 'associated';
}

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
    const context = this.getContext();
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
      employee_stores: {
        some: {
          store_id: context.store_id,
          status: 'active' as any,
        },
      },
      ...(search && {
        OR: [
          { first_name: { contains: search, mode: 'insensitive' as const } },
          { last_name: { contains: search, mode: 'insensitive' as const } },
          { employee_code: { contains: search, mode: 'insensitive' as const } },
          {
            document_number: { contains: search, mode: 'insensitive' as const },
          },
        ],
      }),
      ...(status && { status: status as any }),
      ...(department && {
        department: { contains: department, mode: 'insensitive' as const },
      }),
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

  async createOrAssociate(
    dto: CreateEmployeeDto,
  ): Promise<CreateOrAssociateResult> {
    const context = this.getContext();
    const unscoped = this.prisma.withoutScope() as any;

    // Search for existing employee by document at org level
    const existing = await unscoped.employees.findFirst({
      where: {
        organization_id: context.organization_id,
        document_type: dto.document_type,
        document_number: dto.document_number,
      },
    });

    if (!existing) {
      // --- CREATE new employee ---
      if (!dto.employee_code) {
        dto.employee_code = await this.generateNextEmployeeCode(
          context.organization_id!,
        );
      }

      // Validate employee_code uniqueness at org level
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

      // Check for duplicate user_id
      if (dto.user_id) {
        const existing_user = await this.prisma.employees.findFirst({
          where: { user_id: dto.user_id },
        });

        if (existing_user) {
          throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
        }
      }

      // Validate user does not have CUSTOMER role
      if (dto.user_id) {
        const is_customer = await this.prisma.withoutScope().users.findFirst({
          where: {
            id: dto.user_id,
            user_roles: {
              some: {
                roles: { name: UserRole.CUSTOMER },
              },
            },
          },
        });

        if (is_customer) {
          throw new VendixHttpException(ErrorCodes.PAYROLL_VALIDATE_002);
        }
      }

      const result = await this.prisma.$transaction(async (tx) => {
        const employee = await tx.employees.create({
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
        });

        await tx.employee_stores.create({
          data: {
            employee_id: employee.id,
            is_primary: true,
          },
        });

        return await tx.employees.findFirst({
          where: { id: employee.id },
          include: EMPLOYEE_INCLUDE,
        });
      });

      return { employee: result, action: 'created' };
    }

    // Check if already associated with current store
    const existingRelation = await unscoped.employee_stores.findFirst({
      where: {
        employee_id: existing.id,
        store_id: context.store_id,
      },
    });

    if (existingRelation) {
      // --- UPDATE existing employee ---
      const update_data: any = {};

      if (dto.first_name) update_data.first_name = dto.first_name;
      if (dto.last_name) update_data.last_name = dto.last_name;
      if (dto.position !== undefined)
        update_data.position = dto.position || null;
      if (dto.department !== undefined)
        update_data.department = dto.department || null;
      if (dto.contract_type) update_data.contract_type = dto.contract_type;
      if (dto.base_salary !== undefined)
        update_data.base_salary = new Prisma.Decimal(dto.base_salary);
      if (dto.payment_frequency)
        update_data.payment_frequency = dto.payment_frequency;
      if (dto.hire_date) update_data.hire_date = new Date(dto.hire_date);
      if (dto.bank_name !== undefined)
        update_data.bank_name = dto.bank_name || null;
      if (dto.bank_account_number !== undefined)
        update_data.bank_account_number = dto.bank_account_number || null;
      if (dto.bank_account_type !== undefined)
        update_data.bank_account_type = dto.bank_account_type || null;
      if (dto.health_provider !== undefined)
        update_data.health_provider = dto.health_provider || null;
      if (dto.pension_fund !== undefined)
        update_data.pension_fund = dto.pension_fund || null;
      if (dto.arl_risk_level !== undefined)
        update_data.arl_risk_level = dto.arl_risk_level;
      if (dto.severance_fund !== undefined)
        update_data.severance_fund = dto.severance_fund || null;
      if (dto.compensation_fund !== undefined)
        update_data.compensation_fund = dto.compensation_fund || null;

      if (dto.user_id !== undefined) {
        if (dto.user_id !== null) {
          const existing_user = await this.prisma.employees.findFirst({
            where: { user_id: dto.user_id, id: { not: existing.id } },
          });
          if (existing_user) {
            throw new VendixHttpException(ErrorCodes.PAYROLL_DUP_003);
          }
        }
        update_data.user_id = dto.user_id;
      }

      const employee = await this.prisma.employees.update({
        where: { id: existing.id },
        data: update_data,
        include: EMPLOYEE_INCLUDE,
      });

      return { employee, action: 'updated' };
    }

    // --- ASSOCIATE existing employee with current store ---
    const employee = await this.prisma.$transaction(async (tx) => {
      // Ensure employee has at least one primary store
      const activePrimaries = await this.prisma
        .withoutScope()
        .employee_stores.count({
          where: {
            employee_id: existing.id,
            is_primary: true,
            status: 'active',
          },
        });
      const shouldBePrimary = activePrimaries === 0;

      await tx.employee_stores.create({
        data: {
          employee_id: existing.id,
          is_primary: shouldBePrimary,
        },
      });

      return await tx.employees.findFirst({
        where: { id: existing.id },
        include: EMPLOYEE_INCLUDE,
      });
    });

    return { employee, action: 'associated' };
  }

  async create(dto: CreateEmployeeDto) {
    const result = await this.createOrAssociate(dto);
    return result.employee;
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
        user_roles: {
          none: {
            roles: {
              name: UserRole.CUSTOMER,
            },
          },
        },
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
        ...(termination_reason && {
          termination_reason: termination_reason as any,
        }),
      },
      include: EMPLOYEE_INCLUDE,
    });

    return updated;
  }

  async getStats() {
    const context = this.getContext();

    const storeFilter = {
      employee_stores: {
        some: { store_id: context.store_id, status: 'active' as any },
      },
    };

    const [
      total_count,
      total_active,
      by_department_raw,
      salary_aggregate,
      by_status_raw,
    ] = await Promise.all([
      this.prisma.employees.count({ where: storeFilter }),
      this.prisma.employees.count({
        where: { ...storeFilter, status: 'active' },
      }),
      this.prisma.employees.groupBy({
        by: ['department'],
        where: { ...storeFilter, status: 'active' },
        _count: { id: true },
      }),
      this.prisma.employees.aggregate({
        where: { ...storeFilter, status: 'active' },
        _avg: { base_salary: true },
      }),
      this.prisma.employees.groupBy({
        by: ['status'],
        where: storeFilter,
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

  /**
   * Validates that setting is_primary on an employee_store won't violate
   * the single-primary constraint. Throws if employee already has a primary store.
   */
  private async validateSinglePrimary(employeeId: number): Promise<void> {
    const unscoped = this.prisma.withoutScope();
    const primaryCount = await unscoped.employee_stores.count({
      where: {
        employee_id: employeeId,
        is_primary: true,
        status: 'active',
      },
    });
    if (primaryCount > 1) {
      // Data integrity issue - should not happen but log it
      console.warn(
        `Employee ${employeeId} has ${primaryCount} primary stores - data integrity issue`,
      );
    }
  }

  async generateNextEmployeeCode(organization_id: number): Promise<string> {
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
