import { Injectable } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';

@Injectable()
export class IntercompanyDetectionService {
  constructor(private readonly prisma: StorePrismaService) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  private async getSessionWithPeriod(session_id: number) {
    const session = await this.prisma.consolidation_sessions.findFirst({
      where: { id: session_id },
      include: { fiscal_period: true },
    });
    if (!session) {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_FOUND);
    }
    return session;
  }

  /**
   * Detect intercompany transactions within a consolidation session.
   * 1. Find accounts marked as intercompany
   * 2. Find posted entry lines using those accounts in the fiscal period
   * 3. Match counterparts: same amount, +-3 days, different stores, IC accounts
   * 4. Create intercompany_transactions records
   */
  async detectTransactions(session_id: number) {
    const context = this.getContext();
    const session = await this.getSessionWithPeriod(session_id);

    if (session.status !== 'in_progress') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_NOT_DRAFT);
    }

    // 1. Get intercompany accounts
    const ic_accounts = await this.prisma.chart_of_accounts.findMany({
      where: { is_intercompany: true },
    });

    if (ic_accounts.length === 0) {
      return { detected: 0, transactions: [] };
    }

    const ic_account_ids = ic_accounts.map((a: any) => a.id);

    // 2. Get posted entries in the fiscal period
    const entries = await this.prisma.accounting_entries.findMany({
      where: {
        fiscal_period_id: session.fiscal_period_id,
        status: 'posted',
        store_id: { not: null },
      },
      select: { id: true, store_id: true, entry_date: true },
    });

    if (entries.length === 0) {
      return { detected: 0, transactions: [] };
    }

    const entry_ids = entries.map((e: any) => e.id);
    const entry_map = new Map(entries.map((e: any) => [e.id, e]));

    // 3. Get entry lines with IC accounts
    const ic_lines = await this.prisma.accounting_entry_lines.findMany({
      where: {
        entry_id: { in: entry_ids },
        account_id: { in: ic_account_ids },
      },
      include: {
        entry: {
          select: { id: true, store_id: true, entry_date: true },
        },
      },
    });

    if (ic_lines.length === 0) {
      return { detected: 0, transactions: [] };
    }

    // 4. Clear existing detected transactions for this session (re-detect)
    await this.prisma.intercompany_transactions.deleteMany({
      where: { session_id },
    });

    // 5. Match counterparts
    const matched_pairs = new Set<string>();
    const transactions_to_create: any[] = [];

    for (const line of ic_lines) {
      const line_amount = Number(line.debit_amount) || Number(line.credit_amount);
      const line_store_id = (line.entry as any).store_id;
      const line_entry_date = new Date((line.entry as any).entry_date);

      if (!line_store_id || line_amount === 0) continue;

      // Find counterpart: different store, same amount, +-3 days, IC account
      const counterpart = ic_lines.find((other: any) => {
        if (other.id === line.id) return false;
        const other_store_id = other.entry.store_id;
        if (!other_store_id || other_store_id === line_store_id) return false;

        const other_amount = Number(other.debit_amount) || Number(other.credit_amount);
        if (Math.abs(other_amount - line_amount) > 0.01) return false;

        const other_date = new Date(other.entry.entry_date);
        const day_diff = Math.abs(line_entry_date.getTime() - other_date.getTime()) / (1000 * 60 * 60 * 24);
        if (day_diff > 3) return false;

        // Avoid duplicate pairs
        const pair_key = [
          Math.min(line.entry_id, other.entry_id),
          Math.max(line.entry_id, other.entry_id),
          line.account_id,
        ].join('-');
        if (matched_pairs.has(pair_key)) return false;

        return true;
      });

      if (counterpart) {
        const counterpart_store_id = (counterpart as any).entry.store_id;
        const pair_key = [
          Math.min(line.entry_id, (counterpart as any).entry_id),
          Math.max(line.entry_id, (counterpart as any).entry_id),
          line.account_id,
        ].join('-');
        matched_pairs.add(pair_key);

        transactions_to_create.push({
          organization_id: context.organization_id,
          session_id,
          from_store_id: line_store_id,
          to_store_id: counterpart_store_id,
          entry_id: line.entry_id,
          counterpart_entry_id: (counterpart as any).entry_id,
          account_id: line.account_id,
          amount: line_amount,
          eliminated: false,
        });
      }
    }

    // 6. Bulk create
    if (transactions_to_create.length > 0) {
      await this.prisma.intercompany_transactions.createMany({
        data: transactions_to_create,
      });
    }

    // 7. Return created transactions
    const created = await this.prisma.intercompany_transactions.findMany({
      where: { session_id },
      include: {
        from_store: { select: { id: true, name: true } },
        to_store: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });

    return { detected: created.length, transactions: created };
  }

  /**
   * Eliminate a single intercompany transaction and create elimination adjustment
   */
  async eliminateTransaction(txn_id: number) {
    const txn = await this.prisma.intercompany_transactions.findFirst({
      where: { id: txn_id },
      include: { session: true },
    });

    if (!txn) {
      throw new VendixHttpException(ErrorCodes.INTERCOMPANY_TRANSACTION_NOT_FOUND);
    }

    if (txn.session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    const context = this.getContext();
    const amount = Number(txn.amount);

    // Mark as eliminated
    await this.prisma.intercompany_transactions.update({
      where: { id: txn_id },
      data: {
        eliminated: true,
        eliminated_at: new Date(),
      },
    });

    // Create elimination adjustment (debit and credit cancel out)
    await this.prisma.consolidation_adjustments.create({
      data: {
        session_id: txn.session_id,
        account_id: txn.account_id,
        type: 'elimination',
        debit_amount: amount,
        credit_amount: amount,
        description: `IC elimination: Store ${txn.from_store_id} ↔ Store ${txn.to_store_id}`,
        created_by_user_id: context.user_id || null,
      },
    });

    return { eliminated: true, transaction_id: txn_id };
  }

  /**
   * Eliminate all detected intercompany transactions for a session
   */
  async eliminateAll(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);

    if (session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    const uneliminated = await this.prisma.intercompany_transactions.findMany({
      where: { session_id, eliminated: false },
    });

    for (const txn of uneliminated) {
      await this.eliminateTransaction(txn.id);
    }

    return { eliminated_count: uneliminated.length };
  }

  /**
   * Get unmatched (not eliminated) intercompany transactions
   */
  async getUnmatchedTransactions(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);

    return this.prisma.intercompany_transactions.findMany({
      where: { session_id, eliminated: false },
      include: {
        from_store: { select: { id: true, name: true } },
        to_store: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Get all detected intercompany transactions for a session
   */
  async getDetectedTransactions(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);

    return this.prisma.intercompany_transactions.findMany({
      where: { session_id },
      include: {
        from_store: { select: { id: true, name: true } },
        to_store: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  /**
   * Auto-eliminate intercompany transactions:
   * 1. Re-detect uneliminated transactions
   * 2. Match by amount + reference + opposite stores
   * 3. Mark eliminated = true
   * 4. Create consolidation_adjustments type 'elimination'
   * Idempotent: only processes non-eliminated transactions
   */
  async autoEliminateIntercompany(session_id: number) {
    const session = await this.getSessionWithPeriod(session_id);

    if (session.status === 'completed') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    if (session.status === 'cancelled') {
      throw new VendixHttpException(ErrorCodes.CONSOLIDATION_SESSION_ALREADY_COMPLETED);
    }

    // 1. Get all uneliminated transactions for this session
    const uneliminated = await this.prisma.intercompany_transactions.findMany({
      where: { session_id, eliminated: false },
      include: {
        from_store: { select: { id: true, name: true } },
        to_store: { select: { id: true, name: true } },
        account: { select: { id: true, code: true, name: true } },
      },
    });

    if (uneliminated.length === 0) {
      return { eliminated_count: 0, already_eliminated: true };
    }

    // 2. Match pairs by amount + account + opposite stores
    const matched_ids = new Set<number>();
    const pairs: Array<{ txn: any; counterpart: any }> = [];

    for (const txn of uneliminated) {
      if (matched_ids.has(txn.id)) continue;

      const amount = Number(txn.amount);

      // Find counterpart: same amount, same account, stores are reversed
      const counterpart = uneliminated.find((other: any) => {
        if (other.id === txn.id) return false;
        if (matched_ids.has(other.id)) return false;

        const other_amount = Number(other.amount);
        if (Math.abs(other_amount - amount) > 0.01) return false;
        if (other.account_id !== txn.account_id) return false;

        // Opposite stores: txn.from = other.to AND txn.to = other.from
        const is_opposite =
          txn.from_store_id === other.to_store_id &&
          txn.to_store_id === other.from_store_id;

        return is_opposite;
      });

      if (counterpart) {
        matched_ids.add(txn.id);
        matched_ids.add(counterpart.id);
        pairs.push({ txn, counterpart });
      }
    }

    // 3. Eliminate all matched pairs and remaining unmatched
    const context = this.getContext();
    let eliminated_count = 0;

    // Eliminate matched pairs
    for (const { txn, counterpart } of pairs) {
      await this.prisma.intercompany_transactions.updateMany({
        where: { id: { in: [txn.id, counterpart.id] } },
        data: { eliminated: true, eliminated_at: new Date() },
      });

      const amount = Number(txn.amount);

      await this.prisma.consolidation_adjustments.create({
        data: {
          session_id,
          account_id: txn.account_id,
          type: 'elimination',
          debit_amount: amount,
          credit_amount: amount,
          description: `Auto IC elimination: ${txn.from_store?.name || txn.from_store_id} ↔ ${txn.to_store?.name || txn.to_store_id}`,
          created_by_user_id: context.user_id || null,
        },
      });

      eliminated_count += 2;
    }

    // Eliminate remaining unmatched (single-sided IC transactions)
    const remaining_uneliminated = uneliminated.filter(
      (t: any) => !matched_ids.has(t.id),
    );

    for (const txn of remaining_uneliminated) {
      await this.prisma.intercompany_transactions.update({
        where: { id: txn.id },
        data: { eliminated: true, eliminated_at: new Date() },
      });

      const amount = Number(txn.amount);

      await this.prisma.consolidation_adjustments.create({
        data: {
          session_id,
          account_id: txn.account_id,
          type: 'elimination',
          debit_amount: amount,
          credit_amount: amount,
          description: `Auto IC elimination: Store ${txn.from_store?.name || txn.from_store_id} → Store ${txn.to_store?.name || txn.to_store_id}`,
          created_by_user_id: context.user_id || null,
        },
      });

      eliminated_count += 1;
    }

    return {
      eliminated_count,
      matched_pairs: pairs.length,
      unmatched_eliminated: remaining_uneliminated.length,
    };
  }
}
