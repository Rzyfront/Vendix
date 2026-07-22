import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Permissions } from '../../auth/decorators/permissions.decorator';
import { SalesAnalyticsService } from './services/sales-analytics.service';
import { InventoryAnalyticsService } from './services/inventory-analytics.service';
import { ProductsAnalyticsService } from './services/products-analytics.service';
import { OverviewAnalyticsService } from './services/overview-analytics.service';
import { CustomersAnalyticsService } from './services/customers-analytics.service';
import { FinancialAnalyticsService } from './services/financial-analytics.service';
import { PurchasesAnalyticsService } from './services/purchases-analytics.service';
import { ReviewsAnalyticsService } from './services/reviews-analytics.service';
import {
  AnalyticsQueryDto,
  SalesAnalyticsQueryDto,
  InventoryAnalyticsQueryDto,
  ProductsAnalyticsQueryDto,
} from './dto/analytics-query.dto';
import { ResponseService } from '../../../common/responses/response.service';
import {
  buildReportBuffer,
  formatCellDate,
} from '@common/reports/report-builder';
import {
  sendXlsxReport,
  buildReportFilename,
} from '@common/reports/report-response.util';
import type {
  ReportColumn,
  ReportSheet,
} from '@common/reports/report-column.types';
import { RequestContextService } from '@common/context/request-context.service';
import {
  resolveStoreTimezone,
  DEFAULT_STORE_TIMEZONE,
} from '@common/utils/store-timezone.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';

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
    private readonly purchases_analytics_service: PurchasesAnalyticsService,
    private readonly reviews_analytics_service: ReviewsAnalyticsService,
    private readonly response_service: ResponseService,
    private readonly prisma: StorePrismaService,
  ) {}

  // ==================== REPORT EMISSION HELPERS ====================

  /**
   * Resolves the store timezone once per request (single source of truth).
   * Falls back to the platform default when there is no store context.
   */
  private async resolveReportTz(): Promise<string> {
    const storeId = RequestContextService.getStoreId();
    if (!storeId) return DEFAULT_STORE_TIMEZONE;
    return resolveStoreTimezone(this.prisma, storeId);
  }

  /**
   * Builds a {@link ReportSheet}. Rows arrive as concrete service DTOs (which
   * lack a string index signature); the ReportBuilder only reads them by column
   * key, so the widening cast here is safe and centralized.
   */
  private toSheet(
    name: string,
    columns: ReportColumn[],
    rows: readonly unknown[],
    tz: string,
  ): ReportSheet {
    return {
      name,
      columns,
      rows: rows as unknown as Record<string, unknown>[],
      tz,
    };
  }

  /** Renders the sheets to xlsx and streams the download response. */
  private async emitReport(
    res: Response,
    base: string,
    tz: string,
    sheets: ReportSheet[],
  ): Promise<void> {
    const buffer = await buildReportBuffer({ sheets });
    sendXlsxReport(res, buffer, buildReportFilename(base, { tz }));
  }

  // ==================== OVERVIEW ANALYTICS ====================

  @Get('overview/summary')
  @Permissions('store:analytics:read')
  async getOverviewSummary(@Query() query: AnalyticsQueryDto) {
    const result =
      await this.overview_analytics_service.getOverviewSummary(query);
    return this.response_service.success(result);
  }

  @Get('overview/trends')
  @Permissions('store:analytics:read')
  async getOverviewTrends(@Query() query: AnalyticsQueryDto) {
    const result =
      await this.overview_analytics_service.getOverviewTrends(query);
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
    const result =
      await this.sales_analytics_service.getSalesByPaymentMethod(query);
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
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const result = await this.sales_analytics_service.getOrdersForExport(query);

    const orderColumns: ReportColumn[] = [
      { key: 'order_number', header: 'Nº Orden', type: 'text' },
      { key: 'created_at', header: 'Fecha', type: 'date' },
      { key: 'paid_at', header: 'Fecha de Pago', type: 'date' },
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'customer_document_type', header: 'Tipo Documento', type: 'text' },
      { key: 'customer_document', header: 'Documento', type: 'text' },
      { key: 'customer_email', header: 'Email', type: 'text' },
      { key: 'channel', header: 'Canal', type: 'text' },
      { key: 'payment_method', header: 'Método de Pago', type: 'text' },
      { key: 'currency', header: 'Moneda', type: 'text' },
      { key: 'subtotal', header: 'Subtotal', type: 'currency' },
      { key: 'discount', header: 'Descuento', type: 'currency' },
      { key: 'tax', header: 'Impuesto', type: 'currency' },
      { key: 'shipping', header: 'Envío', type: 'currency' },
      { key: 'tip', header: 'Propina', type: 'currency' },
      { key: 'grand_total', header: 'Gran Total', type: 'currency' },
      { key: 'state', header: 'Estado', type: 'text' },
    ];

    const itemColumns: ReportColumn[] = [
      { key: 'order_number', header: 'Nº Orden', type: 'text' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'quantity', header: 'Cantidad', type: 'number' },
      { key: 'unit_price', header: 'Precio Unitario', type: 'currency' },
      { key: 'line_total', header: 'Total Línea', type: 'currency' },
    ];

    await this.emitReport(res, 'ventas', tz, [
      this.toSheet('Órdenes', orderColumns, result.orders, tz),
      this.toSheet('Detalle', itemColumns, result.items, tz),
    ]);
  }

  // ==================== PRODUCTS ANALYTICS ====================

  @Get('products/summary')
  @Permissions('store:analytics:read')
  async getProductsSummary(@Query() query: ProductsAnalyticsQueryDto) {
    const result =
      await this.products_analytics_service.getProductsSummary(query);
    return this.response_service.success(result);
  }

  @Get('products/top-sellers')
  @Permissions('store:analytics:read')
  async getTopSellingProducts(@Query() query: ProductsAnalyticsQueryDto) {
    const result =
      await this.products_analytics_service.getTopSellingProducts(query);
    return this.response_service.success(result);
  }

  @Get('products/trends')
  @Permissions('store:analytics:read')
  async getProductsTrends(@Query() query: ProductsAnalyticsQueryDto) {
    const result =
      await this.products_analytics_service.getProductsTrends(query);
    return this.response_service.success(result);
  }

  @Get('products/table')
  @Permissions('store:analytics:read')
  async getProductsTable(@Query() query: ProductsAnalyticsQueryDto) {
    const result =
      await this.products_analytics_service.getProductsTable(query);
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
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.products_analytics_service.getProductsForExport(query);

    const columns: ReportColumn[] = [
      { key: 'name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'base_price', header: 'Precio Base', type: 'currency' },
      { key: 'cost_price', header: 'Precio Costo', type: 'currency' },
      { key: 'stock_quantity', header: 'Stock', type: 'number' },
      { key: 'units_sold', header: 'Unidades Vendidas', type: 'number' },
      { key: 'revenue', header: 'Ingresos', type: 'currency' },
      // profit_margin is already a 0-100 percentage number (not a fraction), so
      // it is emitted as a plain number to avoid the ×100 double-scaling that a
      // `percent` column would apply.
      { key: 'profit_margin', header: 'Margen (%)', type: 'number' },
    ];

    await this.emitReport(res, 'productos', tz, [
      this.toSheet('Productos', columns, rows, tz),
    ]);
  }

  @Get('products/performance')
  @Permissions('store:analytics:read')
  async getProductPerformance(@Query() query: ProductsAnalyticsQueryDto) {
    const result =
      await this.products_analytics_service.getProductPerformance(query);
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
    const result =
      await this.products_analytics_service.getProductProfitability(query);
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
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.products_analytics_service.getProductPerformanceForExport(
        query,
      );

    // The service returns rows keyed by their Spanish header labels; keys match
    // those labels exactly.
    const columns: ReportColumn[] = [
      { key: 'Producto', header: 'Producto', type: 'text' },
      { key: 'SKU', header: 'SKU', type: 'text' },
      { key: 'Unidades Vendidas', header: 'Unidades Vendidas', type: 'number' },
      { key: 'Ingresos', header: 'Ingresos', type: 'currency' },
      { key: 'Devoluciones', header: 'Devoluciones', type: 'number' },
      { key: 'Monto Devuelto', header: 'Monto Devuelto', type: 'currency' },
      {
        key: 'Tasa Devolución (%)',
        header: 'Tasa Devolución (%)',
        type: 'number',
      },
      { key: 'Órdenes', header: 'Órdenes', type: 'number' },
    ];

    await this.emitReport(res, 'rendimiento_productos', tz, [
      this.toSheet('Rendimiento', columns, rows, tz),
    ]);
  }

  @Get('products/profitability/export')
  @Permissions('store:analytics:read')
  async exportProductProfitability(
    @Query() query: ProductsAnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.products_analytics_service.getProductProfitabilityForExport(
        query,
      );

    // The service returns rows keyed by their Spanish header labels.
    const columns: ReportColumn[] = [
      { key: 'Producto', header: 'Producto', type: 'text' },
      { key: 'SKU', header: 'SKU', type: 'text' },
      { key: 'Categoría', header: 'Categoría', type: 'text' },
      { key: 'Unidades Vendidas', header: 'Unidades Vendidas', type: 'number' },
      { key: 'Ingresos', header: 'Ingresos', type: 'currency' },
      {
        key: 'Costo Unitario (Receta)',
        header: 'Costo Unitario (Receta)',
        type: 'currency',
      },
      { key: 'Costo Total', header: 'Costo Total', type: 'currency' },
      { key: 'Ganancia', header: 'Ganancia', type: 'currency' },
      { key: 'Margen (%)', header: 'Margen (%)', type: 'number' },
      { key: 'Markup (%)', header: 'Markup (%)', type: 'number' },
    ];

    await this.emitReport(res, 'rentabilidad_productos', tz, [
      this.toSheet('Rentabilidad', columns, rows, tz),
    ]);
  }

  // ==================== INVENTORY ANALYTICS ====================

  @Get('inventory/summary')
  @Permissions('store:analytics:read')
  async getInventorySummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result =
      await this.inventory_analytics_service.getInventorySummary(query);
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
    const result =
      await this.inventory_analytics_service.getLowStockAlerts(query);
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
    const result =
      await this.inventory_analytics_service.getStockMovements(query);
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
    const result =
      await this.inventory_analytics_service.getInventoryValuation(query);
    return this.response_service.success(result);
  }

  @Get('inventory/aging')
  @Permissions('store:analytics:read')
  async getInventoryAging(@Query() query: InventoryAnalyticsQueryDto) {
    const result =
      await this.inventory_analytics_service.getInventoryAging(query);
    return this.response_service.success(result);
  }

  @Get('inventory/expiring')
  @Permissions('store:analytics:read')
  async getExpiringProducts(@Query() query: InventoryAnalyticsQueryDto) {
    const result =
      await this.inventory_analytics_service.getExpiringProducts(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movement-summary')
  @Permissions('store:analytics:read')
  async getMovementSummary(@Query() query: InventoryAnalyticsQueryDto) {
    const result =
      await this.inventory_analytics_service.getMovementSummary(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movement-trends')
  @Permissions('store:analytics:read')
  async getMovementTrends(@Query() query: InventoryAnalyticsQueryDto) {
    const result =
      await this.inventory_analytics_service.getMovementTrends(query);
    return this.response_service.success(result);
  }

  @Get('inventory/movements/export')
  @Permissions('store:analytics:read')
  async exportMovementsXlsx(
    @Query() query: InventoryAnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.inventory_analytics_service.getMovementsForExport(query);

    const columns: ReportColumn[] = [
      { key: 'id', header: 'ID', type: 'number' },
      { key: 'created_at', header: 'Fecha', type: 'date' },
      { key: 'movement_type', header: 'Tipo', type: 'text' },
      { key: 'product_id', header: 'ID Producto', type: 'number' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'quantity', header: 'Cantidad', type: 'number' },
      { key: 'from_location', header: 'Origen', type: 'text' },
      { key: 'to_location', header: 'Destino', type: 'text' },
      { key: 'user_name', header: 'Usuario', type: 'text' },
      { key: 'reason', header: 'Motivo', type: 'text' },
      { key: 'reference_id', header: 'Referencia', type: 'text' },
    ];

    await this.emitReport(res, 'movimientos_inventario', tz, [
      this.toSheet('Movimientos', columns, rows, tz),
    ]);
  }

  @Get('inventory/export')
  @Permissions('store:analytics:read')
  async exportInventoryAnalytics(
    @Query() query: InventoryAnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.inventory_analytics_service.getStockLevelsForExport(query);

    const columns: ReportColumn[] = [
      { key: 'product_id', header: 'ID', type: 'number' },
      { key: 'product_name', header: 'Producto', type: 'text' },
      { key: 'sku', header: 'SKU', type: 'text' },
      { key: 'quantity_on_hand', header: 'Existencias', type: 'number' },
      { key: 'quantity_reserved', header: 'Reservado', type: 'number' },
      { key: 'quantity_available', header: 'Disponible', type: 'number' },
      { key: 'reorder_point', header: 'Punto Reorden', type: 'number' },
      { key: 'cost_per_unit', header: 'Costo Unitario', type: 'currency' },
      { key: 'total_value', header: 'Valor Total', type: 'currency' },
      { key: 'status', header: 'Estado', type: 'text' },
    ];

    await this.emitReport(res, 'inventario', tz, [
      this.toSheet('Inventario', columns, rows, tz),
    ]);
  }

  // ==================== CUSTOMERS ANALYTICS ====================

  @Get('customers/summary')
  @Permissions('store:analytics:read')
  async getCustomersSummary(@Query() query: AnalyticsQueryDto) {
    const result =
      await this.customers_analytics_service.getCustomersSummary(query);
    return this.response_service.success(result);
  }

  @Get('customers/trends')
  @Permissions('store:analytics:read')
  async getCustomersTrends(@Query() query: AnalyticsQueryDto) {
    const result =
      await this.customers_analytics_service.getCustomersTrends(query);
    return this.response_service.success(result);
  }

  @Get('customers/channels')
  @Permissions('store:analytics:read')
  async getCustomersChannels(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getCustomersChannels(query);
    return this.response_service.success(result);
  }

  @Get('customers/top')
  @Permissions('store:analytics:read')
  async getTopCustomers(@Query() query: AnalyticsQueryDto) {
    const result =
      await this.customers_analytics_service.getTopCustomers(query);
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
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.customers_analytics_service.getCustomersForExport(query);

    // last_order_date / registration_date arrive as RAW Date instants (or null)
    // from the service; the `date` column anchors them to the store-local day.
    const columns: ReportColumn[] = [
      { key: 'name', header: 'Nombre', type: 'text' },
      { key: 'email', header: 'Email', type: 'text' },
      { key: 'phone', header: 'Teléfono', type: 'text' },
      { key: 'total_orders', header: 'Total Órdenes', type: 'number' },
      { key: 'total_spent', header: 'Total Gastado', type: 'currency' },
      { key: 'last_order_date', header: 'Última Orden', type: 'date' },
      { key: 'registration_date', header: 'Fecha Registro', type: 'date' },
      { key: 'state', header: 'Estado', type: 'text' },
    ];

    await this.emitReport(res, 'clientes', tz, [
      this.toSheet('Clientes', columns, rows, tz),
    ]);
  }

  @Get('customers/abandoned-carts/summary')
  @Permissions('store:analytics:read')
  async getAbandonedCartsSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getAbandonedCartsSummary(query);
    return this.response_service.success(result);
  }

  @Get('customers/abandoned-carts/trends')
  @Permissions('store:analytics:read')
  async getAbandonedCartsTrends(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getAbandonedCartsTrends(query);
    return this.response_service.success(result);
  }

  @Get('customers/abandoned-carts/by-reason')
  @Permissions('store:analytics:read')
  async getAbandonedCartsByReason(@Query() query: AnalyticsQueryDto) {
    const result = await this.customers_analytics_service.getAbandonedCartsByReason(query);
    return this.response_service.success(result);
  }

  @Get('customers/abandoned-carts/export')
  @Permissions('store:analytics:read')
  async exportAbandonedCarts(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.customers_analytics_service.getAbandonedCartsForExport(query);

    // created_at / abandoned_at arrive already pre-formatted as strings from the
    // service, so they are emitted as text.
    const columns: ReportColumn[] = [
      { key: 'id', header: 'ID', type: 'number' },
      { key: 'reference', header: 'Referencia', type: 'text' },
      { key: 'customer_name', header: 'Cliente', type: 'text' },
      { key: 'email', header: 'Email', type: 'text' },
      { key: 'abandonment_reason', header: 'Razón Abandono', type: 'text' },
      { key: 'value', header: 'Valor', type: 'currency' },
      { key: 'created_at', header: 'Fecha Creación', type: 'date' },
      { key: 'abandoned_at', header: 'Abandonado el', type: 'date' },
    ];

    await this.emitReport(res, 'carritos_abandonados', tz, [
      this.toSheet('Carritos Abandonados', columns, rows, tz),
    ]);
  }

  // ==================== PURCHASES ANALYTICS ====================

  @Get('purchases/summary')
  @Permissions('store:analytics:read')
  async getPurchasesSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.purchases_analytics_service.getPurchasesSummary(query);
    return this.response_service.success(result);
  }

  @Get('purchases/by-supplier')
  @Permissions('store:analytics:read')
  async getPurchasesBySupplier(@Query() query: AnalyticsQueryDto) {
    const result = await this.purchases_analytics_service.getPurchasesBySupplier(query);
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

  @Get('purchases/export')
  @Permissions('store:analytics:read')
  async exportPurchasesAnalytics(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const result =
      await this.purchases_analytics_service.getPurchasesBySupplier(query);
    const rows = Array.isArray(result) ? result : result.data;

    // last_order_date is a full ISO instant (or null); the `date` column anchors
    // it to the store-local calendar day.
    const columns: ReportColumn[] = [
      { key: 'supplier_name', header: 'Proveedor', type: 'text' },
      { key: 'order_count', header: 'Órdenes', type: 'number' },
      { key: 'total_spent', header: 'Total Gastado', type: 'currency' },
      { key: 'pending_orders', header: 'Pendientes', type: 'number' },
      { key: 'last_order_date', header: 'Última Orden', type: 'date' },
    ];

    await this.emitReport(res, 'compras', tz, [
      this.toSheet('Compras', columns, rows, tz),
    ]);
  }

  // ==================== REVIEWS ANALYTICS ====================

  @Get('reviews/summary')
  @Permissions('store:analytics:read')
  async getReviewsSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.reviews_analytics_service.getReviewsSummary(query);
    return this.response_service.success(result);
  }

  @Get('reviews/export')
  @Permissions('store:analytics:read')
  async exportReviewsAnalytics(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.reviews_analytics_service.getReviewsForExport(query);

    // The service returns rows keyed by their Spanish header labels; 'Fecha'
    // arrives as a RAW Date instant (or null), anchored to the store-local day.
    const columns: ReportColumn[] = [
      { key: 'Fecha', header: 'Fecha', type: 'date' },
      { key: 'Producto', header: 'Producto', type: 'text' },
      { key: 'SKU', header: 'SKU', type: 'text' },
      { key: 'Cliente', header: 'Cliente', type: 'text' },
      { key: 'Email', header: 'Email', type: 'text' },
      { key: 'Calificación', header: 'Calificación', type: 'number' },
      { key: 'Título', header: 'Título', type: 'text' },
      { key: 'Comentario', header: 'Comentario', type: 'text' },
      { key: 'Estado', header: 'Estado', type: 'text' },
      { key: 'Compra Verificada', header: 'Compra Verificada', type: 'text' },
      { key: 'Votos Útiles', header: 'Votos Útiles', type: 'number' },
    ];

    await this.emitReport(res, 'resenas', tz, [
      this.toSheet('Reseñas', columns, rows, tz),
    ]);
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
    const result =
      await this.financial_analytics_service.getCashSessionsReport(query);
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
    const result =
      await this.financial_analytics_service.getProfitLossSummary(query);
    return this.response_service.success(result);
  }

  @Get('financial/refunds')
  @Permissions('store:analytics:read')
  async getRefundsSummary(@Query() query: AnalyticsQueryDto) {
    const result = await this.financial_analytics_service.getRefundsSummary(query);
    return this.response_service.success(result);
  }

  @Get('financial/export')
  @Permissions('store:analytics:read')
  async exportFinancialAnalytics(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const data =
      await this.financial_analytics_service.getFinancialSummaryForExport(
        query,
      );

    // Long-form report: the value type varies PER ROW (discriminated by `unit`),
    // while ReportBuilder types PER COLUMN — so the value column is pre-formatted
    // to text here, one branch per unit.
    const currencyFmt = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const countFmt = new Intl.NumberFormat('es-CO', {
      maximumFractionDigits: 0,
    });

    const rows = data.map((row) => {
      let value = '';
      switch (row.unit) {
        case 'currency':
          value = row.value !== null ? currencyFmt.format(row.value) : '';
          break;
        case 'count':
          value = row.value !== null ? countFmt.format(row.value) : '';
          break;
        case 'percent':
          // The service already emits margins on a 0-100 scale (grossProfit /
          // netRevenue * 100), so the value is a ready percentage, not a
          // fraction — no extra ×100 here.
          value = row.value !== null ? `${row.value.toFixed(2)}%` : '';
          break;
        case 'date':
          value = row.date ? formatCellDate(row.date, tz) : '';
          break;
        case 'text':
        default:
          value = row.text ?? '';
          break;
      }
      return {
        section: FINANCIAL_SECTION_LABELS[row.section] ?? row.section,
        metric: FINANCIAL_METRIC_LABELS[row.metric] ?? row.metric,
        value,
      };
    });

    const columns: ReportColumn[] = [
      { key: 'section', header: 'Sección', type: 'text' },
      { key: 'metric', header: 'Métrica', type: 'text' },
      { key: 'value', header: 'Valor', type: 'text', align: 'right' },
    ];

    await this.emitReport(res, 'financiero', tz, [
      this.toSheet('Financiero', columns, rows, tz),
    ]);
  }

  @Get('financial/tax-summary/export')
  @Permissions('store:analytics:read')
  async exportTaxSummary(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const data =
      await this.financial_analytics_service.getTaxSummaryForExport(query);

    // Localize the discriminator/boolean cells to Spanish text; numeric columns
    // stay raw. tax_rate is stored as a FRACTION (order_item_taxes.tax_rate is
    // Decimal(6,5), e.g. 0.19), so it maps to a `percent` column.
    const rows = data.map((r) => ({
      row_type: r.row_type === 'total' ? 'TOTAL' : 'Detalle',
      tax_name: r.tax_name,
      tax_type: r.tax_type,
      tax_rate: r.tax_rate,
      taxable_amount: r.taxable_amount,
      tax_collected: r.tax_collected,
      is_compound: r.is_compound === null ? null : r.is_compound ? 'Sí' : 'No',
    }));

    const columns: ReportColumn[] = [
      { key: 'row_type', header: 'Tipo', type: 'text' },
      { key: 'tax_name', header: 'Impuesto', type: 'text' },
      { key: 'tax_type', header: 'Tipo fiscal', type: 'text' },
      { key: 'tax_rate', header: 'Tasa', type: 'percent' },
      { key: 'taxable_amount', header: 'Base gravable', type: 'currency' },
      { key: 'tax_collected', header: 'Recaudado', type: 'currency' },
      { key: 'is_compound', header: 'Compuesto', type: 'text' },
    ];

    await this.emitReport(res, 'impuestos', tz, [
      this.toSheet('Impuestos', columns, rows, tz),
    ]);
  }

  @Get('financial/cash-sessions/export')
  @Permissions('store:analytics:read')
  async exportCashSessions(
    @Query() query: AnalyticsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const tz = await this.resolveReportTz();
    const rows =
      await this.financial_analytics_service.getCashSessionsForExport(query);

    const columns: ReportColumn[] = [
      { key: 'opened_at', header: 'Apertura', type: 'date' },
      { key: 'closed_at', header: 'Cierre', type: 'date' },
      { key: 'register_name', header: 'Caja', type: 'text' },
      { key: 'opened_by_name', header: 'Abrió', type: 'text' },
      { key: 'closed_by_name', header: 'Cerró', type: 'text' },
      { key: 'opening_amount', header: 'Monto Apertura', type: 'currency' },
      { key: 'total_sales', header: 'Ventas', type: 'currency' },
      { key: 'total_expenses', header: 'Gastos', type: 'currency' },
      {
        key: 'expected_closing_amount',
        header: 'Cierre Esperado',
        type: 'currency',
      },
      {
        key: 'actual_closing_amount',
        header: 'Cierre Real',
        type: 'currency',
      },
      { key: 'difference', header: 'Diferencia', type: 'currency' },
      { key: 'status', header: 'Estado', type: 'text' },
    ];

    await this.emitReport(res, 'sesiones_caja', tz, [
      this.toSheet('Sesiones de Caja', columns, rows, tz),
    ]);
  }
}

/** Spanish labels for the financial-summary export sections. */
const FINANCIAL_SECTION_LABELS: Record<string, string> = {
  meta: 'Metadatos',
  revenue: 'Ingresos',
  costs: 'Costos',
  refunds: 'Devoluciones',
  expenses: 'Gastos',
  bottom_line: 'Resultado',
};

/** Spanish labels for the financial-summary export metrics. */
const FINANCIAL_METRIC_LABELS: Record<string, string> = {
  period_start: 'Fecha inicio',
  period_end: 'Fecha fin',
  currency: 'Moneda',
  gross_revenue: 'Ingresos brutos',
  discounts: 'Descuentos',
  net_revenue: 'Ingresos netos',
  shipping_revenue: 'Ingresos por envío',
  tax_collected: 'Impuestos recaudados',
  cost_of_goods_sold: 'Costo de ventas (COGS)',
  gross_profit: 'Utilidad bruta',
  gross_margin: 'Margen bruto',
  total_refunds: 'Devoluciones totales',
  subtotal_refunds: 'Subtotal devuelto',
  tax_refunds: 'Impuestos devueltos',
  shipping_refunds: 'Envío devuelto',
  operating_expenses: 'Gastos operativos',
  net_profit: 'Utilidad neta',
  net_margin: 'Margen neto',
  order_count: 'Cantidad de órdenes',
};
