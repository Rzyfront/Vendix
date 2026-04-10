import { Injectable } from '@angular/core';
import { ReportColumn } from '../interfaces/report.interface';
import * as XLSX from 'xlsx';

@Injectable({
  providedIn: 'root',
})
export class ReportExportService {
  /**
   * Generate and download an XLSX file from report data.
   */
  exportToXlsx(data: any[], columns: ReportColumn[], filename: string): void {
    // Map data using column headers
    const mapped = data.map((row) => {
      const obj: Record<string, any> = {};
      columns.forEach((col) => {
        obj[col.header] = row[col.key] ?? '';
      });
      return obj;
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(mapped);

    // Auto-fit column widths
    const colWidths = columns.map((col) => {
      const headerLen = col.header.length;
      const maxDataLen = data.reduce((max, row) => {
        const val = String(row[col.key] ?? '');
        return Math.max(max, val.length);
      }, 0);
      return { wch: Math.max(headerLen, maxDataLen) + 2 };
    });
    ws['!cols'] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, 'Reporte');

    const dateStr = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `${filename}_${dateStr}.xlsx`);
  }

  /**
   * Download a blob as a file.
   */
  downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}_${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
