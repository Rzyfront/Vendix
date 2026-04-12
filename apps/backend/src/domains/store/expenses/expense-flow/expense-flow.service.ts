import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
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

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'approved',
        approved_by_user_id: context.user_id,
        approved_at: new Date(),
      },
      include: EXPENSE_INCLUDE,
    });

    this.logger.log(`Expense #${id} approved by user #${context.user_id}`);

    // Emit event for Accounting AutoEntryService to create automatic journal entries
    this.event_emitter.emit('expense.approved', {
      expense_id: updated.id,
      organization_id: context.organization_id,
      store_id: context.store_id,
      amount: updated.amount,
      category_id: updated.category_id,
    });

    return updated;
  }

  async reject(id: number) {
    const expense = await this.getExpense(id);
    const context = this.getContext();

    this.validateTransition(expense.state, 'rejected');

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'rejected',
        approved_by_user_id: context.user_id,
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

    const updated = await this.prisma.expenses.update({
      where: { id },
      data: {
        state: 'paid',
      },
      include: EXPENSE_INCLUDE,
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
