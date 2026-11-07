import { RequestContextService } from '@common/context/request-context.service';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import {
  ApprovalGateInput,
  operationIsGoverned,
} from '../workflows/gates/approval-gate';

/**
 * Flujos P1.3: the approval gate input of an expense (operation
 * `expense.approve`, amount = the expense amount). Null when the expense does
 * not exist in this store.
 */
export async function expenseApprovalGateInput(
  prisma: StorePrismaService,
  id: number,
): Promise<ApprovalGateInput | null> {
  if (!(await operationIsGoverned(prisma, 'expense.approve'))) return null;
  const expense = await prisma.expenses.findFirst({
    where: { id },
    select: {
      id: true,
      amount: true,
      description: true,
      expense_categories: { select: { name: true } },
    },
  });
  if (!expense) return null;
  const userId = RequestContextService.getUserId();
  const requester = userId
    ? await prisma.users.findFirst({
        where: { id: userId },
        select: { first_name: true, last_name: true },
      })
    : null;
  return {
    operation: 'expense.approve',
    entity_id: expense.id,
    amount: Number(expense.amount),
    context: {
      expense_id: expense.id,
      amount: expense.amount,
      category_name: expense.expense_categories?.name ?? null,
      description: expense.description,
      requested_by: requester
        ? `${requester.first_name ?? ''} ${requester.last_name ?? ''}`.trim()
        : null,
    },
  };
}
