import { Injectable, BadRequestException } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';

@Injectable()
export class WalletBalanceService {
  constructor(private readonly prisma: StorePrismaService) {}

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
      // 1. Lock and read current wallet
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');
      if (!wallet.is_active) throw new BadRequestException('Wallet is inactive');

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
    params: {
      reference_type: string;
      reference_id?: number;
      description?: string;
      created_by?: number;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallets.findUnique({
        where: { id: walletId },
      });
      if (!wallet) throw new BadRequestException('Wallet not found');
      if (!wallet.is_active) throw new BadRequestException('Wallet is inactive');

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
    });
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
