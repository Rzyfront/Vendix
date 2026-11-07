import { Prisma } from '@prisma/client';
import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { recordTriggerEvent } from '../../workflows/engine/workflow-trigger.outbox';
import {
  consumeApproval,
  enforceApproval,
} from '../../workflows/gates/approval-gate';
import { expenseApprovalGateInput } from '../expense-approval-gate';
import { RequestContextService } from '../../../../common/context/request-context.service';

type ExpenseState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'paid'
  | 'cancelled'
  | 'refunded';

const VALID_TRANSITIONS: Record<ExpenseState, ExpenseState[]> = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['paid', 'cancelled'],
  rejected: [],
  paid: ['refunded'],
  cancelled: [],
  refunded: [],
};

const EXPENSE_INCLUDE = {
  expense_categories: true,
  created_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  approved_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
  refunded_by_user: {
    select: { id: true, first_name: true, last_name: true },
  },
};

@Injectable()
export class ExpenseFlowService {
  private readonly logger = new Logger(ExpenseFlowService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly event_emitter: EventEmitter2,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getExpense(id: number) {
    const expense = await this.prisma.expenses.findFirst({
      where: { id },
      include: EXPENSE_INCLUDE,
    });

    if (!expense) {
      throw new NotFoundException(`Expense #${id} not found`);
    }

    return expense;
  }

  private validateTransition(
    currentState: string,
    targetState: ExpenseState,
  ): void {
    const validTargets = VALID_TRANSITIONS[currentState as ExpenseState] || [];
    if (!validTargets.includes(targetState)) {
      throw new ConflictException(
        `Invalid state transition: cannot change from '${currentState}' to '${targetState}'. ` +
          `Valid transitions from '${currentState}': [${validTargets.join(', ') || 'none (terminal state)'}]`,
      );
    }
  }

  async approve(id: number) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'approved');

    // Flujos P1.3: a governed expense waits for its request (409 while
    // pending, from any route). An approval is used once, with the write.
    const gateInput = await expenseApprovalGateInput(this.prisma, id);
    const gate = gateInput
      ? await enforceApproval(this.prisma, gateInput)
      : ({ status: 'free' } as const);

    const approve = async (tx: Prisma.TransactionClient) => {
      await consumeApproval(tx, gate);
      const approved = await tx.expenses.update({
        where: { id },
        data: {
          state: 'approved',
          approved_by_user_id: context.user_id,
          approved_at: new Date(),
        },
        include: EXPENSE_INCLUDE,
      });
      await recordTriggerEvent(tx, 'expense.approved', {
        store_id: context.store_id,
        expense_id: approved.id,
        amount: approved.amount,
        category_id: approved.category_id,
      });
      return approved;
    };
    const updated: Awaited<ReturnType<typeof approve>> =
      await this.prisma.$transaction(approve);

    this.logger.log(`Expense #${id} approved by user #${context.user_id}`);

    // Emit event for Accounting AutoEntryService to create automatic journal entries
    this.event_emitter.emit('expense.approved', {
      expense_id: updated.id,
      organization_id: context.organization_id,
      store_id: context.store_id,
      amount: updated.amount,
      category_id: updated.category_id,
    });
    // Bug 5 — evento cross-domain adicional para invalidación de cache del
    // dashboard. NO reemplaza a expense.approved; ambos coexisten (listener
    // contable y listener de analytics escuchan eventos distintos).
    this.event_emitter.emit('expense.state_changed', {
      expense_id: updated.id,
      store_id: context.store_id,
      organization_id: context.organization_id,
      new_state: updated.state,
    });

    return updated;
  }

  async reject(id: number, reason?: string) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'rejected');

    // Flujos P1.3: a rejected approval request keeps its reason in the notes.
    const note = reason?.trim()
      ? `Rechazado: ${reason.trim().slice(0, 500)}`
      : null;
    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'rejected',
        approved_by_user_id: context.user_id,
        ...(note && {
          notes: expense.notes ? `${expense.notes}\n${note}` : note,
        }),
      },
      include: EXPENSE_INCLUDE,
    });

    this.logger.log(`Expense #${id} rejected by user #${context.user_id}`);
    return updated;
  }

  async pay(id: number) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'paid');

    // `paid_at` es el instante real en que el dinero salió de la caja. El
    // dashboard en base caja resta el gasto por ESTE instante, no por
    // `expense_date` (fecha del documento) ni por `approved_at` (autorización).
    // Es columna de instante: se guarda en UTC y el bucketing por día lo hace
    // la capa de analítica con el timezone de la tienda.
    const updated = await this.prisma.$transaction(async (tx) => {
      const paid = await tx.expenses.update({
        where: { id },
        data: {
          state: 'paid',
          paid_at: new Date(),
        },
        include: EXPENSE_INCLUDE,
      });
      // Flujos P1.1: expense.paid in the same transaction
      await recordTriggerEvent(tx, 'expense.paid', {
        store_id: context.store_id,
        expense_id: paid.id,
        amount: paid.amount,
        category_id: paid.category_id,
      });
      return paid;
    });

    this.logger.log(
      `Expense #${id} marked as paid by user #${context.user_id}`,
    );

    // Emit event for Accounting AutoEntryService to create automatic journal entries
    this.event_emitter.emit('expense.paid', {
      expense_id: updated.id,
      organization_id: context.organization_id,
      store_id: context.store_id,
      amount: updated.amount,
    });
    // Bug 5 — invalidación de cache del dashboard.
    this.event_emitter.emit('expense.state_changed', {
      expense_id: updated.id,
      store_id: context.store_id,
      organization_id: context.organization_id,
      new_state: updated.state,
    });

    return updated;
  }

  async cancel(id: number) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'cancelled');

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'cancelled',
      },
      include: EXPENSE_INCLUDE,
    });

    this.logger.log(`Expense #${id} cancelled by user #${context.user_id}`);

    if (expense.state === 'approved') {
      this.event_emitter.emit('expense.cancelled', {
        expense_id: updated.id,
        organization_id: context.organization_id,
        store_id: context.store_id,
        amount: updated.amount,
      });
    }
    // Bug 5 — invalidación de cache del dashboard (cubre refund también).
    this.event_emitter.emit('expense.state_changed', {
      expense_id: updated.id,
      store_id: context.store_id,
      organization_id: context.organization_id,
      new_state: updated.state,
    });

    return updated;
  }

  async refund(id: number, reason: string) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'refunded');

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'refunded',
        refunded_at: new Date(),
        refunded_by_user_id: context.user_id,
        refund_reason: reason,
      },
      include: EXPENSE_INCLUDE,
    });

    this.logger.log(
      `Expense #${id} refunded by user #${context.user_id}. Reason: ${reason}`,
    );

    this.event_emitter.emit('expense.refunded', {
      expense_id: updated.id,
      organization_id: context.organization_id,
      store_id: context.store_id,
      amount: updated.amount,
    });

    return updated;
  }

  getValidTransitions(currentState: string): ExpenseState[] {
    return VALID_TRANSITIONS[currentState as ExpenseState] || [];
  }
}
