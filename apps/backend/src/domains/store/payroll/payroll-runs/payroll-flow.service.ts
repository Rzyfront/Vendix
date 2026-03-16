import { Injectable, Inject, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PayrollCalculationService } from '../calculation/payroll-calculation.service';
import { PayrollRulesService } from '../calculation/payroll-rules.service';
import {
  PAYROLL_PROVIDER,
  PayrollProviderAdapter,
} from '../providers/payroll-provider.interface';

type PayrollStatus =
  | 'draft'
  | 'calculated'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'paid'
  | 'cancelled';

const VALID_TRANSITIONS: Record<PayrollStatus, PayrollStatus[]> = {
  draft: ['calculated', 'cancelled'],
  calculated: ['approved', 'draft', 'cancelled'],
  approved: ['sent', 'paid', 'cancelled'],
  sent: ['accepted', 'rejected', 'paid'],
  accepted: ['paid'],
  rejected: ['draft'],
  paid: [],
  cancelled: [],
};

const PAYROLL_RUN_INCLUDE = {
  store: {
    select: { id: true, name: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

const PAYROLL_RUN_DETAIL_INCLUDE = {
  ...PAYROLL_RUN_INCLUDE,
  payroll_items: {
    include: {
      employee: {
        select: {
          id: true,
          employee_code: true,
          first_name: true,
          last_name: true,
          document_type: true,
          document_number: true,
          position: true,
          department: true,
          cost_center: true,
        },
      },
    },
  },
};

@Injectable()
export class PayrollFlowService {
  private readonly logger = new Logger(PayrollFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly calculation_service: PayrollCalculationService,
    private readonly payroll_rules_service: PayrollRulesService,
    private readonly event_emitter: EventEmitter2,
    @Inject(PAYROLL_PROVIDER)
    private readonly payroll_provider: PayrollProviderAdapter,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getPayrollRun(id: number) {
    const run = await this.prisma.payroll_runs.findFirst({
      where: { id },
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    if (!run) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_002);
    }

    return run;
  }

  private validateTransition(current_status: string, target_status: PayrollStatus): void {
    const valid_targets = VALID_TRANSITIONS[current_status as PayrollStatus] || [];
    if (!valid_targets.includes(target_status)) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Invalid status transition: cannot change from '${current_status}' to '${target_status}'. ` +
          `Valid transitions from '${current_status}': [${valid_targets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  /**
   * Calculate all employee payroll items for a run.
   * Transitions: draft -> calculated
   */
  async calculate(id: number) {
    const run = await this.getPayrollRun(id);
    this.validateTransition(run.status, 'calculated');

    // Resolve rules for the period year from DB (with defaults fallback)
    const year = run.period_start.getFullYear();
    const rules = await this.payroll_rules_service.getRulesForYear(year);

    const calculations = await this.calculation_service.calculateForRun(
      id,
      run.period_start,
      run.period_end,
      run.store_id,
      rules,
    );

    // Snapshot the rules used for this calculation (immutable audit trail)
    await this.prisma.payroll_runs.update({
      where: { id },
      data: { applied_rules: rules as any },
    });

    const updated = await this.prisma.payroll_runs.findFirst({
      where: { id },
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    this.event_emitter.emit('payroll.calculated', {
      payroll_run_id: id,
      employee_count: calculations.length,
    });

    this.logger.log(`Payroll run #${id} calculated: ${calculations.length} employees`);

    return updated;
  }

  /**
   * Approve a calculated payroll run.
   * Transitions: calculated -> approved
   */
  async approve(id: number) {
    const run = await this.getPayrollRun(id);
    const context = this.getContext();

    this.validateTransition(run.status, 'approved');

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: {
        status: 'approved',
        approved_by_user_id: context.user_id,
        approved_at: new Date(),
      },
      include: PAYROLL_RUN_INCLUDE,
    });

    // Build cost center breakdown from payroll items
    const cost_center_breakdown: Record<string, { earnings: number; employer_costs: number }> = {};
    for (const item of (run as any).payroll_items || []) {
      const cc = item.employee?.cost_center || 'administrative';
      if (!cost_center_breakdown[cc]) {
        cost_center_breakdown[cc] = { earnings: 0, employer_costs: 0 };
      }
      cost_center_breakdown[cc].earnings += Number(item.total_earnings || 0);
      cost_center_breakdown[cc].employer_costs += Number(item.total_employer_costs || 0);
    }

    this.event_emitter.emit('payroll.approved', {
      payroll_run_id: id,
      organization_id: run.organization_id,
      store_id: run.store_id,
      total_earnings: Number(run.total_earnings || 0),
      total_employer_costs: Number(run.total_employer_costs || 0),
      total_deductions: Number(run.total_deductions || 0),
      total_net_pay: Number(run.total_net_pay || 0),
      health_deduction: Number(run.health_deduction || 0),
      pension_deduction: Number(run.pension_deduction || 0),
      approved_by: context.user_id,
      cost_center_breakdown,
    });

    this.logger.log(`Payroll run #${id} approved by user #${context.user_id}`);

    return updated;
  }

  /**
   * Send payroll to DIAN via the provider adapter.
   * Transitions: approved -> sent
   */
  async send(id: number) {
    const run = await this.getPayrollRun(id);

    this.validateTransition(run.status, 'sent');

    // Prepare data for provider
    const items = (run as any).payroll_items.map((item: any) => ({
      employee_id: item.employee.id,
      employee_code: item.employee.employee_code,
      document_type: item.employee.document_type,
      document_number: item.employee.document_number,
      first_name: item.employee.first_name,
      last_name: item.employee.last_name,
      base_salary: Number(item.base_salary),
      worked_days: item.worked_days,
      earnings: item.earnings,
      deductions: item.deductions,
      employer_costs: item.employer_costs,
      net_pay: Number(item.net_pay),
    }));

    const provider_response = await this.payroll_provider.sendPayroll({
      payroll_run_id: id,
      payroll_number: run.payroll_number,
      period_start: run.period_start,
      period_end: run.period_end,
      items,
    });

    const new_status: PayrollStatus = provider_response.success ? 'sent' : 'approved';

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: {
        status: new_status,
        send_status: provider_response.success ? 'sent_ok' : 'sent_error',
        provider_response: provider_response.raw_response as any,
        cune: provider_response.cune || null,
        xml_document: provider_response.xml_document || null,
        sent_at: provider_response.success ? new Date() : null,
      },
      include: PAYROLL_RUN_INCLUDE,
    });

    this.logger.log(
      `Payroll run #${id} sent to provider: ${provider_response.success ? 'OK' : 'FAILED'}`,
    );

    return updated;
  }

  /**
   * Mark payroll as paid.
   * Transitions: approved -> paid, accepted -> paid
   */
  async pay(id: number) {
    const run = await this.getPayrollRun(id);

    this.validateTransition(run.status, 'paid');

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: {
        status: 'paid',
        payment_date: new Date(),
      },
      include: PAYROLL_RUN_INCLUDE,
    });

    this.event_emitter.emit('payroll.paid', {
      payroll_run_id: id,
      organization_id: run.organization_id,
      store_id: run.store_id,
      total_net_pay: Number(run.total_net_pay || 0),
      payment_date: new Date(),
      user_id: this.getContext().user_id,
    });

    this.logger.log(`Payroll run #${id} marked as paid`);

    return updated;
  }

  /**
   * Cancel a payroll run.
   * Transitions: draft/calculated/approved -> cancelled
   */
  async cancel(id: number) {
    const run = await this.getPayrollRun(id);

    this.validateTransition(run.status, 'cancelled');

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: {
        status: 'cancelled',
      },
      include: PAYROLL_RUN_INCLUDE,
    });

    this.logger.log(`Payroll run #${id} cancelled`);

    return updated;
  }

  getValidTransitions(current_status: string): PayrollStatus[] {
    return VALID_TRANSITIONS[current_status as PayrollStatus] || [];
  }
}
