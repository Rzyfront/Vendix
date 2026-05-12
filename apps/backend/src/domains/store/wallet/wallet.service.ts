import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '../../../common/context/request-context.service';
import { WalletBalanceService } from './services/wallet-balance.service';
import { WalletQueryDto } from './dto/wallet-query.dto';
import { TopUpWalletDto } from './dto/top-up-wallet.dto';
import { AdjustWalletDto, AdjustmentType } from './dto/adjust-wallet.dto';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: StorePrismaService,
    private readonly walletBalance: WalletBalanceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get or create a wallet for a customer.
   * If the customer doesn't have a wallet yet, one is created with zero balance.
   */
  async getOrCreateWallet(customerId: number) {
    const existing = await this.prisma.wallets.findFirst({
      where: { customer_id: customerId },
    });

    if (existing) return existing;

    const context = RequestContextService.getContext();

    return this.prisma.wallets.create({
      data: {
        customer_id: customerId,
        organization_id: context?.organization_id!,
        balance: 0,
        held_balance: 0,
        is_active: true,
      },
    });
  }

  /**
   * Get the balance summary for a customer's wallet.
   */
  async getBalance(customerId: number) {
    const wallet = await this.getOrCreateWallet(customerId);
    const balance = Number(wallet.balance);
    const held_balance = Number(wallet.held_balance);

    return {
      wallet_id: wallet.id,
      balance,
      held_balance,
      available: balance - held_balance,
    };
  }

  /**
   * Get paginated transaction history for a customer's wallet.
   */
  async getHistory(customerId: number, query: WalletQueryDto) {
    const wallet = await this.getOrCreateWallet(customerId);
    const { page = 1, limit = 20, type, date_from, date_to } = query;
    const skip = (page - 1) * limit;

    const where: any = { wallet_id: wallet.id };

    if (type) {
      where.type = type;
    }

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to) where.created_at.lte = new Date(date_to);
    }

    const [data, total] = await Promise.all([
      this.prisma.wallet_transactions.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.wallet_transactions.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Top up a customer's wallet (add funds).
   */
  async topUp(customerId: number, dto: TopUpWalletDto, userId: number) {
    const wallet = await this.getOrCreateWallet(customerId);

    const result = await this.walletBalance.credit(wallet.id, dto.amount, {
      reference_type: 'topup',
      description:
        dto.description ||
        `Top-up via ${dto.payment_method || 'manual'}${dto.reference ? ` (ref: ${dto.reference})` : ''}`,
      created_by: userId,
    });

    this.eventEmitter.emit('wallet.credited', {
      wallet_id: wallet.id,
      store_id: wallet.store_id,
      organization_id: wallet.organization_id,
      amount: dto.amount,
      reference_type: 'topup',
      user_id: userId,
    });

    return result;
  }

  /**
   * Admin adjustment: credit or debit a customer's wallet.
   */
  async adjust(customerId: number, dto: AdjustWalletDto, userId: number) {
    const wallet = await this.getOrCreateWallet(customerId);

    const params = {
      reference_type: 'adjustment',
      description: `Admin adjustment: ${dto.reason}${dto.reference ? ` (ref: ${dto.reference})` : ''}`,
      created_by: userId,
    };

    const result =
      dto.type === AdjustmentType.CREDIT
        ? await this.walletBalance.credit(wallet.id, dto.amount, params)
        : await this.walletBalance.debit(wallet.id, dto.amount, params);

    this.eventEmitter.emit(
      dto.type === AdjustmentType.CREDIT ? 'wallet.credited' : 'wallet.debited',
      {
        wallet_id: wallet.id,
        store_id: wallet.store_id,
        organization_id: wallet.organization_id,
        amount: dto.amount,
        reference_type: 'adjustment',
        user_id: userId,
      },
    );

    return result;
  }

  /**
   * List all wallets with balances (admin view).
   */
  async findAll(query: WalletQueryDto) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.wallets.findMany({
        skip,
        take: limit,
        include: {
          customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.wallets.count(),
    ]);

    return {
      data: data.map((w) => ({
        ...w,
        balance: Number(w.balance),
        held_balance: Number(w.held_balance),
        available: Number(w.balance) - Number(w.held_balance),
      })),
      meta: {
        total,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
      },
    };
  }
}
