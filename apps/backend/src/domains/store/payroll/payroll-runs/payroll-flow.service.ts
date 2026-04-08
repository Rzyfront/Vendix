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
import { DianPayrollProvider } from '../providers/dian-payroll/dian-payroll.provider';

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
    private readonly dian_payroll_provider: DianPayrollProvider,
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
      include: PAYROLL_RUN_DETAIL_INCLUDE,
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
      store_id: run.store_id ?? undefined,
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
      include: PAYROLL_RUN_DETAIL_INCLUDE,
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
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    this.event_emitter.emit('payroll.paid', {
      payroll_run_id: id,
      organization_id: run.organization_id,
      store_id: run.store_id ?? undefined,
      user_id: this.getContext().user_id,
      payroll_items: ((run as any).payroll_items ?? []).map((item: any) => ({
        payroll_item_id: item.id,
        employee_id: item.employee_id,
        cost_center: item.employee?.cost_center ?? 'administrative',
        earnings: item.earnings,
        deductions: item.deductions,
        employer_costs: item.employer_costs,
        provisions: item.provisions,
        net_pay: Number(item.net_pay ?? 0),
      })),
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
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    this.logger.log(`Payroll run #${id} cancelled`);

    return updated;
  }

  getValidTransitions(current_status: string): PayrollStatus[] {
    return VALID_TRANSITIONS[current_status as PayrollStatus] || [];
  }

  /**
   * Send payroll to DIAN using the DianPayrollProvider directly.
   * Only allowed when payroll run is in 'approved' or 'paid' status.
   * Processes each item individually — failures do not abort the batch.
   */
  async sendToDian(id: number) {
    const run = await this.getPayrollRun(id);

    // Only allow sending to DIAN from approved or paid status
    if (!['approved', 'paid'].includes(run.status)) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Cannot send to DIAN from '${run.status}' status. Payroll run must be 'approved' or 'paid'.`,
      );
    }

    const payroll_items = (run as any).payroll_items || [];

    if (payroll_items.length === 0) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        'No payroll items found for this run. Calculate payroll first.',
      );
    }

    // Map payroll items to provider format
    const items = payroll_items.map((item: any) => ({
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

    // Send to DIAN via the real provider (handles per-item errors internally)
    const provider_response = await this.dian_payroll_provider.sendPayroll({
      payroll_run_id: id,
      payroll_number: run.payroll_number,
      period_start: run.period_start,
      period_end: run.period_end,
      items,
    });

    // Extract per-item results from raw_response
    const item_results = (provider_response.raw_response?.results || []) as Array<{
      employee_document: string;
      success: boolean;
      cune?: string;
      message?: string;
    }>;

    const sent_count = item_results.filter((r) => r.success).length;
    const failed_count = item_results.filter((r) => !r.success).length;

    // If the run was approved and all items were sent successfully, transition to 'sent'
    const new_status: PayrollStatus =
      run.status === 'approved' && provider_response.success ? 'sent' : (run.status as PayrollStatus);

    const updated = await this.prisma.payroll_runs.update({
      where: { id },
      data: {
        status: new_status,
        send_status: provider_response.success ? 'sent_ok' : 'sent_partial',
        provider_response: provider_response.raw_response as any,
        cune: provider_response.cune || null,
        xml_document: provider_response.xml_document || null,
        sent_at: sent_count > 0 ? new Date() : null,
      },
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    this.logger.log(
      `Payroll run #${id} sent to DIAN: ${sent_count} sent, ${failed_count} failed`,
    );

    return {
      payroll_run: updated,
      dian_summary: {
        total_items: item_results.length,
        sent: sent_count,
        failed: failed_count,
        all_success: provider_response.success,
        message: provider_response.message,
        item_results,
      },
    };
  }

  /**
   * Send a DSPNE Nota de Ajuste (tipo 103) for a specific payroll item.
   * References the CUNE of the original document that was accepted by DIAN.
   */
  async sendAdjustment(
    payroll_run_id: number,
    payroll_item_id: number,
    predecessor: {
      cune: string;
      document_number: string;
      generation_date: string;
      adjustment_type: '1' | '2';
    },
  ) {
    const run = await this.getPayrollRun(payroll_run_id);

    // Adjustment notes can only be sent for runs already sent/accepted/paid
    if (!['sent', 'accepted', 'paid'].includes(run.status)) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        `Cannot send adjustment note from '${run.status}' status. Payroll run must be 'sent', 'accepted', or 'paid'.`,
      );
    }

    const payroll_items = (run as any).payroll_items || [];
    const item = payroll_items.find((i: any) => i.id === payroll_item_id);

    if (!item) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_FIND_002,
        `Payroll item #${payroll_item_id} not found in run #${payroll_run_id}`,
      );
    }

    const mapped_item = {
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
    };

    const result = await this.dian_payroll_provider.sendAdjustment(
      mapped_item,
      {
        payroll_run_id,
        payroll_number: run.payroll_number,
        period_start: run.period_start,
        period_end: run.period_end,
      },
      predecessor,
    );

    this.logger.log(
      `Payroll adjustment for item #${payroll_item_id} in run #${payroll_run_id}: ${result.success ? 'OK' : 'FAILED'}`,
    );

    return {
      payroll_run_id,
      payroll_item_id,
      adjustment_result: result,
    };
  }

  /**
   * Check the DIAN status for a previously sent payroll run.
   * Uses the CUNE stored on the payroll run as the tracking ID.
   */
  async getDianStatus(id: number) {
    const run = await this.prisma.payroll_runs.findFirst({
      where: { id },
      include: PAYROLL_RUN_DETAIL_INCLUDE,
    });

    if (!run) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_002);
    }

    if (!run.cune) {
      throw new VendixHttpException(
        ErrorCodes.PAYROLL_STATUS_001,
        'This payroll run has not been sent to DIAN yet (no CUNE found).',
      );
    }

    const status_response = await this.dian_payroll_provider.checkStatus(run.cune);

    // If status changed to accepted, update the payroll run
    if (status_response.status === 'accepted' && run.status === 'sent') {
      await this.prisma.payroll_runs.update({
        where: { id },
        data: { status: 'accepted' },
      });
    }

    // If status changed to rejected, update the payroll run
    if (status_response.status === 'rejected' && run.status === 'sent') {
      await this.prisma.payroll_runs.update({
        where: { id },
        data: { status: 'rejected' },
      });
    }

    return {
      payroll_run_id: id,
      payroll_number: run.payroll_number,
      current_status: run.status,
      dian_status: status_response,
    };
  }
}
