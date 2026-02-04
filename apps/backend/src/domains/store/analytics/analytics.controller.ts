import {
  Controller,
  Get,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { SalesAnalyticsService } from './services/sales-analytics.service';
import { InventoryAnalyticsService } from './services/inventory-analytics.service';
import { SalesAnalyticsQueryDto, InventoryAnalyticsQueryDto } from './dto/analytics-query.dto';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('store/analytics')
export class AnalyticsController {
  constructor(
    private readonly sales_analytics_service: SalesAnalyticsService,
    private readonly inventory_analytics_service: InventoryAnalyticsService,
    private readonly response_service: ResponseService,
  ) {}

  // ==================== SALES ANALYTICS ====================

  @Get('sales/summary')
  async getSalesSummary(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesSummary(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-product')
  async getSalesByProduct(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByProduct(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-category')
  async getSalesByCategory(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByCategory(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-payment-method')
  async getSalesByPaymentMethod(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByPaymentMethod(query);
    return this.response_service.success(result);
  }

  @Get('sales/trends')
  async getSalesTrends(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesTrends(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-customer')
  async getSalesByCustomer(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByCustomer(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-channel')
  async getSalesByChannel(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByChannel(query);
    return this.response_service.success(result);
  }

  @Get('sales/export')
  async exportSalesAnalytics(
    @Query() query: SalesAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.sales_analytics_service.getSalesByProduct(query);

    // Convert to CSV
    const csv = this.convertToCSV(data, [
      'product_name',
      'sku',
      'units_sold',
      'revenue',
      'average_price',
      'profit_margin',
    ]);

    const filename = `sales_analytics_${new Date().toISOString().split('T')[0]}.csv`;
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  // ==================== INVENTORY ANALYTICS ====================

  @Get('inventory/summary')
  async getInventorySummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getInventorySummary(query);
    return this.response_service.success(result);
  }

  @Get('inventory/stock-levels')
  async getStockLevels(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getStockLevels(query);
    return this.response_service.success(result);
  }

  @Get('inventory/low-stock')
  async getLowStockAlerts(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getLowStockAlerts(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movements')
  async getStockMovements(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getStockMovements(query);
    return this.response_service.success(result);
  }

  @Get('inventory/valuation')
  async getInventoryValuation(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getInventoryValuation(query);
    return this.response_service.success(result);
  }

  @Get('inventory/export')
  async exportInventoryAnalytics(
    @Query() query: InventoryAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.inventory_analytics_service.getStockLevels(query);

    // Convert to CSV
    const csv = this.convertToCSV(data, [
      'product_name',
      'sku',
      'quantity_on_hand',
      'quantity_available',
      'reorder_point',
      'cost_per_unit',
      'total_value',
      'status',
    ]);

    const filename = `inventory_analytics_${new Date().toISOString().split('T')[0]}.csv`;
    res.set({
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(Buffer.from(csv, 'utf-8'));
  }

  // ==================== HELPERS ====================

  private convertToCSV(data: any[], columns: string[]): string {
    if (!data || data.length === 0) {
      return columns.join(',') + '\n';
    }

    const header = columns.join(',');
    const rows = data.map((item) =>
      columns
        .map((col) => {
          const value = item[col];
          if (value === null || value === undefined) return '';
          if (typeof value === 'string' && value.includes(',')) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return String(value);
        })
        .join(','),
    );

    return [header, ...rows].join('\n');
  }
}
