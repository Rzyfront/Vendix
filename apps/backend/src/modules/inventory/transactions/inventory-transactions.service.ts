import { Prisma } from '@prisma/client';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CreateTransactionDto,
  TransactionQueryDto,
  InventoryTransaction,
  TransactionHistoryResponse,
} from './interfaces/inventory-transaction.interface';
import { inventory_transaction_type_enum } from '@prisma/client';

@Injectable()
export class InventoryTransactionsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Crea una transacción de inventario
   */
  async createTransaction(
    data: CreateTransactionDto,
    tx?: Prisma.TransactionClient,
  ): Promise<InventoryTransaction> {
    const prisma = tx || this.prisma;
    try {
      return await prisma.inventory_transactions.create({
        data: {
          product_id: data.productId,
          product_variant_id: data.variantId,
          type: data.type,
          quantity_change: data.quantityChange,
          notes: data.reason,
          transaction_date: data.transactionDate || new Date(),
          user_id: data.userId,
          order_item_id: data.orderItemId,
        },
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          users: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
      });
    } catch (error) {
      throw new BadRequestException(
        `Failed to create inventory transaction: ${error.message}`,
      );
    }
  }

  /**
   * Obtiene el historial de transacciones de un producto
   */
  async getTransactionHistory(
    productId: number,
    query: TransactionQueryDto,
  ): Promise<TransactionHistoryResponse> {
    const where = {
      product_id: productId,
      ...(query.variantId && { product_variant_id: query.variantId }),
      ...(query.type && { type: query.type }),
      ...(query.userId && { user_id: query.userId }),
      ...(query.startDate && {
        transaction_date: {
          gte: query.startDate,
        },
      }),
      ...(query.endDate && {
        transaction_date: {
          lte: query.endDate,
        },
      }),
    };

    const [transactions, total] = await Promise.all([
      this.prisma.inventory_transactions.findMany({
        where,
        include: {
          products: {
            select: {
              id: true,
              name: true,
              sku: true,
            },
          },
          product_variants: {
            select: {
              id: true,
              sku: true,
            },
          },
          users: {
            select: {
              id: true,
              username: true,
              first_name: true,
              last_name: true,
            },
          },
        },
        orderBy: { transaction_date: 'desc' },
        skip: query.offset || 0,
        take: query.limit || 50,
      }),
      this.prisma.inventory_transactions.count({ where }),
    ]);

    return {
      transactions,
      total,
      hasMore: (query.offset || 0) + transactions.length < total,
    };
  }

  /**
   * Obtiene una transacción por ID
   */
  async getTransactionById(id: number): Promise<InventoryTransaction> {
    const transaction = await this.prisma.inventory_transactions.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
          },
        },
        product_variants: {
          select: {
            id: true,
            sku: true,
          },
        },
        users: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
        order_items: {
          select: {
            id: true,
            quantity: true,
            unit_price: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException(`Transaction with ID ${id} not found`);
    }

    return transaction;
  }

  /**
   * Obtiene resumen de transacciones por tipo
   */
  async getTransactionSummary(
    productId?: number,
    variantId?: number,
    startDate?: Date,
    endDate?: Date,
  ): Promise<any> {
    const where = {
      ...(productId && { product_id: productId }),
      ...(variantId && { product_variant_id: variantId }),
      ...(startDate &&
        endDate && {
          transaction_date: {
            gte: startDate,
            lte: endDate,
          },
        }),
    };

    const summary = await this.prisma.inventory_transactions.groupBy({
      by: ['type'],
      where,
      _sum: {
        quantity_change: true,
      },
      _count: {
        id: true,
      },
    });

    return summary.map((item) => ({
      type: item.type,
      totalQuantity: item._sum.quantity_change || 0,
      transactionCount: item._count.id,
    }));
  }

  /**
   * Obtiene últimas transacciones de toda la organización
   */
  async getRecentTransactions(
    organizationId: number,
    limit: number = 20,
  ): Promise<InventoryTransaction[]> {
    return await this.prisma.inventory_transactions.findMany({
      where: {
        products: {
          stores: {
            organization_id: organizationId,
          },
        },
      },
      include: {
        products: {
          select: {
            id: true,
            name: true,
            sku: true,
            stores: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        product_variants: {
          select: {
            id: true,
            sku: true,
          },
        },
        users: {
          select: {
            id: true,
            username: true,
            first_name: true,
            last_name: true,
          },
        },
      },
      orderBy: { transaction_date: 'desc' },
      take: limit,
    });
  }

  /**
   * Elimina transacciones antiguas (mantenimiento)
   */
  async deleteOldTransactions(daysToKeep: number = 365): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await this.prisma.inventory_transactions.deleteMany({
      where: {
        transaction_date: {
          lt: cutoffDate,
        },
      },
    });

    return result.count;
  }

  /**
   * Valida que una transacción sea válida antes de crearla
   */
  private async validateTransaction(data: CreateTransactionDto): Promise<void> {
    // Validar que el producto existe
    const product = await this.prisma.products.findUnique({
      where: { id: data.productId },
    });

    if (!product) {
      throw new BadRequestException(
        `Product with ID ${data.productId} not found`,
      );
    }

    // Validar variante si se especifica
    if (data.variantId) {
      const variant = await this.prisma.product_variants.findUnique({
        where: { id: data.variantId },
      });

      if (!variant || variant.product_id !== data.productId) {
        throw new BadRequestException(`Invalid variant for product`);
      }
    }

    // Validar usuario si se especifica
    if (data.userId) {
      const user = await this.prisma.users.findUnique({
        where: { id: data.userId },
      });

      if (!user) {
        throw new BadRequestException(`User with ID ${data.userId} not found`);
      }
    }

    // Validar order item si se especifica
    if (data.orderItemId) {
      const orderItem = await this.prisma.order_items.findUnique({
        where: { id: data.orderItemId },
      });

      if (!orderItem) {
        throw new BadRequestException(
          `Order item with ID ${data.orderItemId} not found`,
        );
      }
    }
  }
}
