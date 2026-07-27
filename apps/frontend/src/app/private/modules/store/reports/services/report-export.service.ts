import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ReportExportService {
  /**
   * Download a report blob (an XLSX buffer produced by the backend) as a file.
   * The store-local date suffix is already baked into `filename` upstream;
   * this only appends the extension and triggers the browser download.
   */
  downloadBlob(blob: Blob, filename: string): void {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.xlsx`;
    a.click();
    window.URL.revokeObjectURL(url);
  }
}
