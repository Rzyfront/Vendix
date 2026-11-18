import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import { Workbook } from 'exceljs';
import type { Response } from 'express';
import { RequestContextService } from '@common/context/request-context.service';
import { ResponseService } from '@common/responses/response.service';
import { XLSX_CONTENT_TYPE } from '@common/reports/report-response.util';
import { StorePrismaService } from '../../../prisma/services/store-prisma.service';
import { PERMISSIONS_KEY } from '../../auth/decorators/permissions.decorator';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { SupportDocumentsReportController } from './support-documents-report.controller';
import { SupportDocumentsReportService } from './services/support-documents-report.service';
import { SupportDocumentsReportQueryDto } from './dto/support-documents-report-query.dto';
import { DatePreset } from './dto/analytics-query.dto';

/**
 * Fila de `invoices` en memoria. El fake aplica el `where` que arma el servicio
 * (y rechaza claves que no conoce), así que estos tests ejercitan la consulta
 * real: tipo, estado, proveedor, rango de `issue_date` y tienda.
 */
interface FakeInvoice {
  id: number;
  store_id: number;
  invoice_type: string;
  status: string;
  dian_status: string;
  supplier_id: number | null;
  issue_date: Date;
  invoice_number: string | null;
  customer_name: string | null;
  customer_tax_id: string | null;
  cufe: string | null;
  subtotal_amount: Prisma.Decimal;
  tax_amount: Prisma.Decimal;
  withholding_amount: Prisma.Decimal;
  total_amount: Prisma.Decimal;
  currency: string | null;
  accepted_at: Date | null;
  supplier: { name: string; tax_id: string | null } | null;
  related_invoice: { invoice_number: string | null } | null;
  purchase_order: { id: number; order_number: string } | null;
}

type Where = Record<string, any>;
const KNOWN_WHERE_KEYS = ['store_id', 'invoice_type', 'status', 'dian_status', 'supplier_id', 'issue_date'];

function matches(doc: FakeInvoice, where: Where): boolean {
  for (const key of Object.keys(where)) {
    if (!KNOWN_WHERE_KEYS.includes(key)) throw new Error(`fake: unsupported where.${key}`);
  }
  if (where.store_id !== undefined && doc.store_id !== where.store_id) return false;
  if (where.invoice_type?.in && !where.invoice_type.in.includes(doc.invoice_type)) return false;
  if (where.status?.in && !where.status.in.includes(doc.status)) return false;
  if (where.dian_status?.in && !where.dian_status.in.includes(doc.dian_status)) return false;
  if (where.supplier_id !== undefined && doc.supplier_id !== where.supplier_id) return false;
  if (where.issue_date?.gte && doc.issue_date < where.issue_date.gte) return false;
  if (where.issue_date?.lte && doc.issue_date > where.issue_date.lte) return false;
  return true;
}

