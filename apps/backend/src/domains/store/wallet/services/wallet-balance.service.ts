import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { Prisma } from '@prisma/client';
import { lockOrderLifecycle } from '../../orders/order-flow/order-lifecycle-lock.util';

type WalletDebitParams = {
  reference_type: string;
  reference_id?: number;
  description?: string;
  created_by?: number;
  expected_store_id?: number;
  expected_customer_id?: number;
};

@Injectable()
export class WalletBalanceService {
  constructor(private readonly prisma: StorePrismaService) {}

  private async lockWallet(tx: Prisma.TransactionClient, walletId: number): Promise<void> {
    // All balance writers take this lock before reading, so concurrent debits,
    // credits and holds cannot overwrite one another's snapshot.
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ${walletId} FOR UPDATE`;
  }

  /**
   * Credit: Adds funds to wallet. Used for topups, refunds, adjustments.
   * ATOMIC: Uses $transaction to ensure balance consistency.
   */
  async credit(
    walletId: number,
    amount: number,
    params: {
      reference_type: string;
      reference_id?: number;
      description?: string;
      created_by?: number;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWallet(tx, walletId);
      // 1. Lock and read current wallet
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');
      if (!wallet.is_active)
        throw new BadRequestException('Wallet is inactive');

      const balance_before = Number(wallet.balance);
      const balance_after = balance_before + amount;

      // 2. Update wallet balance
      await tx.wallets.update({
        where: { id: walletId },
        data: { balance: balance_after, updated_at: new Date() },
      });

      // 3. Create transaction record
      const transaction = await tx.wallet_transactions.create({
        data: {
          wallet_id: walletId,
          type: 'credit',
          state: 'completed',
          amount,
          balance_before,
          balance_after,
          reference_type: params.reference_type,
          reference_id: params.reference_id,
          description: params.description,
          created_by: params.created_by,
        },
      });

      return { transaction, balance_after };
    });
  }

  /**
   * Debit: Removes funds from wallet. Used for payments, adjustments.
   * Validates sufficient balance before debiting.
   */
  async debit(
    walletId: number,
    amount: number,
    params: WalletDebitParams,
  ) {
    return this.prisma.$transaction((tx) =>
      this.debitInTransaction(tx, walletId, amount, params),
    );
  }

  /** Same wallet lock + ledger writer, joined to the POS multi-tender tx. */
  async debitInTransaction(
    tx: Prisma.TransactionClient,
    walletId: number,
    amount: number,
    params: WalletDebitParams,
  ) {
      if (params.reference_type === 'payment' && params.reference_id != null) {
        const candidate = await tx.payments.findUnique({
          where: { id: params.reference_id }, select: { order_id: true },
        });
        if (!candidate || params.expected_store_id == null) {
          throw new BadRequestException('Reserved wallet payment not found');
        }
        await lockOrderLifecycle(tx, candidate.order_id, params.expected_store_id);
        const payment = await tx.payments.findFirst({
          where: { id: params.reference_id, order_id: candidate.order_id },
          include: { orders: true },
        });
        if (!payment || payment.state !== 'pending' ||
            payment.orders.store_id !== params.expected_store_id ||
            payment.orders.customer_id !== params.expected_customer_id ||
            !payment.amount.equals(amount)) {
          throw new BadRequestException('Reserved wallet payment changed before debit');
        }
      }
      await this.lockWallet(tx, walletId);
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');
      if (!wallet.is_active)
        throw new BadRequestException('Wallet is inactive');
      if (params.expected_store_id != null && wallet.store_id !== params.expected_store_id) {
        throw new BadRequestException('Wallet does not belong to this store');
      }
      if (params.expected_customer_id == null && params.reference_type === 'payment') {
        throw new BadRequestException('Wallet payments require an identified customer');
      }
      if (params.expected_customer_id != null && wallet.customer_id !== params.expected_customer_id) {
        throw new BadRequestException('Wallet does not belong to this customer');
      }
      if (params.reference_type === 'payment' && params.reference_id != null) {
        const existing = await tx.wallet_transactions.findFirst({
          where: { reference_type: 'payment', reference_id: params.reference_id,
            type: 'debit', state: 'completed' },
        });
        if (existing) {
          if (existing.wallet_id !== walletId || Number(existing.amount) !== amount) {
            throw new BadRequestException('Payment was already debited from another wallet or amount');
          }
          return { transaction: existing, balance_after: Number(existing.balance_after) };
        }
      }

      const balance_before = Number(wallet.balance);
      const available = balance_before - Number(wallet.held_balance);

      if (available < amount) {
        throw new BadRequestException(
          `Insufficient wallet balance. Available: ${available}, Required: ${amount}`,
        );
      }

      const balance_after = balance_before - amount;

      await tx.wallets.update({
        where: { id: walletId },
        data: { balance: balance_after, updated_at: new Date() },
      });

      const transaction = await tx.wallet_transactions.create({
        data: {
          wallet_id: walletId,
          type: 'debit',
          state: 'completed',
          amount,
          balance_before,
          balance_after,
          reference_type: params.reference_type,
          reference_id: params.reference_id,
          description: params.description,
          created_by: params.created_by,
        },
      });

      return { transaction, balance_after };
  }

  /**
   * Hold: Temporarily blocks funds (e.g., during checkout before payment confirms).
   */
  async hold(
    walletId: number,
    amount: number,
    params: {
      reference_type: string;
      reference_id?: number;
      description?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWallet(tx, walletId);
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');

      const available = Number(wallet.balance) - Number(wallet.held_balance);
      if (available < amount) {
        throw new BadRequestException(
          'Insufficient available balance for hold',
        );
      }

      const new_held = Number(wallet.held_balance) + amount;

      await tx.wallets.update({
        where: { id: walletId },
        data: { held_balance: new_held, updated_at: new Date() },
      });

      const transaction = await tx.wallet_transactions.create({
        data: {
          wallet_id: walletId,
          type: 'hold',
          state: 'completed',
          amount,
          balance_before: Number(wallet.balance),
          balance_after: Number(wallet.balance), // Balance doesn't change, only held
          reference_type: params.reference_type,
          reference_id: params.reference_id,
          description: params.description,
        },
      });

      return { transaction, held_balance: new_held };
    });
  }

  /**
   * Release: Releases previously held funds.
   */
  async release(
    walletId: number,
    amount: number,
    params: {
      reference_type: string;
      reference_id?: number;
      description?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockWallet(tx, walletId);
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');

      const current_held = Number(wallet.held_balance);
      if (current_held < amount) {
        throw new BadRequestException('Release amount exceeds held balance');
      }

      const new_held = current_held - amount;

      await tx.wallets.update({
        where: { id: walletId },
        data: { held_balance: new_held, updated_at: new Date() },
      });

      const transaction = await tx.wallet_transactions.create({
        data: {
          wallet_id: walletId,
          type: 'release',
          state: 'completed',
          amount,
          balance_before: Number(wallet.balance),
          balance_after: Number(wallet.balance),
          reference_type: params.reference_type,
          reference_id: params.reference_id,
          description: params.description,
        },
      });

      return { transaction, held_balance: new_held };
    });
  }
}
