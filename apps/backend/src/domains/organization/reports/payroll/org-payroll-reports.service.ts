import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { GlobalPrismaService } from '../../../../prisma/services/global-prisma.service';
import { OrganizationPrismaService } from '../../../../prisma/services/organization-prisma.service';
import { FiscalScopeService } from '@common/services/fiscal-scope.service';
import { RequestContextService } from '@common/context/request-context.service';

/**
 * Reportes de nómina fiscal para ORG_ADMIN.
 *
 * Réplica funcional de `PayrollReportsService` (store) pero usando
 * `OrganizationPrismaService`. Cuando fiscal_scope=ORGANIZATION permite lectura
 * consolidada; cuando fiscal_scope=STORE exige `store_id` para no mezclar
 * obligaciones fiscales de tiendas distintas.
 */
@Injectable()
export class OrgPayrollReportsService {
  private readonly logger = new Logger(OrgPayrollReportsService.name);

  constructor(
    private readonly prisma: GlobalPrismaService,
    private readonly orgPrisma: OrganizationPrismaService,
    private readonly fiscalScope: FiscalScopeService,
  ) {}

  private requireOrgId(): number {
    const orgId = RequestContextService.getOrganizationId();
    if (!orgId) {
      throw new ForbiddenException('Organization context required');
    }
    return orgId;
  }

  private async resolveScope(
    store_id_filter?: number | null,
  ): Promise<{ organization_id: number; store_id: number | null }> {
    const organization_id = this.requireOrgId();
    const fiscalScope = await this.fiscalScope.requireFiscalScope(
      organization_id,
    );

    if (store_id_filter != null) {
      await this.orgPrisma.getScopedWhere({
        organization_id,
        store_id_filter,
      });
      return { organization_id, store_id: store_id_filter };
    }

    if (fiscalScope === 'STORE') {
      throw new BadRequestException(
        'store_id is required when fiscal_scope is STORE',
      );
    }

    return { organization_id, store_id: null };
  }

  private buildRunWhere(
    organization_id: number,
    store_id: number | null,
    date_from?: string,
    date_to?: string,
  ): Prisma.payroll_runsWhereInput {
    const where: Prisma.payroll_runsWhereInput = {
      organization_id,
      status: { in: ['approved', 'paid', 'sent', 'accepted'] },
    };

    if (store_id != null) {
      where.store_id = store_id;
    }

    if (date_from || date_to) {
      const range: Prisma.DateTimeFilter = {};
      if (date_from) range.gte = new Date(date_from);
      if (date_to) range.lte = new Date(date_to);
      where.period_start = range;
    }

    return where;
  }

  /**
   * Resumen de nómina: totales por corrida (period). Consolidado por la
   * organización; con `store_id` opcional filtra solo corridas de esa tienda.
   */
  async getPayrollSummary(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { organization_id, store_id } = await this.resolveScope(
      params.store_id ?? null,
    );

    const where = this.buildRunWhere(
      organization_id,
      store_id,
      params.date_from,
      params.date_to,
    );

    const runs = await this.orgPrisma.payroll_runs.findMany({
      where,
      orderBy: { period_start: 'desc' },
      include: {
        store: { select: { id: true, name: true, slug: true } },
        _count: { select: { payroll_items: true } },
      },
    });

    return runs.map((run) => ({
      period: `${run.period_start.toISOString().split('T')[0]} - ${run.period_end.toISOString().split('T')[0]}`,
      payroll_number: run.payroll_number,
      frequency: run.frequency,
      status: run.status,
      send_status: run.send_status,
      store_id: run.store_id,
      store: run.store,
      total_earnings: Number(run.total_earnings),
      total_deductions: Number(run.total_deductions),
      employer_costs: Number(run.total_employer_costs),
      net_pay: Number(run.total_net_pay),
      employee_count: run._count.payroll_items,
      payment_date: run.payment_date?.toISOString().split('T')[0] || null,
    }));
  }

  /**
   * Detalle por empleado a nivel organización. El filtro `store_id` se aplica
   * a la corrida (`payroll_run.store_id`), no al empleado (employees no tiene
   * store_id en el schema).
   */
  async getPayrollByEmployee(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { organization_id, store_id } = await this.resolveScope(
      params.store_id ?? null,
    );

    const runWhere = this.buildRunWhere(
      organization_id,
      store_id,
      params.date_from,
      params.date_to,
    );

    const items = await this.orgPrisma.payroll_items.findMany({
      where: { payroll_run: runWhere },
      include: {
        employee: {
          select: {
            first_name: true,
            last_name: true,
            position: true,
            department: true,
          },
        },
        payroll_run: {
          select: {
            payroll_number: true,
            period_start: true,
            period_end: true,
            store_id: true,
            store: { select: { id: true, name: true, slug: true } },
          },
        },
      },
      orderBy: { employee: { last_name: 'asc' } },
    });

    return items.map((item) => ({
      employee_name: `${item.employee.first_name} ${item.employee.last_name}`,
      position: item.employee.position || '—',
      department: item.employee.department || '—',
      payroll_period: `${item.payroll_run.period_start.toISOString().split('T')[0]} - ${item.payroll_run.period_end.toISOString().split('T')[0]}`,
      store_id: item.payroll_run.store_id,
      store: item.payroll_run.store,
      base_salary: Number(item.base_salary),
      worked_days: item.worked_days,
      earnings: Number(item.total_earnings),
      deductions: Number(item.total_deductions),
      net_pay: Number(item.net_pay),
    }));
  }

  /**
   * Provisiones laborales por empleado activo. La org tiene un único pool de
   * empleados; el `store_id` filtra solo las corridas de las que se toman las
   * provisiones más recientes.
   */
  async getPayrollProvisions(params: {
    date_from?: string;
    date_to?: string;
    store_id?: number;
  }) {
    const { organization_id, store_id } = await this.resolveScope(
      params.store_id ?? null,
    );

    const employees = await this.orgPrisma.employees.findMany({
      where: { organization_id, status: 'active' },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        hire_date: true,
        base_salary: true,
      },
      orderBy: { last_name: 'asc' },
    });

    const employeeIds = employees.map((e) => e.id);

    const runWhere = this.buildRunWhere(
      organization_id,
      store_id,
      params.date_from,
      params.date_to,
    );

    const latestItems = await this.orgPrisma.payroll_items.findMany({
      where: {
        employee_id: { in: employeeIds },
        payroll_run: runWhere,
      },
      orderBy: { created_at: 'desc' },
      select: { employee_id: true, provisions: true },
    });

    const provisionsByEmployee = new Map<number, any>();
    for (const item of latestItems) {
      if (!provisionsByEmployee.has(item.employee_id) && item.provisions) {
        provisionsByEmployee.set(item.employee_id, item.provisions);
      }
    }

    return employees.map((emp) => {
      const prov = provisionsByEmployee.get(emp.id) || {};
      const severance = Number(prov.severance || 0);
      const severanceInterest = Number(prov.severance_interest || 0);
      const bonus = Number(prov.bonus || 0);
      const vacation = Number(prov.vacation || 0);

      return {
        employee_name: `${emp.first_name} ${emp.last_name}`,
        hire_date: emp.hire_date.toISOString().split('T')[0],
        base_salary: Number(emp.base_salary),
        severance,
        severance_interest: severanceInterest,
        bonus,
        vacation,
        total_provisions: severance + severanceInterest + bonus + vacation,
      };
    });
  }
}
