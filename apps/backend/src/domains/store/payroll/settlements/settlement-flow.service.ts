import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { PayrollRulesService } from '../calculation/payroll-rules.service';
import { SettlementCalculationService } from './settlement-calculation.service';
import { SettlementsService } from './settlements.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { ApproveSettlementDto } from './dto/approve-settlement.dto';

type SettlementStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'cancelled';

const VALID_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  draft: ['calculated', 'cancelled'],
  calculated: ['approved', 'cancelled'],
  approved: ['paid', 'cancelled'],
  paid: [],
  cancelled: [],
};

const SETTLEMENT_DETAIL_INCLUDE = {
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
    },
  },
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  accounting_entry: true,
};

@Injectable()
export class SettlementFlowService {
  private readonly logger = new Logger(SettlementFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly calculation_service: SettlementCalculationService,
    private readonly settlements_service: SettlementsService,
    private readonly payroll_rules_service: PayrollRulesService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getSettlement(id: number) {
    const settlement = await this.prisma.payroll_settlements.findFirst({
      where: { id },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    if (!settlement) {
      throw new VendixHttpException(ErrorCodes.SETTLEMENT_FIND_001);
    }

    return settlement;
  }

  private validateTransition(current_status: string, target_status: SettlementStatus): void {
    const valid_targets = VALID_TRANSITIONS[current_status as SettlementStatus] || [];
    if (!valid_targets.includes(target_status)) {
      throw new VendixHttpException(
        ErrorCodes.SETTLEMENT_STATUS_001,
        `Invalid status transition: cannot change from '${current_status}' to '${target_status}'. ` +
          `Valid transitions from '${current_status}': [${valid_targets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  /**
   * Create and calculate a settlement for an employee.
   * The settlement is created in 'calculated' status directly.
   */
  async createAndCalculate(dto: CreateSettlementDto) {
    const context = this.getContext();

    // Validate employee exists and is active
    const employee = await this.prisma.employees.findFirst({
      where: { id: dto.employee_id },
    });

    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    if (employee.status === 'terminated') {
      throw new VendixHttpException(ErrorCodes.SETTLEMENT_VALIDATE_001);
    }

    if (employee.status !== 'active') {
      throw new VendixHttpException(ErrorCodes.SETTLEMENT_CALC_001);
    }

    // Check no active settlement exists for this employee
    const existing_settlement = await this.prisma.payroll_settlements.findFirst({
      where: {
        employee_id: dto.employee_id,
        status: { in: ['draft', 'calculated', 'approved'] },
      },
    });

    if (existing_settlement) {
      throw new VendixHttpException(ErrorCodes.SETTLEMENT_CALC_002);
    }

    // Get rules for the termination year
    const termination_date = new Date(dto.termination_date);
    const year = termination_date.getFullYear();
    const rules = await this.payroll_rules_service.getRulesForYear(year);

    // Calculate settlement
    const calculation = this.calculation_service.calculateSettlement({
      base_salary: Number(employee.base_salary),
      hire_date: employee.hire_date,
      termination_date,
      termination_reason: dto.termination_reason,
      contract_type: employee.contract_type,
      rules,
      pending_salary_days: dto.pending_salary_days || 0,
    });

    // Generate settlement number
    const settlement_number = await this.settlements_service.generateSettlementNumber();

    // Create the settlement record
    const settlement = await this.prisma.payroll_settlements.create({
      data: {
        organization_id: context.organization_id,
        store_id: employee.store_id || context.store_id || null,
        employee_id: dto.employee_id,
        settlement_number,
        status: 'calculated',
        termination_date,
        termination_reason: dto.termination_reason as any,
        hire_date: employee.hire_date,
        days_worked: calculation.days_worked,
        base_salary: new Prisma.Decimal(Number(employee.base_salary)),
        contract_type: employee.contract_type,
        severance: new Prisma.Decimal(calculation.severance),
        severance_interest: new Prisma.Decimal(calculation.severance_interest),
        bonus: new Prisma.Decimal(calculation.bonus),
        vacation: new Prisma.Decimal(calculation.vacation),
        pending_salary: new Prisma.Decimal(calculation.pending_salary),
        indemnification: new Prisma.Decimal(calculation.indemnification),
        health_deduction: new Prisma.Decimal(calculation.health_deduction),
        pension_deduction: new Prisma.Decimal(calculation.pension_deduction),
        other_deductions: new Prisma.Decimal(0),
        total_deductions: new Prisma.Decimal(calculation.total_deductions),
        gross_settlement: new Prisma.Decimal(calculation.gross_settlement),
        net_settlement: new Prisma.Decimal(calculation.net_settlement),
        calculation_detail: calculation.detail as any,
        notes: dto.notes || null,
        created_by_user_id: context.user_id,
      },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    this.event_emitter.emit('settlement.calculated', {
      settlement_id: settlement.id,
      employee_id: dto.employee_id,
      net_settlement: calculation.net_settlement,
    });

    this.logger.log(
      `Settlement #${settlement.id} (${settlement_number}) created for employee #${dto.employee_id}: ` +
        `net=${calculation.net_settlement}`,
    );

    return settlement;
  }

  /**
   * Approve a calculated settlement.
   * Transitions: calculated -> approved
   */
  async approve(id: number, dto?: ApproveSettlementDto) {
    const settlement = await this.getSettlement(id);
    const context = this.getContext();

    this.validateTransition(settlement.status, 'approved');

    const update_data: any = {
      status: 'approved',
      approved_by_user_id: context.user_id,
      approved_at: new Date(),
    };

    if (dto?.notes) {
      update_data.notes = dto.notes;
    }

    const updated = await this.prisma.payroll_settlements.update({
      where: { id },
      data: update_data,
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    this.event_emitter.emit('settlement.approved', {
      settlement_id: id,
      organization_id: settlement.organization_id,
      store_id: settlement.store_id,
      employee_id: settlement.employee_id,
      net_settlement: Number(settlement.net_settlement),
      approved_by: context.user_id,
    });

    this.logger.log(`Settlement #${id} approved by user #${context.user_id}`);

    return updated;
  }

  /**
   * Mark settlement as paid and terminate the employee.
   * Transitions: approved -> paid
   * This is done in a transaction to ensure both operations succeed.
   */
  async pay(id: number) {
    const settlement = await this.getSettlement(id);
    const context = this.getContext();

    this.validateTransition(settlement.status, 'paid');

    const updated = await this.prisma.$transaction(async (tx: any) => {
      // Update settlement status
      const updated_settlement = await tx.payroll_settlements.update({
        where: { id },
        data: {
          status: 'paid',
        },
        include: SETTLEMENT_DETAIL_INCLUDE,
      });

      // Terminate the employee
      await tx.employees.update({
        where: { id: settlement.employee_id },
        data: {
          status: 'terminated',
          termination_date: settlement.termination_date,
          termination_reason: settlement.termination_reason,
        },
      });

      return updated_settlement;
    });

    this.event_emitter.emit('settlement.paid', {
      settlement_id: id,
      settlement_number: settlement.settlement_number,
      organization_id: settlement.organization_id,
      store_id: settlement.store_id,
      employee_id: settlement.employee_id,
      employee_name: `${settlement.employee?.first_name || ''} ${settlement.employee?.last_name || ''}`.trim(),
      severance: Number(settlement.severance),
      severance_interest: Number(settlement.severance_interest),
      bonus: Number(settlement.bonus),
      vacation: Number(settlement.vacation),
      pending_salary: Number(settlement.pending_salary),
      indemnification: Number(settlement.indemnification),
      health_deduction: Number(settlement.health_deduction),
      pension_deduction: Number(settlement.pension_deduction),
      net_settlement: Number(settlement.net_settlement),
      gross_settlement: Number(settlement.gross_settlement),
      user_id: context.user_id,
    });

    this.logger.log(
      `Settlement #${id} paid. Employee #${settlement.employee_id} terminated.`,
    );

    return updated;
  }

  /**
   * Recalculate a settlement (only if draft or calculated).
   */
  async recalculate(id: number) {
    const settlement = await this.getSettlement(id);

    if (!['draft', 'calculated'].includes(settlement.status)) {
      throw new VendixHttpException(
        ErrorCodes.SETTLEMENT_STATUS_001,
        `Cannot recalculate settlement in '${settlement.status}' status. Only draft or calculated settlements can be recalculated.`,
      );
    }

    const employee = await this.prisma.employees.findFirst({
      where: { id: settlement.employee_id },
    });

    if (!employee) {
      throw new VendixHttpException(ErrorCodes.PAYROLL_FIND_001);
    }

    const year = settlement.termination_date.getFullYear();
    const rules = await this.payroll_rules_service.getRulesForYear(year);

    const pending_salary_days =
      (settlement.calculation_detail as any)?.pending_salary_days || 0;

    const calculation = this.calculation_service.calculateSettlement({
      base_salary: Number(employee.base_salary),
      hire_date: employee.hire_date,
      termination_date: settlement.termination_date,
      termination_reason: settlement.termination_reason,
      contract_type: employee.contract_type,
      rules,
      pending_salary_days,
    });

    const updated = await this.prisma.payroll_settlements.update({
      where: { id },
      data: {
        status: 'calculated',
        days_worked: calculation.days_worked,
        base_salary: new Prisma.Decimal(Number(employee.base_salary)),
        severance: new Prisma.Decimal(calculation.severance),
        severance_interest: new Prisma.Decimal(calculation.severance_interest),
        bonus: new Prisma.Decimal(calculation.bonus),
        vacation: new Prisma.Decimal(calculation.vacation),
        pending_salary: new Prisma.Decimal(calculation.pending_salary),
        indemnification: new Prisma.Decimal(calculation.indemnification),
        health_deduction: new Prisma.Decimal(calculation.health_deduction),
        pension_deduction: new Prisma.Decimal(calculation.pension_deduction),
        total_deductions: new Prisma.Decimal(calculation.total_deductions),
        gross_settlement: new Prisma.Decimal(calculation.gross_settlement),
        net_settlement: new Prisma.Decimal(calculation.net_settlement),
        calculation_detail: calculation.detail as any,
      },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    this.logger.log(`Settlement #${id} recalculated: net=${calculation.net_settlement}`);

    return updated;
  }

  /**
   * Cancel a settlement.
   * Transitions: draft|calculated|approved -> cancelled
   */
  async cancel(id: number) {
    const settlement = await this.getSettlement(id);

    this.validateTransition(settlement.status, 'cancelled');

    const updated = await this.prisma.payroll_settlements.update({
      where: { id },
      data: {
        status: 'cancelled',
      },
      include: SETTLEMENT_DETAIL_INCLUDE,
    });

    this.logger.log(`Settlement #${id} cancelled`);

    return updated;
  }

  /**
   * Get valid transitions for a given status.
   */
  getValidTransitions(current_status: string): SettlementStatus[] {
    return VALID_TRANSITIONS[current_status as SettlementStatus] || [];
  }
}
