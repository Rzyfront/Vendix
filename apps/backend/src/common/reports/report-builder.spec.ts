import { Workbook } from 'exceljs';
import { ReportBuilder, formatCellDate } from './report-builder';
import { ReportColumn } from './report-column.types';

describe('ReportBuilder', () => {
  const columns: ReportColumn[] = [
    { key: 'name', header: 'Nombre', type: 'text' },
    { key: 'amount', header: 'Total', type: 'currency' },
    { key: 'created', header: 'Fecha', type: 'date', tz: 'America/Bogota' },
    { key: 'ratio', header: 'Margen', type: 'percent' },
    { key: 'qty', header: 'Cantidad', type: 'number' },
  ];

  async function buildAndReload(): Promise<Workbook> {
    const builder = new ReportBuilder();
    const buffer = await builder.build({
      sheets: [
        {
          name: 'Ventas',
          columns,
          // amount as Prisma-Decimal-like string, ratio as fraction (15.23%).
          rows: [
            {
              name: 'Producto A',
              amount: '1234.56',
              created: '2026-02-01T04:00:00Z', // 23:00 America/Bogota on 2026-01-31
              ratio: 0.1523,
              qty: 3,
            },
          ],
          totals: { name: 'TOTAL', amount: 1234.56, qty: 3 },
        },
      ],
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook;
  }

  it('generates a valid workbook with a bold header, typed currency and date cells', async () => {
    const workbook = await buildAndReload();
    const ws = workbook.getWorksheet('Ventas');
    expect(ws).toBeDefined();

    // (a.1) Header row is bold.
    const headerCell = ws!.getRow(1).getCell(1);
    expect(headerCell.value).toBe('Nombre');
    expect(headerCell.font?.bold).toBe(true);

    // (a.2) Currency cell is a REAL number with the money numFmt.
    const currencyCell = ws!.getRow(2).getCell(2);
    expect(typeof currencyCell.value).toBe('number');
    expect(currencyCell.value).toBeCloseTo(1234.56, 2);
    expect(currencyCell.numFmt).toBe('#,##0.00');

    // (a.3) Percent cell is a real number (fraction) with the percent numFmt.
    const percentCell = ws!.getRow(2).getCell(4);
    expect(typeof percentCell.value).toBe('number');
    expect(percentCell.value).toBeCloseTo(0.1523, 4);
    expect(percentCell.numFmt).toBe('0.00%');

    // (a.4) Date cell: pinned to the store-LOCAL calendar day (no UTC drift).
    // 2026-02-01T04:00Z is 23:00 on 2026-01-31 in America/Bogota.
    const dateCell = ws!.getRow(2).getCell(3);
    expect(dateCell.value instanceof Date).toBe(true);
    const cellDate = dateCell.value as Date;
    expect(cellDate.getUTCFullYear()).toBe(2026);
    expect(cellDate.getUTCMonth()).toBe(0); // January (0-based)
    expect(cellDate.getUTCDate()).toBe(31);
    expect(dateCell.numFmt).toBe('dd/mm/yyyy');

    // (a.5) Totals row is present and bold.
    const totalsCell = ws!.getRow(3).getCell(1);
    expect(totalsCell.value).toBe('TOTAL');
    expect(totalsCell.font?.bold).toBe(true);
  });

  describe('formatCellDate (root date fix)', () => {
    it('renders the store-local calendar date, not the UTC date', () => {
      // 04:00Z is still the previous day (23:00) in America/Bogota (UTC-5).
      expect(formatCellDate('2026-02-01T04:00:00Z', 'America/Bogota')).toBe(
        '2026-01-31',
      );
    });

    it('works for a Date input and negative day-rollover', () => {
      // 02:00Z on Jan 1 is 21:00 on Dec 31 (prev year) in America/Bogota.
      expect(
        formatCellDate(new Date('2026-01-01T02:00:00Z'), 'America/Bogota'),
      ).toBe('2025-12-31');
    });

    it('works for a positive-offset timezone (day rolls forward)', () => {
      // 22:00Z is 07:00 next day in Asia/Tokyo (UTC+9).
      expect(formatCellDate('2026-01-31T22:00:00Z', 'Asia/Tokyo')).toBe(
        '2026-02-01',
      );
    });
  });
});
