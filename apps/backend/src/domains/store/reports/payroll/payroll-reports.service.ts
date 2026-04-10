import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';

@Injectable()
export class PayrollReportsService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) throw new Error('No request context found');
    return context;
  }

  /**
   * Reporte: Resumen de Nomina
   * Totales por periodo: devengados, deducciones, costos patronales, neto
   */
  async getPayrollSummary(dateFrom?: string, dateTo?: string) {
    const { organization_id } = this.getContext();

    const where: any = {
      organization_id,
      status: { in: ['approved', 'paid', 'sent', 'accepted'] },
    };

    if (dateFrom || dateTo) {
      where.period_start = {};
      if (dateFrom) where.period_start.gte = new Date(dateFrom);
      if (dateTo) where.period_start.lte = new Date(dateTo);
    }

    const runs = await this.prisma.payroll_runs.findMany({
      where,
      orderBy: { period_start: 'desc' },
      include: {
        _count: { select: { payroll_items: true } },
      },
    });

    return runs.map((run) => ({
      period: `${run.period_start.toISOString().split('T')[0]} - ${run.period_end.toISOString().split('T')[0]}`,
      payroll_number: run.payroll_number,
      frequency: run.frequency,
      status: run.status,
      total_earnings: Number(run.total_earnings),
      total_deductions: Number(run.total_deductions),
      employer_costs: Number(run.total_employer_costs),
      net_pay: Number(run.total_net_pay),
      employee_count: run._count.payroll_items,
      payment_date: run.payment_date?.toISOString().split('T')[0] || null,
    }));
  }

  /**
   * Reporte: Nomina por Empleado
   * Detalle de cada empleado en el periodo seleccionado
   */
  async getPayrollByEmployee(dateFrom?: string, dateTo?: string) {
    const { organization_id } = this.getContext();

    const runWhere: any = {
      organization_id,
      status: { in: ['approved', 'paid', 'sent', 'accepted'] },
    };

    if (dateFrom || dateTo) {
      runWhere.period_start = {};
      if (dateFrom) runWhere.period_start.gte = new Date(dateFrom);
      if (dateTo) runWhere.period_start.lte = new Date(dateTo);
    }

    const items = await this.prisma.payroll_items.findMany({
      where: {
        payroll_run: runWhere,
      },
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
          },
        },
      },
      orderBy: {
        employee: { last_name: 'asc' },
      },
    });

    return items.map((item) => ({
      employee_name: `${item.employee.first_name} ${item.employee.last_name}`,
      position: item.employee.position || '—',
      department: item.employee.department || '—',
      payroll_period: `${item.payroll_run.period_start.toISOString().split('T')[0]} - ${item.payroll_run.period_end.toISOString().split('T')[0]}`,
      base_salary: Number(item.base_salary),
      worked_days: item.worked_days,
      earnings: Number(item.total_earnings),
      deductions: Number(item.total_deductions),
      net_pay: Number(item.net_pay),
    }));
  }

  /**
   * Reporte: Provisiones Laborales
   * Cesantias, intereses, primas y vacaciones acumuladas por empleado
   */
  async getPayrollProvisions(dateFrom?: string, dateTo?: string) {
    const { organization_id } = this.getContext();

    // Get active employees
    const employees = await this.prisma.employees.findMany({
      where: {
        organization_id,
        status: 'active',
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        hire_date: true,
        base_salary: true,
      },
      orderBy: { last_name: 'asc' },
    });

    // Get latest payroll items with provisions for each employee
    const employeeIds = employees.map((e) => e.id);

    const runWhere: any = {
      organization_id,
      status: { in: ['approved', 'paid', 'sent', 'accepted'] },
    };

    if (dateFrom || dateTo) {
      runWhere.period_start = {};
      if (dateFrom) runWhere.period_start.gte = new Date(dateFrom);
      if (dateTo) runWhere.period_start.lte = new Date(dateTo);
    }

    const latestItems = await this.prisma.payroll_items.findMany({
      where: {
        employee_id: { in: employeeIds },
        payroll_run: runWhere,
      },
      orderBy: { created_at: 'desc' },
      select: {
        employee_id: true,
        provisions: true,
      },
    });

    // Group provisions by employee (take latest)
    const provisionsByEmployee = new Map<number, any>();
    for (const item of latestItems) {
      if (!provisionsByEmployee.has(item.employee_id) && item.provisions) {
        provisionsByEmployee.set(item.employee_id, item.provisions);
      }
    }

    return employees.map((emp) => {
      const prov = (provisionsByEmployee.get(emp.id) || {}) as any;
      const severance = Number(prov.severance || 0);
      const severanceInterest = Number(prov.severance_interest || 0);
      const bonus = Number(prov.bonus || 0);
      const vacation = Number(prov.vacation || 0);

      return {
        employee_name: `${emp.first_name} ${emp.last_name}`,
        hire_date: emp.hire_date.toISOString().split('T')[0],
        base_salary: Number(emp.base_salary),
        severance: severance,
        severance_interest: severanceInterest,
        bonus: bonus,
        vacation: vacation,
        total_provisions: severance + severanceInterest + bonus + vacation,
      };
    });
  }
}
