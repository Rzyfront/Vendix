import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { UseGuards } from '@nestjs/common';
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
import { OverviewAnalyticsService } from './services/overview-analytics.service';
import { CustomersAnalyticsService } from './services/customers-analytics.service';
import { FinancialAnalyticsService } from './services/financial-analytics.service';
import { AnalyticsQueryDto, SalesAnalyticsQueryDto, InventoryAnalyticsQueryDto, ProductsAnalyticsQueryDto } from './dto/analytics-query.dto';
import { ResponseService } from '../../../common/responses/response.service';

@Controller('store/analytics')
@UseGuards(PermissionsGuard)
export class AnalyticsController {
  constructor(
    private readonly sales_analytics_service: SalesAnalyticsService,
    private readonly inventory_analytics_service: InventoryAnalyticsService,
    private readonly products_analytics_service: ProductsAnalyticsService,
    private readonly overview_analytics_service: OverviewAnalyticsService,
    private readonly customers_analytics_service: CustomersAnalyticsService,
    private readonly financial_analytics_service: FinancialAnalyticsService,
    private readonly response_service: ResponseService,
  ) {}

  // ==================== OVERVIEW ANALYTICS ====================

  @Get('overview/summary')
  @Permissions('store:analytics:read')
  async getOverviewSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.overview_analytics_service.getOverviewSummary(query);
    return this.response_service.success(result);
  }

  @Get('overview/trends')
  @Permissions('store:analytics:read')
  async getOverviewTrends(@Query() query: AnalyticsQueryDto) {
    const result = await this.overview_analytics_service.getOverviewTrends(query);
    return this.response_service.success(result);
  }

  // ==================== SALES ANALYTICS ====================

  @Get('sales/summary')
  @Permissions('store:analytics:read')
  async getSalesSummary(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesSummary(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-product')
  @Permissions('store:analytics:read')
  async getSalesByProduct(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByProduct(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('sales/by-category')
  @Permissions('store:analytics:read')
  async getSalesByCategory(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByCategory(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('sales/by-payment-method')
  @Permissions('store:analytics:read')
  async getSalesByPaymentMethod(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByPaymentMethod(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('sales/trends')
  @Permissions('store:analytics:read')
  async getSalesTrends(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesTrends(query);
    return this.response_service.success(result);
  }

  @Get('sales/by-customer')
  @Permissions('store:analytics:read')
  async getSalesByCustomer(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByCustomer(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('sales/by-channel')
  @Permissions('store:analytics:read')
  async getSalesByChannel(@Query() query: SalesAnalyticsQueryDto) {
    const result = await this.sales_analytics_service.getSalesByChannel(query);
    return this.response_service.success(result);
  }

  @Get('sales/export')
  @Permissions('store:analytics:read')
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
  @Permissions('store:analytics:read')
  async getProductsSummary(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductsSummary(query);
    return this.response_service.success(result);
  }

  @Get('products/top-sellers')
  @Permissions('store:analytics:read')
  async getTopSellingProducts(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getTopSellingProducts(query);
    return this.response_service.success(result);
  }

  @Get('products/trends')
  @Permissions('store:analytics:read')
  async getProductsTrends(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductsTrends(query);
    return this.response_service.success(result);
  }

  @Get('products/table')
  @Permissions('store:analytics:read')
  async getProductsTable(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductsTable(query);
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('products/export')
  @Permissions('store:analytics:read')
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

  @Get('products/performance')
  @Permissions('store:analytics:read')
  async getProductPerformance(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductPerformance(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('products/profitability')
  @Permissions('store:analytics:read')
  async getProductProfitability(@Query() query: ProductsAnalyticsQueryDto) {
    const result = await this.products_analytics_service.getProductProfitability(query);
    if ((result as any).products) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      (result as any).data,
      (result as any).meta.pagination.total,
      (result as any).meta.pagination.page,
      (result as any).meta.pagination.limit,
    );
  }

  @Get('products/performance/export')
  @Permissions('store:analytics:read')
  async exportProductPerformance(
    @Query() query: ProductsAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.products_analytics_service.getProductPerformanceForExport(query);

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Rendimiento');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `rendimiento_productos_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  @Get('products/profitability/export')
  @Permissions('store:analytics:read')
  async exportProductProfitability(
    @Query() query: ProductsAnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.products_analytics_service.getProductProfitabilityForExport(query);

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Rentabilidad');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `rentabilidad_productos_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  // ==================== INVENTORY ANALYTICS ====================

  @Get('inventory/summary')
  @Permissions('store:analytics:read')
  async getInventorySummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getInventorySummary(query);
    return this.response_service.success(result);
  }

  @Get('inventory/stock-levels')
  @Permissions('store:analytics:read')
  async getStockLevels(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getStockLevels(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('inventory/low-stock')
  @Permissions('store:analytics:read')
  async getLowStockAlerts(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getLowStockAlerts(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('inventory/movements')
  @Permissions('store:analytics:read')
  async getStockMovements(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getStockMovements(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('inventory/valuation')
  @Permissions('store:analytics:read')
  async getInventoryValuation(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getInventoryValuation(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movement-summary')
  @Permissions('store:analytics:read')
  async getMovementSummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getMovementSummary(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movement-trends')
  @Permissions('store:analytics:read')
  async getMovementTrends(@Query() query: InventoryAnalyticsQueryDto) {
    const result = await this.inventory_analytics_service.getMovementTrends(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movements/export')
  @Permissions('store:analytics:read')
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
  @Permissions('store:analytics:read')
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

  // ==================== CUSTOMERS ANALYTICS ====================

  @Get('customers/summary')
  @Permissions('store:analytics:read')
  async getCustomersSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getCustomersSummary(query);
    return this.response_service.success(result);
  }

  @Get('customers/trends')
  @Permissions('store:analytics:read')
  async getCustomersTrends(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getCustomersTrends(query);
    return this.response_service.success(result);
  }

  @Get('customers/top')
  @Permissions('store:analytics:read')
  async getTopCustomers(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getTopCustomers(query);
    if (Array.isArray(result)) {
      return this.response_service.success(result);
    }
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('customers/export')
  @Permissions('store:analytics:read')
  async exportCustomersAnalytics(
    @Query() query: AnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.customers_analytics_service.getCustomersForExport(query);

    const data = rows.map(r => ({
      'Nombre': r.name,
      'Email': r.email,
      'Teléfono': r.phone,
      'Total Órdenes': r.total_orders,
      'Total Gastado': r.total_spent,
      'Última Orden': r.last_order_date,
      'Fecha Registro': r.registration_date,
      'Estado': r.state,
    }));

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Clientes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `clientes_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  // ==================== FINANCIAL ANALYTICS ====================

  @Get('financial/tax-summary')
  @Permissions('store:analytics:read')
  async getTaxSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.financial_analytics_service.getTaxSummary(query);
    return this.response_service.success(result);
  }

  @Get('financial/cash-sessions')
  @Permissions('store:analytics:read')
  async getCashSessionsReport(@Query() query: AnalyticsQueryDto) {
    const result = await this.financial_analytics_service.getCashSessionsReport(query);
    return this.response_service.paginated(
      result.data,
      result.meta.pagination.total,
      result.meta.pagination.page,
      result.meta.pagination.limit,
    );
  }

  @Get('financial/profit-loss')
  @Permissions('store:analytics:read')
  async getProfitLossSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.financial_analytics_service.getProfitLossSummary(query);
    return this.response_service.success(result);
  }

  @Get('financial/tax-summary/export')
  @Permissions('store:analytics:read')
  async exportTaxSummary(
    @Query() query: AnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.financial_analytics_service.getTaxSummaryForExport(query);

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Impuestos');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `impuestos_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
  }

  @Get('financial/cash-sessions/export')
  @Permissions('store:analytics:read')
  async exportCashSessions(
    @Query() query: AnalyticsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const data = await this.financial_analytics_service.getCashSessionsForExport(query);

    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Sesiones de Caja');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `sesiones_caja_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });

    return new StreamableFile(buffer);
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