function sortDocs(docs: FakeInvoice[], orderBy: Array<Record<string, 'asc' | 'desc'>>): FakeInvoice[] {
  return [...docs].sort((a, b) => {
    for (const clause of orderBy) {
      const [field, dir] = Object.entries(clause)[0];
      const av = (a as any)[field];
      const bv = (b as any)[field];
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

const dec = (v: string) => new Prisma.Decimal(v);
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function doc(partial: Partial<FakeInvoice> & Pick<FakeInvoice, 'id'>): FakeInvoice {
  return {
    store_id: 1,
    invoice_type: 'support_document',
    status: 'accepted',
    dian_status: 'accepted',
    supplier_id: 10,
    issue_date: day('2026-11-10'),
    invoice_number: `DS-${partial.id}`,
    customer_name: 'Proveedor Uno',
    customer_tax_id: '900123456',
    cufe: `cuds-${partial.id}`,
    subtotal_amount: dec('0'),
    tax_amount: dec('0'),
    withholding_amount: dec('0'),
    total_amount: dec('0'),
    currency: 'COP',
    accepted_at: null,
    supplier: { name: 'Proveedor Uno (ficha)', tax_id: '900123456' },
    related_invoice: null,
    purchase_order: null,
    ...partial,
  };
}

const money = (subtotal: string, tax: string, wh: string, total: string) => ({
  subtotal_amount: dec(subtotal),
  tax_amount: dec(tax),
  withholding_amount: dec(wh),
  total_amount: dec(total),
});

/** Noviembre 2026, tienda 1, más ruido que el reporte NO debe contar. */
const DATASET: FakeInvoice[] = [
  doc({ id: 1, issue_date: day('2026-11-01'), accepted_at: new Date('2026-11-02T03:00:00.000Z'), purchase_order: { id: 77, order_number: 'OC-0077' }, ...money('1000.50', '190.10', '25.00', '1190.60') }),
  doc({ id: 2, issue_date: day('2026-11-15'), status: 'sent', dian_status: 'pending', ...money('500.25', '95.05', '0', '595.30') }),
  doc({ id: 3, issue_date: day('2026-11-16'), status: 'voided', dian_status: 'rejected', ...money('9000', '1710', '0', '10710') }),
  doc({ id: 4, issue_date: day('2026-11-17'), status: 'cancelled', dian_status: 'not_applicable', cufe: null, ...money('300', '57', '0', '357') }),
  doc({
    id: 5, invoice_type: 'support_adjustment_note', issue_date: day('2026-11-20'),
    invoice_number: 'NAS-5', related_invoice: { invoice_number: 'DS-1' },
    accepted_at: new Date('2026-11-21T15:00:00.000Z'), ...money('200.30', '38.06', '5.00', '238.36'),
  }),
  doc({ id: 6, supplier_id: 11, customer_name: 'Proveedor Dos', issue_date: day('2026-11-18'), status: 'rejected', dian_status: 'rejected', ...money('100', '19', '0', '119') }),
  // Fuera del rango por un día a cada lado.
  doc({ id: 7, issue_date: day('2026-10-31'), ...money('7777', '0', '0', '7777') }),
  doc({ id: 8, issue_date: day('2026-12-01'), ...money('8888', '0', '0', '8888') }),
  // Otro tipo fiscal en la misma tienda y rango.
  doc({ id: 9, invoice_type: 'sales_invoice', ...money('5555', '0', '0', '5555') }),
  // Otra tienda, mismo rango y tipo.
  doc({ id: 10, store_id: 2, customer_name: 'Proveedor Ajeno', ...money('99999', '0', '0', '99999') }),
];

/** Fichas de proveedor (org de la tienda 1); el reporte toma nombre y NIT de aquí. */
const SUPPLIERS = [
  { id: 10, name: 'Proveedor Uno (ficha)', tax_id: '900123456' },
  { id: 11, name: 'Proveedor Dos (ficha)', tax_id: '800555111' },
];

const NOVEMBER: SupportDocumentsReportQueryDto = { date_from: '2026-11-01', date_to: '2026-11-30' };

describe('Support documents report (QUI-684)', () => {
  let tz: string;
  let data: FakeInvoice[];
  let invoices: Record<'findMany' | 'count' | 'groupBy', jest.Mock>;
  let suppliers: { findMany: jest.Mock };
  let service: SupportDocumentsReportService;
  let controller: SupportDocumentsReportController;
  let headers: Record<string, string>;
  let body: Buffer | undefined;
  let res: Response;

  beforeEach(() => {
    // Solo Date: el zip de ExcelJS sigue usando el scheduling real.
    jest.useFakeTimers({ doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'performance', 'queueMicrotask'] });
    // 1-dic 03:00 UTC = 30-nov 22:00 en Bogotá = 1-dic 12:00 en Tokio.
    jest.setSystemTime(new Date('2026-12-01T03:00:00.000Z'));
    jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 1, organization_id: 1, is_super_admin: false, is_owner: false });
    tz = 'America/Bogota';
    data = [...DATASET];

    invoices = {
      findMany: jest.fn(async (args: any) => {
        const rows = sortDocs(data.filter((d) => matches(d, args.where)), args.orderBy);
        const skip = args.skip ?? 0;
        return rows.slice(skip, args.take !== undefined ? skip + args.take : undefined);
      }),
      count: jest.fn(async (args: any) => data.filter((d) => matches(d, args.where)).length),
      groupBy: jest.fn(async (args: any) => {
        const groups = new Map<string, FakeInvoice[]>();
        const by: Array<keyof FakeInvoice> = args.by;
        for (const d of data.filter((x) => matches(x, args.where))) {
          const key = by.map((field) => String(d[field])).join('|');
          groups.set(key, [...(groups.get(key) ?? []), d]);
        }
        const sum = (list: FakeInvoice[], field: keyof FakeInvoice) =>
          list.reduce((acc, d) => acc.plus(d[field] as Prisma.Decimal), dec('0'));
        return [...groups.values()].map((list) => ({
          ...Object.fromEntries(by.map((field) => [field, list[0][field]])),
          _count: { _all: list.length },
          _sum: {
            subtotal_amount: sum(list, 'subtotal_amount'),
            tax_amount: sum(list, 'tax_amount'),
            withholding_amount: sum(list, 'withholding_amount'),
            total_amount: sum(list, 'total_amount'),
          },
        }));
      }),
    };
    suppliers = {
      findMany: jest.fn(async (args: any) =>
        SUPPLIERS.filter((s) => args.where.id.in.includes(s.id)),
      ),
    };
    const prisma = {
      invoices,
      suppliers,
      store_settings: { findFirst: jest.fn(async () => ({ stores: { timezone: tz }, settings: {} })) },
    } as unknown as StorePrismaService;

    service = new SupportDocumentsReportService(prisma);
    controller = new SupportDocumentsReportController(service, new ResponseService(), prisma);
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

  describe('totales', () => {
    it('separa soporte y ajuste, la nota resta y los anulados/cancelados no suman', async () => {
      const summary = await service.getSummary(NOVEMBER);

      expect(summary.support).toEqual({ count: 3, subtotal_amount: 1600.75, tax_amount: 304.15, withholding_amount: 25, total_amount: 1904.9 });
      expect(summary.adjustment).toEqual({ count: 1, subtotal_amount: 200.3, tax_amount: 38.06, withholding_amount: 5, total_amount: 238.36 });
      expect(summary.excluded_count).toBe(2);
      expect(summary.document_count).toBe(4);
      expect(summary.net).toEqual({ subtotal_amount: 1400.45, tax_amount: 266.09, withholding_amount: 20, total_amount: 1666.54 });
    });

    it('con filtro de estado «anulado» lista el documento pero los totales quedan en cero', async () => {
      const query = { ...NOVEMBER, status: ['voided' as const] };
      const summary = await service.getSummary(query);
      const list = await service.getList(query);

      expect(list.data.map((r) => r.id)).toEqual([3]);
      expect(list.data[0].counts_in_totals).toBe(false);
      expect(summary.excluded_count).toBe(1);
      expect(summary.document_count).toBe(0);
      expect(summary.net.total_amount).toBe(0);
    });

    it('filtra por tipo y por proveedor', async () => {
      const notes = await service.getSummary({ ...NOVEMBER, invoice_type: ['support_adjustment_note'] });
      expect(notes.support.count).toBe(0);
      expect(notes.adjustment.total_amount).toBe(238.36);
      expect(notes.net.total_amount).toBe(-238.36);

      const supplier = await service.getList({ ...NOVEMBER, supplier_id: 11 });
      expect(supplier.data.map((r) => r.id)).toEqual([6]);
      expect(supplier.data[0].supplier_name).toBe('Proveedor Dos');
    });
  });

  describe('por proveedor y estado DIAN (H4)', () => {
    it('agrupa por proveedor con NIT, cantidad y total neto; la suma de grupos es el neto', async () => {
      const summary = await service.getSummary(NOVEMBER);

      expect(summary.by_supplier).toEqual([
        {
          supplier_id: 10, supplier_name: 'Proveedor Uno (ficha)', supplier_tax_id: '900123456',
          document_count: 3, excluded_count: 2,
          subtotal_amount: 1300.45, tax_amount: 247.09, withholding_amount: 20, total_amount: 1547.54,
        },
        {
          supplier_id: 11, supplier_name: 'Proveedor Dos (ficha)', supplier_tax_id: '800555111',
          document_count: 1, excluded_count: 0,
          subtotal_amount: 100, tax_amount: 19, withholding_amount: 0, total_amount: 119,
        },
      ]);
      const sum = (key: 'subtotal_amount' | 'tax_amount' | 'withholding_amount' | 'total_amount') =>
        Math.round(summary.by_supplier.reduce((acc, g) => acc + g[key], 0) * 100) / 100;
      expect(sum('subtotal_amount')).toBe(summary.net.subtotal_amount);
      expect(sum('tax_amount')).toBe(summary.net.tax_amount);
      expect(sum('withholding_amount')).toBe(summary.net.withholding_amount);
      expect(sum('total_amount')).toBe(summary.net.total_amount);
      expect(summary.by_supplier.reduce((acc, g) => acc + g.document_count, 0)).toBe(summary.document_count);
      // Un único groupBy (proveedor × tipo × estado) alimenta totales y grupos.
      expect(invoices.groupBy).toHaveBeenCalledTimes(1);
      expect(invoices.groupBy.mock.calls[0][0].by).toEqual(['supplier_id', 'invoice_type', 'status']);
      expect(suppliers.findMany.mock.calls[0][0].where).toEqual({ id: { in: [10, 11] } });
    });

    it('agrupa en «Sin proveedor» los documentos sin proveedor enlazado', async () => {
      data.push(doc({ id: 20, supplier_id: null, supplier: null, customer_name: 'Snapshot', ...money('10', '0', '0', '10') }));
      const summary = await service.getSummary(NOVEMBER);
      const loose = summary.by_supplier.find((g) => g.supplier_id === null);

      expect(loose).toEqual(expect.objectContaining({ supplier_name: 'Sin proveedor', supplier_tax_id: null, document_count: 1, total_amount: 10 }));
      expect(suppliers.findMany.mock.calls[0][0].where.id.in).not.toContain(null);
    });

    it('filtra por estado DIAN en lista, totales y agrupación', async () => {
      const query = { ...NOVEMBER, dian_status: ['pending' as const] };
      const list = await service.getList(query);
      const summary = await service.getSummary(query);

      expect(list.data.map((r) => r.id)).toEqual([2]);
      expect(summary.document_count).toBe(1);
      expect(summary.net.total_amount).toBe(595.3);
      expect(summary.by_supplier.map((g) => g.supplier_id)).toEqual([10]);
      expect(invoices.findMany.mock.calls[0][0].where.dian_status).toEqual({ in: ['pending'] });
    });

    it('el reporte cuadra con su listado del mismo período (sin anulados, ajustes restan)', async () => {
      const list = await service.getList({ ...NOVEMBER, limit: 200 });
      const summary = await service.getSummary(NOVEMBER);
      const net = list.data
        .filter((r) => r.counts_in_totals)
        .reduce((acc, r) => acc + (r.invoice_type === 'support_adjustment_note' ? -r.total_amount : r.total_amount), 0);

      expect(list.total).toBe(summary.document_count + summary.excluded_count);
      expect(Math.round(net * 100) / 100).toBe(summary.net.total_amount);
    });

    it('expone la OC de origen en cada fila', async () => {
      const list = await service.getList({ ...NOVEMBER, limit: 200 });
      const first = list.data.find((r) => r.id === 1)!;
      expect(first.purchase_order_id).toBe(77);
      expect(first.purchase_order_number).toBe('OC-0077');
      expect(list.data.find((r) => r.id === 2)!.purchase_order_number).toBeNull();
    });

    it('otra tienda solo ve la agrupación de sus proveedores', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 2, organization_id: 1, is_super_admin: false, is_owner: false });
      const summary = await service.getSummary(NOVEMBER);
      expect(summary.by_supplier).toHaveLength(1);
      expect(summary.by_supplier[0]).toEqual(expect.objectContaining({ supplier_id: 10, total_amount: 99999, document_count: 1 }));
    });
  });

  describe('rango en la zona horaria de la tienda', () => {
    it('incluye el primer y el último día del rango y excluye los vecinos (fecha de negocio, sin correr un día)', async () => {
      const list = await service.getList({ ...NOVEMBER, limit: 50 });
      const ids = list.data.map((r) => r.id);

      expect(ids).toContain(1); // 1-nov: con el rango de instantes de Bogotá caería fuera
      expect(ids).not.toContain(7); // 31-oct
      expect(ids).not.toContain(8); // 1-dic
      expect(invoices.findMany.mock.calls[0][0].where.issue_date).toEqual({
        gte: new Date('2026-11-01T00:00:00.000Z'),
        lte: new Date('2026-11-30T23:59:59.999Z'),
      });
    });

    it('resuelve «hoy» con el calendario de la tienda, no con UTC', async () => {
      // A las 03:00 UTC del 1-dic, en Bogotá todavía es 30-nov.
      await service.getList({ date_preset: DatePreset.TODAY });
      expect(invoices.findMany.mock.calls[0][0].where.issue_date).toEqual({
        gte: new Date('2026-11-30T00:00:00.000Z'),
        lte: new Date('2026-11-30T23:59:59.999Z'),
      });

      tz = 'Asia/Tokyo';
      const tokyo = await service.getList({ date_preset: DatePreset.TODAY });
      expect(tokyo.data.map((r) => r.id)).toEqual([8]);
    });
  });

  describe('aislamiento por tienda', () => {
    it('otra tienda no ve los documentos de la tienda 1 ni al revés', async () => {
      const own = await service.getForExport(NOVEMBER);
      expect(own.map((r) => r.id)).not.toContain(10);
      expect(own.every((r) => r.supplier_name !== 'Proveedor Ajeno')).toBe(true);

      jest.spyOn(RequestContextService, 'getContext').mockReturnValue({ store_id: 2, organization_id: 1, is_super_admin: false, is_owner: false });
      const other = await service.getForExport(NOVEMBER);
      const otherSummary = await service.getSummary(NOVEMBER);
      expect(other.map((r) => r.id)).toEqual([10]);
      expect(otherSummary.net.total_amount).toBe(99999);
      const lastGroupBy = invoices.groupBy.mock.calls[invoices.groupBy.mock.calls.length - 1];
      expect(lastGroupBy[0].where.store_id).toBe(2);
    });

    it('sin tienda en contexto falla y no consulta nada', async () => {
      jest.spyOn(RequestContextService, 'getContext').mockReturnValue(undefined);
      await expect(service.getList(NOVEMBER)).rejects.toThrow();
      await expect(controller.exportSupportDocuments(NOVEMBER, res)).rejects.toThrow();
      expect(invoices.findMany).not.toHaveBeenCalled();
      expect(invoices.groupBy).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });

  describe('listado', () => {
    it('pagina en servidor con el total completo y ordena por fecha desc', async () => {
      const page1 = await service.getList({ ...NOVEMBER, page: 1, limit: 2 });
      expect(page1.total).toBe(6);
      expect(page1.data.map((r) => r.id)).toEqual([5, 6]);

      const result: any = await controller.getSupportDocuments({ ...NOVEMBER, page: 2, limit: 2 });
      expect(result.data.map((r: { id: number }) => r.id)).toEqual([4, 3]);
      expect(result.meta.total).toBe(6);
    });
  });

  describe('export XLSX', () => {
    it('registra GET export con el permiso de reportes y el guard', () => {
      const method = SupportDocumentsReportController.prototype.exportSupportDocuments;
      expect(Reflect.getMetadata(PATH_METADATA, SupportDocumentsReportController)).toBe('store/analytics/support-documents');
      expect(Reflect.getMetadata(PATH_METADATA, method)).toBe('export');
      expect(Reflect.getMetadata(METHOD_METADATA, method)).toBe(RequestMethod.GET);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, method)).toEqual(['store:analytics:read']);
      expect(Reflect.getMetadata(GUARDS_METADATA, SupportDocumentsReportController)).toContain(PermissionsGuard);
    });

    it('trae el dataset completo (no la página) con cabeceras, filas y totales iguales a la pantalla', async () => {
      await controller.exportSupportDocuments({ ...NOVEMBER, page: 3, limit: 1 }, res);

      expect(headers['Content-Type']).toBe(XLSX_CONTENT_TYPE);
      expect(headers['Content-Disposition']).toContain('documentos_soporte_2026-11-30.xlsx');
      const book = await workbook();
      const sheet = book.getWorksheet('Documentos soporte')!;

      expect(sheet.getRow(1).values).toEqual([
        undefined, 'Fecha emisión', 'Tipo', 'Número', 'Proveedor', 'NIT / Documento', 'Estado',
        'Documento original', 'CUDS', 'Subtotal', 'Impuestos', 'Retenciones', 'Total', 'Aceptado DIAN', 'En totales',
        'OC de origen',
      ]);
      expect(sheet.getCell('A1').font.bold).toBe(true);
      // 6 documentos del rango (page/limit se ignoran) + fila de totales.
      expect(sheet.rowCount).toBe(8);

      // Fila 2: la nota de ajuste (orden fecha desc).
      expect(sheet.getCell('A2').value).toBe('2026-11-20');
      expect(sheet.getCell('B2').value).toBe('Nota de ajuste');
      expect(sheet.getCell('C2').value).toBe('NAS-5');
      expect(sheet.getCell('D2').value).toBe('Proveedor Uno');
      expect(sheet.getCell('E2').value).toBe('900123456');
      expect(sheet.getCell('F2').value).toBe('Aceptado');
      expect(sheet.getCell('G2').value).toBe('DS-1');
      expect(sheet.getCell('I2').value).toBeCloseTo(200.3, 2);
      expect(sheet.getCell('I2').numFmt).toBe('#,##0.00');
      expect(sheet.getCell('L2').value).toBeCloseTo(238.36, 2);
      expect(sheet.getCell('N2').value).toBe('Sí');
      // Fila 5: el anulado aparece, marcado fuera de totales.
      expect(sheet.getCell('C5').value).toBe('DS-3');
      expect(sheet.getCell('F5').value).toBe('Anulado');
      expect(sheet.getCell('N5').value).toBe('No (anulado o cancelado)');
      expect(sheet.getCell('F4').value).toBe('Cancelado');
      // Fila 7: documento 1, generado desde la OC-0077 (QUI-684 H2).
      expect(sheet.getCell('C7').value).toBe('DS-1');
      expect(sheet.getCell('O7').value).toBe('OC-0077');
      expect(sheet.getCell('O2').value).toBe('');

      const screen = await service.getSummary(NOVEMBER);
      expect(sheet.getCell('B8').value).toBe('TOTAL NETO (soporte − ajustes, sin anulados)');
      expect(sheet.getCell('I8').value).toBeCloseTo(screen.net.subtotal_amount, 2);
      expect(sheet.getCell('J8').value).toBeCloseTo(screen.net.tax_amount, 2);
      expect(sheet.getCell('L8').value).toBeCloseTo(screen.net.total_amount, 2);
      expect(sheet.getCell('L8').value).toBeCloseTo(1666.54, 2);
      expect(sheet.getCell('L8').font.bold).toBe(true);

      const resumen = book.getWorksheet('Resumen')!;
      expect(resumen.getRow(1).values).toEqual([undefined, 'Concepto', 'Cantidad', 'Subtotal', 'Impuestos', 'Retenciones', 'Total']);
      expect(resumen.getCell('A2').value).toBe('Documentos soporte');
      expect(resumen.getCell('B2').value).toBe(3);
      expect(resumen.getCell('F2').value).toBeCloseTo(1904.9, 2);
      expect(resumen.getCell('A3').value).toBe('Notas de ajuste (restan)');
      expect(resumen.getCell('F3').value).toBeCloseTo(238.36, 2);
      expect(resumen.getCell('B4').value).toBe(2);
      expect(resumen.getCell('F4').value).toBeNull();
      expect(resumen.getCell('B5').value).toBe(4);
      expect(resumen.getCell('F5').value).toBeCloseTo(1666.54, 2);
    });

    it('hoja «Por proveedor» con las mismas cifras que las tarjetas', async () => {
      await controller.exportSupportDocuments(NOVEMBER, res);
      const book = await workbook();
      const screen = await service.getSummary(NOVEMBER);
      const sheet = book.getWorksheet('Por proveedor')!;

      expect(book.worksheets.map((w) => w.name)).toEqual(['Documentos soporte', 'Por proveedor', 'Resumen']);
      expect(sheet.getRow(1).values).toEqual([
        undefined, 'Proveedor', 'NIT / Documento', 'Documentos', 'Subtotal', 'Impuestos', 'Retenciones', 'Total',
        'Anulados/cancelados (fuera)',
      ]);
      expect(sheet.getCell('A2').value).toBe('Proveedor Uno (ficha)');
      expect(sheet.getCell('B2').value).toBe('900123456');
      expect(sheet.getCell('C2').value).toBe(3);
      expect(sheet.getCell('G2').value).toBeCloseTo(1547.54, 2);
      expect(sheet.getCell('H2').value).toBe(2);
      expect(sheet.getCell('A3').value).toBe('Proveedor Dos (ficha)');
      expect(sheet.getCell('G3').value).toBeCloseTo(119, 2);
      // Fila de totales = tarjetas.
      expect(sheet.getCell('A4').value).toBe('TOTAL NETO (soporte − ajustes, sin anulados)');
      expect(sheet.getCell('C4').value).toBe(screen.document_count);
      expect(sheet.getCell('D4').value).toBeCloseTo(screen.net.subtotal_amount, 2);
      expect(sheet.getCell('E4').value).toBeCloseTo(screen.net.tax_amount, 2);
      expect(sheet.getCell('F4').value).toBeCloseTo(screen.net.withholding_amount, 2);
      expect(sheet.getCell('G4').value).toBeCloseTo(screen.net.total_amount, 2);
      expect(sheet.getCell('H4').value).toBe(screen.excluded_count);
    });

    it('fechas: emisión sin correrse y aceptación DIAN en la zona de la tienda', async () => {
      await controller.exportSupportDocuments(NOVEMBER, res);
      let sheet = (await workbook()).getWorksheet('Documentos soporte')!;
      // Documento 1 (última fila de datos): emitido el 1-nov, aceptado 02-nov 03:00 UTC.
      expect(sheet.getCell('C7').value).toBe('DS-1');
      expect(sheet.getCell('A7').value).toBe('2026-11-01');
      expect((sheet.getCell('M7').value as Date).toISOString()).toBe('2026-11-01T00:00:00.000Z');
      expect(sheet.getCell('M7').numFmt).toBe('dd/mm/yyyy');
      expect(sheet.getCell('M3').value).toBeNull(); // documento 6 sin aceptación

      tz = 'Asia/Tokyo';
      await controller.exportSupportDocuments(NOVEMBER, res);
      sheet = (await workbook()).getWorksheet('Documentos soporte')!;
      expect(sheet.getCell('A7').value).toBe('2026-11-01');
      expect((sheet.getCell('M7').value as Date).toISOString()).toBe('2026-11-02T00:00:00.000Z');
      expect(headers['Content-Disposition']).toContain('documentos_soporte_2026-12-01.xlsx');
    });

    it('un fallo de lectura no envía cabeceras ni archivo', async () => {
      jest.spyOn(service, 'getForExport').mockRejectedValue(new Error('reader failed'));
      await expect(controller.exportSupportDocuments(NOVEMBER, res)).rejects.toThrow('reader failed');
      expect(res.set).not.toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });
});
