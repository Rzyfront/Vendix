import { Injectable, Logger } from '@nestjs/common';
import { StorePrismaService } from '../../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpResourceContent {
  uri: string;
  mimeType: string;
  text: string;
}

@Injectable()
export class McpResourceProvider {
  private readonly logger = new Logger(McpResourceProvider.name);

  constructor(private readonly prisma: StorePrismaService) {}

  listResources(): McpResource[] {
    const context = RequestContextService.getContext();
    const storeId = context?.store_id || 'unknown';

    return [
      {
        uri: `vendix://products/${storeId}`,
        name: 'Product Catalog',
        description: 'Active product catalog with prices and stock levels',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://inventory/${storeId}`,
        name: 'Inventory Status',
        description: 'Current stock levels across all locations',
        mimeType: 'application/json',
      },
      {
        uri: `vendix://reports/sales/${storeId}`,
        name: 'Sales Summary',
        description: 'Recent sales summary and order statistics',
        mimeType: 'application/json',
      },
    ];
  }

  async readResource(uri: string): Promise<McpResourceContent> {
    const context = RequestContextService.getContext();

    if (uri.startsWith('vendix://products/')) {
      const products = await this.prisma.products.findMany({
        where: { state: 'active' },
        select: {
          id: true,
          name: true,
          base_price: true,
          sku: true,
          state: true,
        },
        take: 100,
      });

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: products.length,
          products,
        }),
      };
    }

    if (uri.startsWith('vendix://inventory/')) {
      const products = await this.prisma.products.findMany({
        where: { state: 'active' },
        select: {
          id: true,
          name: true,
          sku: true,
          stock_quantity: true,
        },
        take: 100,
      });

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          count: products.length,
          inventory: products,
        }),
      };
    }

    if (uri.startsWith('vendix://reports/sales/')) {
      const orders = await this.prisma.orders.findMany({
        orderBy: { created_at: 'desc' },
        take: 50,
        select: {
          id: true,
          order_number: true,
          grand_total: true,
          state: true,
          created_at: true,
        },
      });

      const totalRevenue = orders.reduce(
        (sum, o) => sum + Number(o.grand_total || 0),
        0,
      );

      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          store_id: context?.store_id,
          period: 'recent',
          total_orders: orders.length,
          total_revenue: totalRevenue,
          orders,
        }),
      };
    }

    return {
      uri,
      mimeType: 'text/plain',
      text: `Resource not found: ${uri}`,
    };
  }
}
