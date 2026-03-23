import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../../common/context/request-context.service';
import { VendixHttpException, ErrorCodes } from '../../../../common/errors';
import { ManualMatchDto } from './dto/manual-match.dto';
import { ReconciliationService } from './reconciliation.service';

export interface AutoMatchResult {
  total_matched: number;
  exact_matches: number;
  amount_date_matches: number;
  approximate_matches: number;
  details: Array<{
    bank_transaction_id: number;
    accounting_entry_id: number;
    match_type: string;
    confidence_score: number;
  }>;
}

@Injectable()
export class ReconciliationMatchingService {
  private readonly logger = new Logger(ReconciliationMatchingService.name);

  constructor(
    private readonly prisma: StorePrismaService,
    private readonly reconciliation_service: ReconciliationService,
  ) {}

  private getContext() {
    const context = RequestContextService.getContext();
    if (!context) {
      throw new Error('No request context found');
    }
    return context;
  }

  async autoMatch(reconciliation_id: number): Promise<AutoMatchResult> {
    const context = this.getContext();

    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id: reconciliation_id },
      include: {
        bank_account: {
          select: { chart_account_id: true },
        },
      },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    if (reconciliation.status === ('completed' as any)) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_ALREADY_COMPLETED);
    }

    const chart_account_id = reconciliation.bank_account.chart_account_id;
    if (!chart_account_id) {
      return {
        total_matched: 0,
        exact_matches: 0,
        amount_date_matches: 0,
        approximate_matches: 0,
        details: [],
      };
    }

    // Get unmatched bank transactions in the period
    const already_matched_tx_ids = (
      await this.prisma.bank_reconciliation_matches.findMany({
        where: { reconciliation_id },
        select: { bank_transaction_id: true },
      })
    ).map((m) => m.bank_transaction_id);

    const bank_transactions = await this.prisma.bank_transactions.findMany({
      where: {
        bank_account_id: reconciliation.bank_account_id,
        transaction_date: {
          gte: reconciliation.period_start,
          lte: reconciliation.period_end,
        },
        is_reconciled: false,
        ...(already_matched_tx_ids.length > 0 && {
          id: { notIn: already_matched_tx_ids },
        }),
      },
    });

    // Get unmatched accounting entries that touch the bank's chart account
    const already_matched_entry_ids = (
      await this.prisma.bank_reconciliation_matches.findMany({
        where: { reconciliation_id, accounting_entry_id: { not: null } },
        select: { accounting_entry_id: true },
      })
    )
      .filter((m) => m.accounting_entry_id !== null)
      .map((m) => m.accounting_entry_id!);

    const accounting_entries = await this.prisma.accounting_entries.findMany({
      where: {
        status: 'posted' as any,
        entry_date: {
          gte: reconciliation.period_start,
          lte: reconciliation.period_end,
        },
        accounting_entry_lines: {
          some: { account_id: chart_account_id },
        },
        ...(already_matched_entry_ids.length > 0 && {
          id: { notIn: already_matched_entry_ids },
        }),
      },
      include: {
        accounting_entry_lines: {
          where: { account_id: chart_account_id },
        },
      },
    });

    const result: AutoMatchResult = {
      total_matched: 0,
      exact_matches: 0,
      amount_date_matches: 0,
      approximate_matches: 0,
      details: [],
    };

    const matched_tx_set = new Set<number>();
    const matched_entry_set = new Set<number>();

    // Pass 1: Exact match (amount + date + description similarity > 0.8)
    for (const tx of bank_transactions) {
      if (matched_tx_set.has(tx.id)) continue;

      for (const entry of accounting_entries) {
        if (matched_entry_set.has(entry.id)) continue;

        const entry_amount = this.getEntryAmountForAccount(
          entry.accounting_entry_lines,
          tx.type as string,
        );

        const amount_match = Math.abs(Number(tx.amount) - entry_amount) < 0.01;
        const date_match =
          this.toDateString(tx.transaction_date) ===
          this.toDateString(entry.entry_date);
        const text_sim = this.textSimilarity(
          tx.description,
          entry.description || '',
        );

        if (amount_match && date_match && text_sim > 0.8) {
          await this.createMatch(
            reconciliation_id,
            tx.id,
            entry.id,
            'automatic' as any,
            1.0,
            context.user_id,
          );
          matched_tx_set.add(tx.id);
          matched_entry_set.add(entry.id);
          result.exact_matches++;
          result.details.push({
            bank_transaction_id: tx.id,
            accounting_entry_id: entry.id,
            match_type: 'exact',
            confidence_score: 1.0,
          });
          break;
        }
      }
    }

    // Pass 2: Amount + date match (confidence 0.75)
    for (const tx of bank_transactions) {
      if (matched_tx_set.has(tx.id)) continue;

      for (const entry of accounting_entries) {
        if (matched_entry_set.has(entry.id)) continue;

        const entry_amount = this.getEntryAmountForAccount(
          entry.accounting_entry_lines,
          tx.type as string,
        );

        const amount_match = Math.abs(Number(tx.amount) - entry_amount) < 0.01;
        const date_match =
          this.toDateString(tx.transaction_date) ===
          this.toDateString(entry.entry_date);

        if (amount_match && date_match) {
          await this.createMatch(
            reconciliation_id,
            tx.id,
            entry.id,
            'automatic' as any,
            0.75,
            context.user_id,
          );
          matched_tx_set.add(tx.id);
          matched_entry_set.add(entry.id);
          result.amount_date_matches++;
          result.details.push({
            bank_transaction_id: tx.id,
            accounting_entry_id: entry.id,
            match_type: 'amount_date',
            confidence_score: 0.75,
          });
          break;
        }
      }
    }

    // Pass 3: Approximate match (amount match + date within 3 days + text similarity > 0.3)
    for (const tx of bank_transactions) {
      if (matched_tx_set.has(tx.id)) continue;

      let best_match: {
        entry_id: number;
        score: number;
      } | null = null;

      for (const entry of accounting_entries) {
        if (matched_entry_set.has(entry.id)) continue;

        const entry_amount = this.getEntryAmountForAccount(
          entry.accounting_entry_lines,
          tx.type as string,
        );

        const amount_match = Math.abs(Number(tx.amount) - entry_amount) < 0.01;
        const date_diff = Math.abs(
          tx.transaction_date.getTime() - entry.entry_date.getTime(),
        );
        const date_close = date_diff <= 3 * 24 * 60 * 60 * 1000; // 3 days
        const text_sim = this.textSimilarity(
          tx.description,
          entry.description || '',
        );

        if (amount_match && date_close && text_sim > 0.3) {
          const score = 0.5 + text_sim * 0.2;
          if (!best_match || score > best_match.score) {
            best_match = { entry_id: entry.id, score };
          }
        }
      }

      if (best_match) {
        await this.createMatch(
          reconciliation_id,
          tx.id,
          best_match.entry_id,
          'automatic' as any,
          0.5,
          context.user_id,
        );
        matched_tx_set.add(tx.id);
        matched_entry_set.add(best_match.entry_id);
        result.approximate_matches++;
        result.details.push({
          bank_transaction_id: tx.id,
          accounting_entry_id: best_match.entry_id,
          match_type: 'approximate',
          confidence_score: 0.5,
        });
      }
    }

    result.total_matched =
      result.exact_matches +
      result.amount_date_matches +
      result.approximate_matches;

    // Recalculate reconciliation balance
    await this.reconciliation_service.recalculateBalance(reconciliation_id);

    this.logger.log(
      `Auto-match for reconciliation ${reconciliation_id}: ${result.total_matched} matches found`,
    );

    return result;
  }

  async manualMatch(reconciliation_id: number, dto: ManualMatchDto) {
    const context = this.getContext();

    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id: reconciliation_id },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    if (reconciliation.status === ('completed' as any)) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_ALREADY_COMPLETED);
    }

    // Validate bank transaction exists
    const transaction = await this.prisma.bank_transactions.findFirst({
      where: { id: dto.bank_transaction_id },
    });

    if (!transaction) {
      throw new VendixHttpException(ErrorCodes.BANK_TRANSACTION_NOT_FOUND);
    }

    // Check if already matched in this reconciliation
    const existing_match = await this.prisma.bank_reconciliation_matches.findFirst({
      where: {
        reconciliation_id,
        bank_transaction_id: dto.bank_transaction_id,
      },
    });

    if (existing_match) {
      throw new VendixHttpException(ErrorCodes.BANK_TRANSACTION_ALREADY_RECONCILED);
    }

    const match = await this.createMatch(
      reconciliation_id,
      dto.bank_transaction_id,
      dto.accounting_entry_id || null,
      'manual' as any,
      1.0,
      context.user_id,
      dto.notes,
    );

    // Recalculate
    await this.reconciliation_service.recalculateBalance(reconciliation_id);

    return match;
  }

  async unmatch(reconciliation_id: number, match_id: number) {
    const reconciliation = await this.prisma.bank_reconciliations.findFirst({
      where: { id: reconciliation_id },
    });

    if (!reconciliation) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_NOT_FOUND);
    }

    if (reconciliation.status === ('completed' as any)) {
      throw new VendixHttpException(ErrorCodes.BANK_RECONCILIATION_ALREADY_COMPLETED);
    }

    const match = await this.prisma.bank_reconciliation_matches.findFirst({
      where: { id: match_id, reconciliation_id },
    });

    if (!match) {
      throw new VendixHttpException(ErrorCodes.BANK_TRANSACTION_NOT_FOUND);
    }

    await this.prisma.bank_reconciliation_matches.delete({
      where: { id: match_id },
    });

    // Recalculate
    await this.reconciliation_service.recalculateBalance(reconciliation_id);
  }

  // --- Private helpers ---

  private async createMatch(
    reconciliation_id: number,
    bank_transaction_id: number,
    accounting_entry_id: number | null,
    match_type: any,
    confidence_score: number,
    user_id?: number,
    notes?: string,
  ) {
    return this.prisma.bank_reconciliation_matches.create({
      data: {
        reconciliation_id,
        bank_transaction_id,
        accounting_entry_id: accounting_entry_id || null,
        match_type,
        confidence_score,
        matched_by_user_id: user_id || null,
        notes: notes || null,
      },
      include: {
        bank_transaction: true,
        accounting_entry: {
          select: {
            id: true,
            entry_number: true,
            description: true,
            entry_date: true,
          },
        },
      },
    });
  }

  private getEntryAmountForAccount(
    lines: Array<{ debit_amount: any; credit_amount: any }>,
    tx_type: string,
  ): number {
    // For a bank debit (money out), we look for credit lines on the bank account
    // For a bank credit (money in), we look for debit lines on the bank account
    let total = 0;
    for (const line of lines) {
      if (tx_type === 'credit') {
        total += Number(line.debit_amount || 0);
      } else {
        total += Number(line.credit_amount || 0);
      }
    }
    return total;
  }

  private toDateString(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private textSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;

    const a_lower = a.toLowerCase().trim();
    const b_lower = b.toLowerCase().trim();

    if (a_lower === b_lower) return 1;
    if (a_lower.length === 0 || b_lower.length === 0) return 0;

    const distance = this.levenshtein(a_lower, b_lower);
    const max_len = Math.max(a_lower.length, b_lower.length);

    return 1 - distance / max_len;
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length;
    const n = b.length;

    const dp: number[][] = Array.from({ length: m + 1 }, () =>
      Array(n + 1).fill(0),
    );

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1,
          dp[i][j - 1] + 1,
          dp[i - 1][j - 1] + cost,
        );
      }
    }

    return dp[m][n];
  }
}
