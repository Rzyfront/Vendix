import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Workbook } from 'exceljs';
import type { Response } from 'express';
import { AnalyticsController } from './analytics.controller';
import { InventoryAnalyticsService, LowStockReportRow } from './services/inventory-analytics.service';
import { InventoryAnalyticsQueryDto } from './dto/analytics-query.dto';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { XLSX_CONTENT_TYPE } from '@common/reports/report-response.util';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';

describe('AnalyticsController low-stock XLSX export', () => {
  let controller: AnalyticsController;
  let inventory: InventoryAnalyticsService;
  let settings: jest.Mock;
  let headers: Record<string, string>;
  let body: Buffer | undefined;
  let res: Response;

  const row = (id: number, qty: number, cost: number): LowStockReportRow => ({
    product_id: id, product_name: id === 1 ? 'Árbol' : 'Zorro', sku: `000${id}`,
    image_url: null, category_id: 7, category_name: 'Categoría B',
    quantity_available: qty, stock_quantity: qty, min_stock_level: 5, reorder_point: 5,
    stock_value_at_risk: qty * cost, days_of_stock: null,
    status: qty === 0 ? 'out_of_stock' : 'low_stock',
  });

  beforeEach(() => {
    // Fake Date only: ExcelJS's zip promises continue using real scheduling.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-02-01T04:00:00.000Z'));
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, organization_id: 1, is_super_admin: false, is_owner: false });
    settings = jest.fn().mockResolvedValue(null);
    const prisma = { products: { findMany: jest.fn() }, store_settings: { findFirst: settings } } as unknown as StorePrismaService;
    inventory = new InventoryAnalyticsService(prisma, new ResponseService());
    controller = new AnalyticsController(null!, inventory, null!, null!, null!, null!, null!, null!, null!, null!, new ResponseService(), prisma);
    headers = {};
    body = undefined;
    res = {
      set: jest.fn((values: Record<string, string>) => { Object.assign(headers, values); }),
      end: jest.fn((buffer: Buffer) => { body = buffer; }),
    } as unknown as Response;
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  async function workbook(): Promise<Workbook> {
    expect(Buffer.isBuffer(body)).toBe(true);
    const result = new Workbook();
    await result.xlsx.load(body! as unknown as ArrayBuffer);
    return result;
  }

  it('registers the route GET with the existing analytics permission and guard', () => {
    const method = AnalyticsController.prototype.exportLowStockAlerts;
    expect(Reflect.getMetadata(PATH_METADATA, AnalyticsController)).toBe('store/analytics');
    expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('inventory/low-stock/export');
    expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['store:analytics:read']);
    expect(Reflect.getMetadata(GUARDS_METADATA, AnalyticsController)).toContain(PermissionsGuard);
  });

  it('forwards filters to the complete reader and emits a professionally typed XLSX, not CSV', async () => {
    const query: InventoryAnalyticsQueryDto = { category_id: 7, sort_by: 'name', sort_direction: 'desc', page: 20, limit: 1 };
    const reader = jest.spyOn(inventory, 'getLowStockForExport').mockResolvedValue([row(2, 3, 12.34), row(1, 0, 0)]);
    await controller.exportLowStockAlerts(query, res);
    expect(reader).toHaveBeenCalledWith(query);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(headers['Content-Type']).toBe(XLSX_CONTENT_TYPE);
    expect(headers['Content-Disposition']).toContain('stock_bajo_2026-01-31.xlsx');
    const sheet = (await workbook()).getWorksheet('Stock Bajo')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Producto', 'SKU', 'Categoría', 'Stock Actual', 'Stock Mínimo', 'Punto de Reorden', 'Estado', 'Valor en Riesgo']);
    expect(sheet.getCell('A1').font.bold).toBe(true);
    expect(sheet.getCell('A2').value).toBe('Zorro');
    expect(sheet.getCell('B2').value).toBe('0002');
    expect(sheet.getCell('C2').value).toBe('Categoría B');
    expect(sheet.getCell('D2').value).toBe(3);
    expect(sheet.getCell('G2').value).toBe('Stock bajo');
    expect(sheet.getCell('G3').value).toBe('Agotado');
    expect(sheet.getCell('H2').value).toBeCloseTo(37.02, 2);
    expect(sheet.getCell('D2').numFmt).toBe('#,##0.######');
    expect(sheet.getCell('H2').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('A4').value).toBe('TOTAL');
    expect(sheet.getCell('D4').value).toBe(3);
    expect(sheet.getCell('H4').value).toBeCloseTo(37.02, 2);
    expect(sheet.getCell('H4').font.bold).toBe(true);
    expect(sheet.getCell('E4').value).toBeNull();
    expect(sheet.getCell('F4').value).toBeNull();
    expect(sheet.getColumn(1).width).toBe(36);
  });

  it('uses the authoritative store timezone for the local filename', async () => {
    settings.mockResolvedValue({ stores: { timezone: 'Asia/Tokyo' }, settings: { general: { timezone: 'America/Bogota' } } });
    jest.spyOn(inventory, 'getLowStockForExport').mockResolvedValue([row(1, 1, 10)]);
    await controller.exportLowStockAlerts({}, res);
    expect(headers['Content-Disposition']).toContain('stock_bajo_2026-02-01.xlsx');
    expect(settings).toHaveBeenCalledWith(expect.objectContaining({ where: { store_id: 1 } }));
  });

  it('produces a valid empty workbook with zero totals', async () => {
    jest.spyOn(inventory, 'getLowStockForExport').mockResolvedValue([]);
    await controller.exportLowStockAlerts({}, res);
    const sheet = (await workbook()).getWorksheet('Stock Bajo')!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell('A2').value).toBe('TOTAL');
    expect(sheet.getCell('D2').value).toBe(0);
    expect(sheet.getCell('H2').value).toBe(0);
  });

  it('preserves complete totals metadata in the paginated screen response', async () => {
    jest.spyOn(inventory, 'getLowStockAlerts').mockResolvedValue({
      data: [row(2, 3, 20)],
      meta: { pagination: { total: 2, page: 2, limit: 1, total_pages: 2 }, totals: { stock_quantity: 5, stock_value_at_risk: 80 } },
    });
    const result = await controller.getLowStockAlerts({ page: 2, limit: 1 });
    expect(result.data).toHaveLength(1);
    expect(result.meta?.totals).toEqual({ stock_quantity: 5, stock_value_at_risk: 80 });
    expect(result.meta?.total).toBe(2);
  });

  it('does not send a successful workbook when store context is missing', async () => {
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined);
    await expect(controller.exportLowStockAlerts({}, res)).rejects.toThrow();
    expect(res.end).not.toHaveBeenCalled();
    expect(settings).not.toHaveBeenCalled();
  });

  it('propagates a reader failure without headers or success body', async () => {
    jest.spyOn(inventory, 'getLowStockForExport').mockRejectedValue(new Error('reader failed'));
    await expect(controller.exportLowStockAlerts({}, res)).rejects.toThrow('reader failed');
    expect(res.set).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });
});
