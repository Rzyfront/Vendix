import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

export interface DigitalPaymentMatch {
  payment_id: number;
  bank_transaction_id: number;
  confidence: number;
  match_type: 'transaction_id' | 'amount_date' | 'reference';
  payment_amount: number;
  transaction_amount: number;
  payment_method: string;
}

@Injectable()
export class DigitalPaymentMatcherService {
  private readonly logger = new Logger(DigitalPaymentMatcherService.name);

  constructor(private readonly prisma: StorePrismaService) {}

  /**
   * Match digital payments (Wompi, Nequi, PSE) with bank transactions.
   *
   * Strategy:
   * 1. Pass 1 (High confidence 0.95): Match by gateway transaction_id in payment's gateway_response
   * 2. Pass 2 (Medium confidence 0.80): Match by exact amount + date within ±2 days
   * 3. Pass 3 (Low confidence 0.60): Match by approximate amount (±1%) + date within ±3 days
   */
  async findMatches(params: {
    reconciliation_id: number;
    date_from?: Date;
    date_to?: Date;
  }): Promise<DigitalPaymentMatch[]> {
    const matches: DigitalPaymentMatch[] = [];
    const matched_payment_ids = new Set<number>();
    const matched_transaction_ids = new Set<number>();

    // Get unmatched digital payments (succeeded, from Wompi-type processors)
    const digital_methods = ['wompi', 'nequi', 'pse'];
    const payments = await this.prisma.payments.findMany({
      where: {
        state: 'succeeded',
        payment_methods: { type: { in: digital_methods } },
        paid_at: {
          ...(params.date_from && { gte: params.date_from }),
          ...(params.date_to && { lte: params.date_to }),
        },
      },
      include: {
        payment_methods: { select: { type: true } },
      },
    });

    if (payments.length === 0) {
      this.logger.debug('No digital payments found for matching');
      return matches;
    }

    // Get unmatched bank transactions for the reconciliation
    const bank_transactions = await this.prisma.bank_transactions.findMany({
      where: {
        reconciliation_id: null, // Not yet reconciled
        transaction_type: 'deposit',
        transaction_date: {
          ...(params.date_from && { gte: params.date_from }),
          ...(params.date_to && { lte: params.date_to }),
        },
      },
    });

    if (bank_transactions.length === 0) {
      this.logger.debug('No unmatched bank transactions found');
      return matches;
    }

    // Pass 1: Match by transaction_id in gateway_response
    for (const payment of payments) {
      if (matched_payment_ids.has(payment.id)) continue;

      const gateway_response = payment.gateway_response;
      const gateway_txn_id =
        gateway_response?.id || gateway_response?.transaction_id;

      if (gateway_txn_id) {
        const matching_txn = bank_transactions.find(
          (txn) =>
            !matched_transaction_ids.has(txn.id) &&
            (txn.reference?.includes(gateway_txn_id) ||
              txn.description?.includes(gateway_txn_id)),
        );

        if (matching_txn) {
          matches.push({
            payment_id: payment.id,
            bank_transaction_id: matching_txn.id,
            confidence: 0.95,
            match_type: 'transaction_id',
            payment_amount: Number(payment.amount),
            transaction_amount: Number(matching_txn.amount),
            payment_method: payment.payment_methods?.type || 'unknown',
          });
          matched_payment_ids.add(payment.id);
          matched_transaction_ids.add(matching_txn.id);
        }
      }
    }

    // Pass 2: Exact amount + date within ±2 days
    const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
    for (const payment of payments) {
      if (matched_payment_ids.has(payment.id)) continue;

      const payment_amount = Number(payment.amount);
      const payment_date = payment.paid_at
        ? new Date(payment.paid_at).getTime()
        : 0;

      const matching_txn = bank_transactions.find((txn) => {
        if (matched_transaction_ids.has(txn.id)) return false;
        const txn_amount = Number(txn.amount);
        const txn_date = new Date(txn.transaction_date).getTime();
        return (
          Math.abs(payment_amount - txn_amount) < 0.01 &&
          Math.abs(payment_date - txn_date) <= TWO_DAYS_MS
        );
      });

      if (matching_txn) {
        matches.push({
          payment_id: payment.id,
          bank_transaction_id: matching_txn.id,
          confidence: 0.8,
          match_type: 'amount_date',
          payment_amount,
          transaction_amount: Number(matching_txn.amount),
          payment_method: payment.payment_methods?.type || 'unknown',
        });
        matched_payment_ids.add(payment.id);
        matched_transaction_ids.add(matching_txn.id);
      }
    }

    // Pass 3: Approximate amount (±1%) + date within ±3 days
    const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;
    for (const payment of payments) {
      if (matched_payment_ids.has(payment.id)) continue;

      const payment_amount = Number(payment.amount);
      const payment_date = payment.paid_at
        ? new Date(payment.paid_at).getTime()
        : 0;

      const matching_txn = bank_transactions.find((txn) => {
        if (matched_transaction_ids.has(txn.id)) return false;
        const txn_amount = Number(txn.amount);
        const txn_date = new Date(txn.transaction_date).getTime();
        const amount_diff_pct =
          Math.abs(payment_amount - txn_amount) / payment_amount;
        return (
          amount_diff_pct <= 0.01 &&
          Math.abs(payment_date - txn_date) <= THREE_DAYS_MS
        );
      });

      if (matching_txn) {
        matches.push({
          payment_id: payment.id,
          bank_transaction_id: matching_txn.id,
          confidence: 0.6,
          match_type: 'reference',
          payment_amount,
          transaction_amount: Number(matching_txn.amount),
          payment_method: payment.payment_methods?.type || 'unknown',
        });
        matched_payment_ids.add(payment.id);
        matched_transaction_ids.add(matching_txn.id);
      }
    }

    this.logger.log(
      `Digital payment matching complete: ${matches.length} matches found`,
    );
    return matches;
  }

  /**
   * Get summary of unmatched digital payments for a date range.
   */
  async getUnmatchedSummary(params: {
    date_from?: Date;
    date_to?: Date;
  }): Promise<{
    total_unmatched: number;
    total_amount: number;
    by_method: Record<string, { count: number; amount: number }>;
  }> {
    const digital_methods = ['wompi', 'nequi', 'pse'];

    const payments = await this.prisma.payments.findMany({
      where: {
        state: 'succeeded',
        payment_methods: { type: { in: digital_methods } },
        paid_at: {
          ...(params.date_from && { gte: params.date_from }),
          ...(params.date_to && { lte: params.date_to }),
        },
      },
      include: {
        payment_methods: { select: { type: true } },
      },
    });

    const by_method: Record<string, { count: number; amount: number }> = {};
    let total_amount = 0;

    for (const payment of payments) {
      const method = payment.payment_methods?.type || 'unknown';
      if (!by_method[method]) by_method[method] = { count: 0, amount: 0 };
      by_method[method].count++;
      by_method[method].amount += Number(payment.amount);
      total_amount += Number(payment.amount);
    }

    return { total_unmatched: payments.length, total_amount, by_method };
  }
}
