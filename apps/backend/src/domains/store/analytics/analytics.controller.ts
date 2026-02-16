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
import { ProductsAnalyticsService } from './services/products-analytics.service';
import { SalesAnalyticsQueryDto, InventoryAnalyticsQueryDto, ProductsAnalyticsQueryDto } from './dto/analytics-query.dto';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('store/analytics')
export class AnalyticsController {
  constructor(
    private readonly sales_analytics_service: SalesAnalyticsService,
    private readonly inventory_analytics_service: InventoryAnalyticsService,
    private readonly products_analytics_service: ProductsAnalyticsService,
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
    const rows = await this.sales_analytics_service.getOrdersForExport(query);

    const data = rows.map(r => ({
      'Nº Orden': r.order_number,
      'Fecha': r.date,
      'Cliente': r.customer_name,
      'Email': r.customer_email,
      'Canal': r.channel,
      'Producto': r.product_name,
      'SKU': r.sku,
      'Cantidad': r.quantity,
      'Precio Unitario': r.unit_price,
      'Total Item': r.item_total,
      'Subtotal': r.subtotal,
      'Descuento': r.discount,
      'Impuesto': r.tax,
      'Envío': r.shipping,
      'Gran Total': r.grand_total,
      'Método de Pago': r.payment_method,
      'Estado': r.state,
    }));

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Ventas');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `ventas_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  // ==================== PRODUCTS ANALYTICS ====================

  @Get('products/summary')
  async getProductsSummary(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductsSummary(query);
    return this.response_service.success(result);
  }

  @Get('products/top-sellers')
  async getTopSellingProducts(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getTopSellingProducts(query);
    return this.response_service.success(result);
  }

  @Get('products/table')
  async getProductsTable(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductsTable(query);
    return result;
  }

  @Get('products/export')
  async exportProductsAnalytics(
    @Query() query: ProductsAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.products_analytics_service.getProductsForExport(query);

    const data = rows.map(r => ({
      'Producto': r.name,
      'SKU': r.sku,
      'Precio Base': r.base_price,
      'Precio Costo': r.cost_price,
      'Stock': r.stock_quantity,
      'Unidades Vendidas': r.units_sold,
      'Ingresos': r.revenue,
      'Margen (%)': r.profit_margin,
    }));

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Productos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `productos_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
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

  @Get('inventory/movement-summary')
  async getMovementSummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getMovementSummary(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movement-trends')
  async getMovementTrends(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getMovementTrends(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movements/export')
  async exportMovementsXlsx(
    @Query() query: InventoryAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.inventory_analytics_service.getMovementsForExport(query);

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Movimientos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `movimientos_inventario_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
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
